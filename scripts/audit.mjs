#!/usr/bin/env node
/**
 * Turns the harness on itself — the mechanically decidable half.
 *
 *   node scripts/audit.mjs [--target <installed-project>] [--json] [--threshold 0.4]
 *
 * Everything here is decidable from files on disk, so per ARCHITECTURE.md it
 * belongs in a script rather than in prose asking Claude to check carefully.
 * The judgment calls — is this rule actually earning its place, do these two
 * skills genuinely overlap in intent — stay in harness-audit/SKILL.md.
 *
 * Exit code is 0 always. This is a report, not a gate; a red audit should not
 * break someone's build.
 */
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const threshold = Number(args[args.indexOf('--threshold') + 1]) || 0.4;
const target = args.includes('--target') ? path.resolve(args[args.indexOf('--target') + 1]) : null;

const PLACEHOLDER = /_None recorded yet\./;
const BODY_LIMIT = 110;
const CLAUDE_MD_LIMIT = 80;

// ------------------------------------------------------------------ helpers

function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z-]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

async function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

const STOP = new Set(
  ('a an the and or of to for in on with when use using this that it its is are be by from as at any not no do does ' +
    'did into than then so if before after each every claude your you').split(' '),
);
const bag = (s) =>
  new Set(s.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
function jaccard(a, b) {
  const A = bag(a);
  const B = bag(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / (A.size + B.size - shared);
}

// ------------------------------------------------------------------ gather

const skills = [];
for (const [dir, group] of [['skills', 'core'], ['rules', 'pack']]) {
  for (const f of await walk(path.join(ROOT, dir))) {
    if (path.basename(f) !== 'SKILL.md') continue;
    const text = await readFile(f, 'utf8');
    const fm = frontmatter(text);
    skills.push({
      name: fm.name ?? path.basename(path.dirname(f)),
      description: fm.description ?? '',
      userOnly: /^(true|yes|on|1)$/i.test(fm['disable-model-invocation'] ?? ''),
      lines: text.split(/\r?\n/).length,
      // Anchored to line start: promote-lesson MENTIONS '## Incidents' mid-sentence
      // while routing a lesson, and an unanchored match counted that as provenance.
      hasIncidents: /^## Incidents/m.test(text),
      incidentRecorded: /^## Incidents/m.test(text) && !PLACEHOLDER.test(text),
      group,
      file: path.relative(ROOT, f).replace(/\\/g, '/'),
    });
  }
}

const findings = [];
const add = (severity, kind, message, detail) => findings.push({ severity, kind, message, detail });

// ------------------------------------------------------------------ checks

// 1. Skills whose descriptions overlap enough to route badly.
const billed = skills.filter((s) => !s.userOnly);
const pairs = [];
for (let i = 0; i < billed.length; i++)
  for (let j = i + 1; j < billed.length; j++)
    pairs.push({ a: billed[i].name, b: billed[j].name, score: jaccard(billed[i].description, billed[j].description) });
pairs.sort((x, y) => y.score - x.score);
for (const p of pairs.filter((p) => p.score >= threshold))
  add('high', 'overlapping-descriptions',
    `"${p.a}" and "${p.b}" overlap at ${p.score.toFixed(2)} — Claude will route between them badly`,
    'Rewrite one description to name what the other does NOT cover.');

// 2. Rules with no incident behind them.
for (const s of skills.filter((s) => !s.incidentRecorded))
  add('info', 'no-incident', `${s.name} has no recorded incident`, s.file);

// 3. Missing or absent description.
for (const s of skills.filter((s) => !s.description))
  add('high', 'no-description', `${s.name} has no description — it is invisible to routing`, s.file);

// 4. Bodies past the limit: reference material that should be a sibling file.
for (const s of skills.filter((s) => s.lines > BODY_LIMIT))
  add('medium', 'fat-body', `${s.name} body is ${s.lines} lines (limit ${BODY_LIMIT})`,
    'A body stays resident once loaded. Move lookup material to a sibling file the body names.');

// 5. Hooks with no test.
const hookDir = path.join(ROOT, 'hooks');
const hookFiles = (await walk(hookDir)).map((f) => path.basename(f));
for (const h of hookFiles.filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs')))
  if (!hookFiles.includes(h.replace(/\.mjs$/, '.test.mjs')))
    add('high', 'untested-hook', `hooks/${h} has no test beside it`,
      'Every hook needs its blocks AND its false positives asserted.');

// 6. Executable scripts with no test. Reporting tools are exempt (they have no
//    decision to get wrong); anything that WRITES to a project is not.
const REPORT_ONLY = new Set(['audit.mjs', 'listing-cost.mjs']);
const scriptNames = (await walk(path.join(ROOT, 'scripts'))).map((f) => path.basename(f));
const rootScripts = (await readdir(ROOT, { withFileTypes: true }))
  .filter((e) => e.isFile() && e.name.endsWith('.mjs'))
  .map((e) => e.name);
for (const [dirLabel, names, pool] of [
  ['scripts/', scriptNames, scriptNames],
  ['', rootScripts, rootScripts],
]) {
  for (const f of names) {
    if (!f.endsWith('.mjs') || f.endsWith('.test.mjs') || REPORT_ONLY.has(f)) continue;
    if (!pool.includes(f.replace(/\.mjs$/, '.test.mjs')))
      add('medium', 'untested-script', `${dirLabel}${f} has no test beside it`,
        'It mutates a project. Verified-by-running is not the same as tested.');
  }
}

// 7. CLAUDE.md template: over budget, or containing procedures.
const tmpl = path.join(ROOT, 'templates/CLAUDE.md.template');
if (existsSync(tmpl)) {
  const text = await readFile(tmpl, 'utf8');
  const lines = text.split(/\r?\n/);
  if (lines.length > CLAUDE_MD_LIMIT)
    add('high', 'claude-md-over-budget',
      `CLAUDE.md template is ${lines.length} lines (limit ${CLAUDE_MD_LIMIT})`,
      'Paid every session AND inside every subagent. Move procedures to skill bodies.');
  // A numbered sequence in CLAUDE.md is a procedure, and procedures are skills.
  const steps = lines.filter((l) => /^\s*\d+\.\s/.test(l));
  if (steps.length >= 3)
    add('medium', 'procedure-in-claude-md',
      `CLAUDE.md template contains ${steps.length} numbered steps — that is a procedure`,
      'Procedures belong in a skill body, which loads only when needed.');
}

// 8. Dead manifest entries in an installed project.
if (target) {
  const mf = path.join(target, '.claude/harness-manifest.json');
  if (!existsSync(mf)) add('info', 'not-installed', `no manifest at ${mf}`, '');
  else {
    const raw = await readFile(mf, 'utf8');
    const manifest = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
    for (const entry of manifest.files ?? []) {
      if (!existsSync(path.join(ROOT, entry.from)))
        add('high', 'dead-manifest-entry', `manifest references ${entry.from}, which no longer exists in the source`,
          'Run install again to re-plan, or uninstall to clean up.');
      if (!existsSync(path.join(target, entry.to)))
        add('medium', 'manifest-file-missing', `${entry.to} is tracked but missing on disk`, 'Run repair.');
    }
    // Files the plugin ships that the install predates.
    const known = new Set((manifest.files ?? []).map((f) => f.from));
    const shipped = (await walk(path.join(ROOT, 'skills')))
      .filter((f) => path.basename(f) === 'SKILL.md')
      .map((f) => path.relative(ROOT, f).replace(/\\/g, '/'));
    const missing = shipped.filter((s) => !known.has(s));
    if (missing.length)
      add('info', 'install-behind-source', `${missing.length} skill(s) exist in source but are not installed`,
        'Run update.');
  }
}

// ------------------------------------------------------------------ report

const bySeverity = { high: [], medium: [], info: [] };
for (const f of findings) bySeverity[f.severity].push(f);

if (asJson) {
  console.log(JSON.stringify({ findings, skills: skills.length, nearest: pairs.slice(0, 5) }, null, 2));
} else {
  const C = { red: (s) => `\x1b[31m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m` };
  console.log(`\nHarness audit — ${skills.length} skills, ${findings.length} findings\n${'='.repeat(52)}`);
  for (const [sev, label, paint] of [['high', 'HIGH', C.red], ['medium', 'MEDIUM', C.yellow], ['info', 'INFO', C.dim]]) {
    if (!bySeverity[sev].length) continue;
    console.log(`\n${paint(label)} (${bySeverity[sev].length})`);
    for (const f of bySeverity[sev]) {
      console.log(`  [${f.kind}] ${f.message}`);
      if (f.detail) console.log(`      ${C.dim(f.detail)}`);
    }
  }
  console.log(`\n${'='.repeat(52)}`);
  console.log(`nearest description pair: ${pairs[0] ? `${pairs[0].score.toFixed(2)} ${pairs[0].a} <-> ${pairs[0].b}` : 'n/a'}`);
  console.log(C.dim('mechanical checks only — see harness-audit/SKILL.md for the judgment pass\n'));
}
