#!/usr/bin/env node
/**
 * Profile-driven, manifest-tracked installer for the harness.
 *
 *   node install.mjs [install|update|repair|uninstall|status] [options]
 *
 *   --profile   core | backend | frontend | full     (default: core)
 *   --target    project directory                    (default: cwd)
 *   --claude-md block | sidecar | skip               (default: block)
 *   --force     overwrite or delete locally-edited files
 *   --dry-run   print the plan, change nothing
 *
 * Design commitments:
 *   - The manifest records every placed file with a content hash, so the
 *     installer can tell "you edited this" apart from "this is stale" apart
 *     from "this is missing". Those three need different answers.
 *   - Update reads from this checkout. No network, ever.
 *   - Uninstall leaves no orphans: files, then empty directories, then the
 *     settings entry, then the CLAUDE.md block, then the manifest itself.
 *   - An existing CLAUDE.md is never overwritten. Ever, including with --force.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, mkdir, rm, stat, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_NAME = '.claude/harness-manifest.json';
const HOOK_FINGERPRINT = '/.claude/hooks/guard-';
const BLOCK_START = '<!-- BEGIN harness';
const BLOCK_END = '<!-- END harness';

const PROFILES = {
  core: [],
  backend: ['backend'],
  frontend: ['frontend'],
  full: ['backend', 'frontend'],
};

// ------------------------------------------------------------------ utils

const rel = (p) => p.split(path.sep).join('/');
const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);

/**
 * Read UTF-8 text, stripping a byte-order mark.
 * PowerShell's Set-Content/Out-File write UTF-8 *with* BOM by default, so JSON
 * files in Windows projects routinely start with U+FEFF. JSON.parse rejects it.
 * Reading a project's own settings.json must not fail on how Windows wrote it.
 */
async function readText(p) {
  const s = await readFile(p, 'utf8');
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

function parseArgs(argv) {
  const cmds = new Set(['install', 'update', 'repair', 'uninstall', 'status']);
  const opts = { command: 'install', profile: 'core', target: process.cwd(), claudeMd: 'block', force: false, dryRun: false, profileExplicit: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (cmds.has(a)) opts.command = a;
    else if (a === '--force') opts.force = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--profile') { opts.profile = argv[++i]; opts.profileExplicit = true; }
    else if (a === '--target') opts.target = path.resolve(argv[++i]);
    else if (a === '--claude-md') opts.claudeMd = argv[++i];
    else if (a.startsWith('--profile=')) { opts.profile = a.slice(10); opts.profileExplicit = true; }
    else if (a.startsWith('--target=')) opts.target = path.resolve(a.slice(9));
    else if (a.startsWith('--claude-md=')) opts.claudeMd = a.slice(12);
    else if (a === '--uninstall') opts.command = 'uninstall';
    else if (a === '--repair') opts.command = 'repair';
    else if (a === '--update') opts.command = 'update';
  }
  if (!PROFILES[opts.profile]) fail(`Unknown profile "${opts.profile}". Choose: ${Object.keys(PROFILES).join(', ')}`);
  if (!['block', 'sidecar', 'skip'].includes(opts.claudeMd)) fail(`--claude-md must be block, sidecar, or skip`);
  return opts;
}

function fail(msg) {
  console.error(`${C.red('error')} ${msg}`);
  process.exit(1);
}

// ------------------------------------------------------------------ plan

/** Files this profile places, as {from (abs), to (project-relative), kind}. */
async function buildPlan(profile) {
  const plan = [];
  const add = async (srcDir, mapTo, kind) => {
    for (const abs of await walk(path.join(SRC, srcDir))) {
      const sub = rel(path.relative(path.join(SRC, srcDir), abs));
      if (sub === 'README.md') continue;
      plan.push({ from: abs, to: mapTo(sub), kind });
    }
  };

  await add('skills', (s) => `.claude/skills/${s}`, 'skill');
  for (const stack of PROFILES[profile]) {
    await add(`rules/${stack}`, (s) => `.claude/skills/${s}`, 'pack');
  }
  await add('agents', (s) => `.claude/agents/${s}`, 'agent');

  // Discovered, not listed: a hardcoded list silently omits the next guard.
  // hooks.json is not copied — it is translated into the project's settings.
  for (const abs of await walk(path.join(SRC, 'hooks'))) {
    const f = path.basename(abs);
    if (!f.endsWith('.mjs')) continue;
    plan.push({ from: abs, to: `.claude/hooks/${f}`, kind: 'hook' });
  }
  // Skills invoke these by path, so they must travel with the install.
  for (const f of ['vault.mjs', 'audit.mjs', 'listing-cost.mjs']) {
    plan.push({ from: path.join(SRC, 'scripts', f), to: `.claude/harness/scripts/${f}`, kind: 'script' });
  }
  return plan;
}

/**
 * Read a source file, rewriting the plugin-root token for a copied install.
 *
 * `${CLAUDE_PLUGIN_ROOT}` is only substituted for plugin skills. When the
 * harness is copied into `.claude/` instead of installed as a plugin, that
 * token stays literal and every scripted skill breaks. `${CLAUDE_PROJECT_DIR}`
 * IS substituted in skill markdown and in `allowed-tools` Bash rules, so it is
 * the correct token for this delivery mode.
 *
 * Hashing happens on the transformed bytes, so local-edit detection compares
 * like with like.
 */
const PLUGIN_ROOT = '${CLAUDE_PLUGIN_ROOT}';
const COPIED_ROOT = '${CLAUDE_PROJECT_DIR}/.claude/harness';

async function sourceContent(from) {
  const buf = await readFile(from);
  if (!/\.(md|template)$/i.test(from)) return buf;
  const text = buf.toString('utf8');
  if (!text.includes(PLUGIN_ROOT)) return buf;
  return Buffer.from(text.split(PLUGIN_ROOT).join(COPIED_ROOT), 'utf8');
}

// ------------------------------------------------------------------ manifest

async function readManifest(target) {
  const p = path.join(target, MANIFEST_NAME);
  if (!(await exists(p))) return null;
  try {
    return JSON.parse(await readText(p));
  } catch {
    fail(`Manifest at ${MANIFEST_NAME} is unreadable. Delete it and reinstall, or restore it from git.`);
  }
}

async function writeManifest(target, manifest, dryRun) {
  if (dryRun) return;
  const p = path.join(target, MANIFEST_NAME);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

/** Classify every manifest entry against what is actually on disk right now. */
async function inspect(target, manifest) {
  const rows = [];
  for (const entry of manifest.files) {
    const abs = path.join(target, entry.to);
    if (!(await exists(abs))) {
      rows.push({ ...entry, state: 'missing' });
      continue;
    }
    const onDisk = sha(await readFile(abs));
    if (onDisk !== entry.sha) rows.push({ ...entry, state: 'edited', onDisk });
    else rows.push({ ...entry, state: 'clean' });
  }
  return rows;
}

// ------------------------------------------------------------------ settings

/**
 * `hooks/hooks.json` is the single source of truth for what the guards are and
 * what each one matches. The installer translates it rather than restating it —
 * a second copy of the wiring here is a copy that silently goes stale the next
 * time a guard is added.
 */
async function harnessHookEvents() {
  const cfg = JSON.parse(await readText(path.join(SRC, 'hooks/hooks.json')));
  const translated = JSON.stringify(cfg.hooks ?? {})
    .split(`\${CLAUDE_PLUGIN_ROOT}/hooks/`)
    .join(`\${CLAUDE_PROJECT_DIR}/.claude/hooks/`);
  return JSON.parse(translated);
}

const isOurs = (group) =>
  Array.isArray(group?.hooks) &&
  group.hooks.some((h) => typeof h?.command === 'string' && h.command.includes(HOOK_FINGERPRINT));

/**
 * `priorRecord` carries the createdByUs flag forward across re-installs.
 * Recomputing it each time loses the fact that WE created the file: the second
 * install sees it already exists, records createdByUs=false, and uninstall then
 * leaves an empty `{}` behind — an orphan, which is exactly what the manifest
 * exists to prevent.
 */
async function wireSettings(target, dryRun, priorRecord) {
  const p = path.join(target, '.claude/settings.json');
  const existed = await exists(p);
  let settings = {};
  if (existed) {
    try {
      settings = JSON.parse(await readText(p));
    } catch {
      fail(`.claude/settings.json is not valid JSON. Fix it before installing — I will not rewrite a file I cannot parse.`);
    }
  }
  settings.hooks ??= {};
  // Drop every group we previously placed, then add the current set. Replacing
  // in place would strand a guard that has since been renamed or removed.
  for (const event of Object.keys(settings.hooks)) {
    settings.hooks[event] = (settings.hooks[event] ?? []).filter((g) => !isOurs(g));
    if (settings.hooks[event].length === 0) delete settings.hooks[event];
  }
  for (const [event, groups] of Object.entries(await harnessHookEvents())) {
    settings.hooks[event] ??= [];
    settings.hooks[event].push(...groups);
  }

  if (!dryRun) {
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  }
  return { path: '.claude/settings.json', createdByUs: priorRecord?.createdByUs || !existed };
}

async function unwireSettings(target, record, dryRun) {
  if (!record) return null;
  const p = path.join(target, record.path);
  if (!(await exists(p))) return null;
  let settings;
  try {
    settings = JSON.parse(await readText(p));
  } catch {
    return `${record.path} is not valid JSON — left untouched, remove the harness hook by hand`;
  }
  const before = settings.hooks?.PreToolUse?.length ?? 0;
  if (settings.hooks?.PreToolUse) {
    settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter((g) => !isOurs(g));
    if (settings.hooks.PreToolUse.length === 0) delete settings.hooks.PreToolUse;
    if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  }
  const removed = before - (settings.hooks?.PreToolUse?.length ?? 0);
  if (dryRun) return null;

  // Only delete the file if we created it AND nothing else ended up in it.
  if (record.createdByUs && Object.keys(settings).length === 0) await rm(p, { force: true });
  else await writeFile(p, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  return removed ? null : `no harness hook entry found in ${record.path}`;
}

// ------------------------------------------------------------------ CLAUDE.md

function stripBlock(text) {
  const s = text.indexOf(BLOCK_START);
  if (s === -1) return { text, found: false };
  const e = text.indexOf(BLOCK_END, s);
  if (e === -1) return { text, found: false };
  const endOfLine = text.indexOf('\n', e);
  const tail = endOfLine === -1 ? '' : text.slice(endOfLine + 1);
  const cleaned = (text.slice(0, s) + tail).replace(/\n{3,}/g, '\n\n').trimEnd();
  return { text: cleaned ? cleaned + '\n' : '', found: true };
}

function extractBlock(text) {
  const s = text.indexOf(BLOCK_START);
  if (s === -1) return null;
  const e = text.indexOf(BLOCK_END, s);
  if (e === -1) return null;
  const endOfLine = text.indexOf('\n', e);
  return text.slice(s, endOfLine === -1 ? text.length : endOfLine + 1);
}

async function applyClaudeMd(target, mode, force, dryRun, prior) {
  if (mode === 'skip') return { mode: 'skip', notes: ['CLAUDE.md untouched (--claude-md skip)'] };

  const block = await readFile(path.join(SRC, 'templates/CLAUDE.md.template'), 'utf8');
  const notes = [];

  if (mode === 'sidecar') {
    const p = path.join(target, 'CLAUDE.harness.md');
    if (!dryRun) await writeFile(p, block, 'utf8');
    notes.push(
      `wrote CLAUDE.harness.md alongside your CLAUDE.md — it is NOT loaded automatically.`,
      `  Add this line to CLAUDE.md to activate it:  @CLAUDE.harness.md`,
    );
    return { mode: 'sidecar', path: 'CLAUDE.harness.md', sha: sha(block), notes };
  }

  const p = path.join(target, 'CLAUDE.md');
  if (!(await exists(p))) {
    if (!dryRun) await writeFile(p, block, 'utf8');
    notes.push('created CLAUDE.md');
    return { mode: 'block', path: 'CLAUDE.md', sha: sha(block), notes };
  }

  const current = await readText(p);
  const existing = extractBlock(current);

  if (!existing) {
    // Existing CLAUDE.md with no harness block: APPEND. Never overwrite.
    const merged = current.trimEnd() + '\n\n' + block;
    if (!dryRun) await writeFile(p, merged, 'utf8');
    notes.push('appended a marked harness block to your existing CLAUDE.md (your content untouched)');
    return { mode: 'block', path: 'CLAUDE.md', sha: sha(block), notes };
  }

  if (prior?.sha && sha(existing) !== prior.sha && !force) {
    notes.push(
      `${C.yellow('skipped')} the CLAUDE.md harness block — you edited it since install.`,
      `  Re-run with --force to replace it, or move your edits outside the markers.`,
    );
    return { ...prior, notes };
  }

  const replaced = current.replace(existing, block);
  if (!dryRun) await writeFile(p, replaced, 'utf8');
  notes.push('refreshed the harness block in CLAUDE.md');
  return { mode: 'block', path: 'CLAUDE.md', sha: sha(block), notes };
}

async function removeClaudeMd(target, record, force, dryRun) {
  if (!record || record.mode === 'skip') return [];
  const notes = [];

  if (record.mode === 'sidecar') {
    const p = path.join(target, record.path);
    if (await exists(p)) {
      const edited = sha(await readFile(p)) !== record.sha;
      if (edited && !force) notes.push(`kept ${record.path} — locally edited (use --force to delete)`);
      else if (!dryRun) {
        await rm(p, { force: true });
        notes.push(`removed ${record.path}`);
      }
    }
    return notes;
  }

  const p = path.join(target, 'CLAUDE.md');
  if (!(await exists(p))) return notes;
  const current = await readText(p);
  const existing = extractBlock(current);
  if (!existing) return [`no harness block found in CLAUDE.md`];

  if (sha(existing) !== record.sha && !force) {
    notes.push(`kept the CLAUDE.md harness block — locally edited (use --force to remove it)`);
    return notes;
  }
  const { text } = stripBlock(current);
  if (!dryRun) {
    if (text.trim() === '') {
      await rm(p, { force: true });
      notes.push('removed CLAUDE.md (it contained only the harness block)');
    } else {
      await writeFile(p, text, 'utf8');
      notes.push('removed the harness block from CLAUDE.md, kept your content');
    }
  }
  return notes;
}

// ------------------------------------------------------------------ prune

/** Remove directories under .claude that we emptied. Leaves no orphans. */
async function pruneEmpty(target, dryRun) {
  const roots = ['.claude/skills', '.claude/agents', '.claude/hooks', '.claude'];
  const removed = [];
  for (const root of roots) {
    const abs = path.join(target, root);
    if (!(await exists(abs))) continue;
    const dirs = [];
    const collect = async (d) => {
      for (const e of await readdir(d, { withFileTypes: true })) {
        if (e.isDirectory()) {
          await collect(path.join(d, e.name));
          dirs.push(path.join(d, e.name));
        }
      }
    };
    await collect(abs);
    dirs.push(abs);
    for (const d of dirs) {
      try {
        const left = await readdir(d);
        if (left.length === 0) {
          if (!dryRun) await rmdir(d);
          removed.push(rel(path.relative(target, d)));
        }
      } catch {
        /* already gone */
      }
    }
  }
  return removed;
}

// ------------------------------------------------------------------ commands

/**
 * Fail before touching anything, not halfway through.
 *
 * Learned the hard way: an unparseable settings.json was detected *after* the
 * copy loop, which left 12 files placed and no manifest written — an install
 * with no record of itself, which is the exact orphan state the manifest is
 * supposed to make impossible. Everything that can refuse must refuse first.
 */
async function preflight(target) {
  const p = path.join(target, '.claude/settings.json');
  if (await exists(p)) {
    try {
      JSON.parse(await readText(p));
    } catch {
      fail(`.claude/settings.json is not valid JSON. Fix it before installing — I will not rewrite a file I cannot parse.\n      Nothing has been written.`);
    }
  }
  for (const required of ['skills', 'agents', 'hooks', 'templates/CLAUDE.md.template']) {
    if (!(await exists(path.join(SRC, required)))) fail(`source checkout is incomplete: missing ${required}`);
  }
}

async function cmdInstall(opts) {
  const { target, profile, force, dryRun } = opts;
  await preflight(target);
  const prior = await readManifest(target);
  if (prior && !force && prior.profile !== profile) {
    console.log(C.dim(`existing install: profile "${prior.profile}" -> switching to "${profile}"`));
  }

  const plan = await buildPlan(profile);
  const priorByPath = new Map((prior?.files ?? []).map((f) => [f.to, f]));
  const files = [];
  const skipped = [];
  let wrote = 0;

  for (const item of plan) {
    const abs = path.join(target, item.to);
    const content = await sourceContent(item.from);
    const want = sha(content);

    if (await exists(abs)) {
      const onDisk = sha(await readFile(abs));
      const known = priorByPath.get(item.to);
      const locallyEdited = known ? onDisk !== known.sha : onDisk !== want;
      if (locallyEdited && !force) {
        skipped.push(item.to);
        files.push({ to: item.to, from: rel(path.relative(SRC, item.from)), kind: item.kind, sha: known?.sha ?? onDisk });
        continue;
      }
      if (onDisk === want) {
        files.push({ to: item.to, from: rel(path.relative(SRC, item.from)), kind: item.kind, sha: want });
        continue;
      }
    }

    if (!dryRun) {
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, content);
    }
    wrote++;
    files.push({ to: item.to, from: rel(path.relative(SRC, item.from)), kind: item.kind, sha: want });
  }

  // Files the previous profile placed that this one does not: remove them.
  const wanted = new Set(plan.map((p) => p.to));
  const orphaned = [];
  for (const old of prior?.files ?? []) {
    if (wanted.has(old.to)) continue;
    const abs = path.join(target, old.to);
    if (!(await exists(abs))) continue;
    const edited = sha(await readFile(abs)) !== old.sha;
    if (edited && !force) {
      orphaned.push(`${old.to} (kept — locally edited)`);
      continue;
    }
    if (!dryRun) await rm(abs, { force: true });
    orphaned.push(old.to);
  }

  const settings = await wireSettings(target, dryRun, prior?.settings);
  const claudeMd = await applyClaudeMd(target, opts.claudeMd, force, dryRun, prior?.claudeMd);

  const manifest = {
    harness: '0.1.0',
    profile,
    command: `install --profile ${profile}`,
    installedAt: new Date().toISOString(),
    source: rel(SRC),
    files,
    settings,
    claudeMd: { mode: claudeMd.mode, path: claudeMd.path, sha: claudeMd.sha },
  };
  await writeManifest(target, manifest, dryRun);
  if (!dryRun) await pruneEmpty(target, dryRun);

  console.log(`${C.green('installed')} harness ${C.bold(profile)} -> ${rel(target)}`);
  console.log(`  ${files.length} files tracked, ${wrote} written, ${files.length - wrote - skipped.length} already current`);
  if (skipped.length) {
    console.log(`  ${C.yellow(`${skipped.length} skipped (locally edited, use --force to overwrite):`)}`);
    for (const s of skipped) console.log(`    ${s}`);
  }
  if (orphaned.length) {
    console.log(`  removed ${orphaned.length} file(s) not in this profile:`);
    for (const o of orphaned) console.log(`    ${o}`);
  }
  console.log(`  hook wired into ${settings.path}${settings.createdByUs ? ' (created)' : ' (merged)'}`);
  for (const n of claudeMd.notes) console.log(`  ${n}`);
  if (dryRun) console.log(C.dim('\n  --dry-run: nothing was written'));
}

async function cmdStatus(opts) {
  const manifest = await readManifest(opts.target);
  if (!manifest) return console.log('harness is not installed here');
  const rows = await inspect(opts.target, manifest);
  const by = (s) => rows.filter((r) => r.state === s);

  console.log(`harness ${manifest.harness}  profile ${C.bold(manifest.profile)}  installed ${manifest.installedAt}`);
  console.log(`  ${C.green(`${by('clean').length} clean`)}  ${C.yellow(`${by('edited').length} locally edited`)}  ${C.red(`${by('missing').length} missing`)}`);
  for (const r of by('edited')) console.log(`  ${C.yellow('edited ')} ${r.to}`);
  for (const r of by('missing')) console.log(`  ${C.red('missing')} ${r.to}`);

  const settingsOk = await exists(path.join(opts.target, manifest.settings?.path ?? '.claude/settings.json'));
  console.log(`  settings: ${settingsOk ? 'present' : C.red('missing')}`);
  if (by('missing').length) console.log(C.dim('\n  run `repair` to restore missing files'));
  return by('missing').length + by('edited').length === 0 ? 0 : 1;
}

async function cmdRepair(opts) {
  const manifest = await readManifest(opts.target);
  if (!manifest) fail('nothing to repair — no manifest found. Run install first.');
  const rows = await inspect(opts.target, manifest);
  let restored = 0;
  const held = [];

  for (const r of rows) {
    const src = path.join(SRC, r.from);
    if (!(await exists(src))) {
      console.log(`  ${C.red('gone')} ${r.from} no longer exists in the source checkout`);
      continue;
    }
    if (r.state === 'missing' || (r.state === 'edited' && opts.force)) {
      if (!opts.dryRun) {
        await mkdir(path.dirname(path.join(opts.target, r.to)), { recursive: true });
        await writeFile(path.join(opts.target, r.to), await sourceContent(src));
      }
      console.log(`  ${C.green('restored')} ${r.to}${r.state === 'edited' ? ' (was locally edited, --force)' : ''}`);
      restored++;
    } else if (r.state === 'edited') {
      held.push(r.to);
    }
  }

  if (!(await exists(path.join(opts.target, manifest.settings?.path ?? '')))) {
    await wireSettings(opts.target, opts.dryRun, manifest.settings);
    console.log(`  ${C.green('restored')} ${manifest.settings?.path ?? '.claude/settings.json'}`);
    restored++;
  }

  console.log(`${C.green('repair')} ${restored} restored, ${held.length} left alone`);
  if (held.length) {
    console.log(`  ${C.yellow('locally edited, kept as-is (use --force to overwrite):')}`);
    for (const h of held) console.log(`    ${h}`);
  }
}

async function cmdUpdate(opts) {
  const manifest = await readManifest(opts.target);
  if (!manifest) fail('nothing to update — no manifest found. Run install first.');
  console.log(C.dim(`updating from ${manifest.source || rel(SRC)} (local checkout, no download)`));
  // Keep the installed profile unless --profile was EXPLICITLY passed. parseArgs
  // defaults profile to 'core', so it is never undefined — an   // here silently downgraded every update to core and deleted the stack packs.
  // Keep the installed profile unless --profile was EXPLICITLY passed.
  // parseArgs defaults profile to 'core', so it is never undefined, and the
  // previous `opts.profile ?? manifest.profile` therefore always resolved to
  // 'core' — silently downgrading every update and deleting the stack packs.
  // Found in a real project: a `full` install came back as `core`, two packs gone.
  await cmdInstall({ ...opts, profile: opts.profileExplicit ? opts.profile : manifest.profile });
}

async function cmdUninstall(opts) {
  const { target, force, dryRun } = opts;
  const manifest = await readManifest(target);
  if (!manifest) fail('nothing to uninstall — no manifest found here.');

  const rows = await inspect(target, manifest);
  let removed = 0;
  const kept = [];

  for (const r of rows) {
    if (r.state === 'missing') continue;
    if (r.state === 'edited' && !force) {
      kept.push(r.to);
      continue;
    }
    if (!dryRun) await rm(path.join(target, r.to), { force: true });
    removed++;
  }

  const settingsNote = await unwireSettings(target, manifest.settings, dryRun);
  const claudeNotes = await removeClaudeMd(target, manifest.claudeMd, force, dryRun);
  if (!dryRun) await rm(path.join(target, MANIFEST_NAME), { force: true });
  const pruned = await pruneEmpty(target, dryRun);

  console.log(`${C.green('uninstalled')} harness from ${rel(target)}`);
  console.log(`  ${removed} files removed, ${pruned.length} empty directories pruned`);
  if (settingsNote) console.log(`  ${C.yellow(settingsNote)}`);
  else console.log(`  hook entry removed from ${manifest.settings?.path}`);
  for (const n of claudeNotes) console.log(`  ${n}`);
  if (kept.length) {
    console.log(`  ${C.yellow(`${kept.length} locally-edited file(s) kept (use --force to remove):`)}`);
    for (const k of kept) console.log(`    ${k}`);
    console.log(C.dim('  the manifest is gone, so these are now yours to manage'));
  }
}

// ------------------------------------------------------------------ main

const opts = parseArgs(process.argv.slice(2));
const commands = { install: cmdInstall, update: cmdUpdate, repair: cmdRepair, uninstall: cmdUninstall, status: cmdStatus };
await commands[opts.command](opts);
