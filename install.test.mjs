/**
 * Tests for the installer.
 *
 * install.mjs mutates someone's project: it writes files, edits their
 * settings.json, and appends to their CLAUDE.md. The failure modes that matter
 * are all destructive — clobbering a local edit, leaving an orphan behind,
 * half-installing and then failing. Those are what this asserts.
 *
 * Every case runs the real CLI against a real temp directory. There are no
 * mocks, because the thing under test IS the filesystem effect.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INSTALL = path.join(HERE, 'install.mjs');
let proj;

beforeEach(() => {
  proj = mkdtempSync(path.join(tmpdir(), 'harness-install-'));
  writeFileSync(path.join(proj, 'main.py'), 'print(1)\n');
});

const run = (...args) => {
  const r = spawnSync(process.execPath, [INSTALL, ...args, '--target', proj], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
};
const p = (rel) => path.join(proj, rel);
const read = (rel) => readFileSync(p(rel), 'utf8');
const manifest = () => JSON.parse(read('.claude/harness-manifest.json'));
const skillNames = () => readdirSync(p('.claude/skills')).sort();
const EDIT = '\n<!-- my local tweak -->\n';

// ===========================================================================
describe('profiles', () => {
  test('core installs no stack packs', () => {
    assert.equal(run('install', '--profile', 'core').code, 0);
    const names = skillNames();
    assert.ok(names.includes('reproduce-first'), 'core skills present');
    assert.ok(!names.includes('stateful-markers'), 'backend pack must NOT be installed');
    assert.ok(!names.includes('loading-and-empty'), 'frontend pack must NOT be installed');
  });

  test('backend adds only the backend pack', () => {
    run('install', '--profile', 'backend');
    const names = skillNames();
    assert.ok(names.includes('stateful-markers'));
    assert.ok(!names.includes('loading-and-empty'));
  });

  test('full adds both packs', () => {
    run('install', '--profile', 'full');
    const names = skillNames();
    assert.ok(names.includes('stateful-markers'));
    assert.ok(names.includes('loading-and-empty'));
  });

  test('switching profile removes packs the new profile does not include', () => {
    run('install', '--profile', 'backend');
    assert.ok(skillNames().includes('stateful-markers'));
    const r = run('install', '--profile', 'frontend');
    assert.match(r.out, /removed 1 file/);
    assert.ok(!skillNames().includes('stateful-markers'), 'old pack removed');
    assert.ok(skillNames().includes('loading-and-empty'), 'new pack added');
  });

  test('an unknown profile is refused before anything is written', () => {
    const r = run('install', '--profile', 'nonsense');
    assert.equal(r.code, 1);
    assert.match(r.err, /Unknown profile/);
    assert.ok(!existsSync(p('.claude')), 'nothing written');
  });
});

// ===========================================================================
describe('CLAUDE.md is never overwritten', () => {
  test('an existing CLAUDE.md keeps every line the user wrote', () => {
    writeFileSync(p('CLAUDE.md'), '# Acme\n\nWe use pnpm, not npm.\nAsk before touching infra/.\n');
    const r = run('install');
    const after = read('CLAUDE.md');
    assert.match(r.out, /appended a marked harness block/);
    assert.ok(after.startsWith('# Acme'), 'user content still leads the file');
    assert.match(after, /We use pnpm, not npm\./);
    assert.match(after, /Ask before touching infra\//);
    assert.match(after, /<!-- BEGIN harness/);
  });

  test('CLAUDE.md is created when absent', () => {
    const r = run('install');
    assert.match(r.out, /created CLAUDE\.md/);
    assert.match(read('CLAUDE.md'), /<!-- BEGIN harness/);
  });

  test('--claude-md skip leaves the file entirely alone', () => {
    writeFileSync(p('CLAUDE.md'), 'mine\n');
    run('install', '--claude-md', 'skip');
    assert.equal(read('CLAUDE.md'), 'mine\n');
  });

  test('--claude-md sidecar writes alongside and says it is not auto-loaded', () => {
    writeFileSync(p('CLAUDE.md'), 'mine\n');
    const r = run('install', '--claude-md', 'sidecar');
    assert.equal(read('CLAUDE.md'), 'mine\n', 'original untouched');
    assert.ok(existsSync(p('CLAUDE.harness.md')));
    assert.match(r.out, /NOT loaded automatically/);
    assert.match(r.out, /@CLAUDE\.harness\.md/);
  });

  test('reinstalling does not stack a second harness block', () => {
    writeFileSync(p('CLAUDE.md'), '# Acme\n');
    run('install');
    run('install');
    assert.equal((read('CLAUDE.md').match(/<!-- BEGIN harness/g) ?? []).length, 1);
  });

  test('an edited harness block is not silently replaced', () => {
    run('install');
    writeFileSync(p('CLAUDE.md'), read('CLAUDE.md').replace('## Working agreement', '## My rules'));
    const r = run('install');
    assert.match(r.out, /skipped[\s\S]*CLAUDE\.md harness block/);
    assert.match(read('CLAUDE.md'), /## My rules/, 'my edit survived');
  });
});

// ===========================================================================
describe('settings.json', () => {
  test('unrelated settings and other hooks survive the merge', () => {
    mkdirSync(p('.claude'), { recursive: true });
    writeFileSync(p('.claude/settings.json'), JSON.stringify({
      env: { ACME_REGION: 'eu-west-1' },
      hooks: { PostToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'echo mine' }] }] },
    }, null, 2));
    run('install');
    const s = JSON.parse(read('.claude/settings.json'));
    assert.equal(s.env.ACME_REGION, 'eu-west-1');
    assert.equal(s.hooks.PostToolUse[0].hooks[0].command, 'echo mine');
    assert.equal(s.hooks.PreToolUse.length, 2, 'both harness guards added');
  });

  test('a settings.json with a UTF-8 BOM is read, not rejected', () => {
    mkdirSync(p('.claude'), { recursive: true });
    writeFileSync(p('.claude/settings.json'), '﻿' + JSON.stringify({ env: { A: '1' } }));
    const r = run('install');
    assert.equal(r.code, 0, 'PowerShell writes BOMs; a project config must still be readable');
    assert.equal(JSON.parse(read('.claude/settings.json')).env.A, '1');
  });

  test('unparseable settings.json fails BEFORE any file is written', () => {
    mkdirSync(p('.claude'), { recursive: true });
    writeFileSync(p('.claude/settings.json'), '{ not json');
    const r = run('install');
    assert.equal(r.code, 1);
    assert.match(r.err, /Nothing has been written/);
    assert.ok(!existsSync(p('.claude/skills')), 'no half-install left behind');
    assert.ok(!existsSync(p('.claude/harness-manifest.json')), 'no orphaned files without a manifest');
  });

  test('reinstalling does not duplicate the harness hook entry', () => {
    run('install');
    run('install');
    const s = JSON.parse(read('.claude/settings.json'));
    const ours = s.hooks.PreToolUse.filter((g) => g.hooks.some((h) => h.command.includes('/.claude/hooks/guard-')));
    assert.equal(ours.length, 2, 'each guard appears exactly once after a reinstall');
  });
});

// ===========================================================================
describe('local edits are not clobbered', () => {
  test('install skips a locally edited file and says so', () => {
    run('install');
    writeFileSync(p('.claude/skills/handoff/SKILL.md'), read('.claude/skills/handoff/SKILL.md') + EDIT);
    const r = run('install');
    assert.match(r.out, /1 skipped \(locally edited/);
    assert.match(read('.claude/skills/handoff/SKILL.md'), /my local tweak/);
  });

  test('--force overwrites it', () => {
    run('install');
    writeFileSync(p('.claude/skills/handoff/SKILL.md'), read('.claude/skills/handoff/SKILL.md') + EDIT);
    run('install', '--force');
    assert.doesNotMatch(read('.claude/skills/handoff/SKILL.md'), /my local tweak/);
  });

  test('status distinguishes clean, edited and missing', () => {
    run('install');
    writeFileSync(p('.claude/skills/handoff/SKILL.md'), read('.claude/skills/handoff/SKILL.md') + EDIT);
    rmSync(p('.claude/skills/risky-op/SKILL.md'));
    const r = run('status');
    assert.match(r.out, /1 locally edited/);
    assert.match(r.out, /1 missing/);
    assert.match(r.out, /edited[\s\S]*handoff/);
    assert.match(r.out, /missing[\s\S]*risky-op/);
  });

  test('repair restores missing files but leaves edits alone', () => {
    run('install');
    writeFileSync(p('.claude/skills/handoff/SKILL.md'), read('.claude/skills/handoff/SKILL.md') + EDIT);
    rmSync(p('.claude/skills/risky-op/SKILL.md'));
    const r = run('repair');
    assert.match(r.out, /restored[\s\S]*risky-op/);
    assert.match(r.out, /1 left alone/);
    assert.match(read('.claude/skills/handoff/SKILL.md'), /my local tweak/);
    assert.ok(existsSync(p('.claude/skills/risky-op/SKILL.md')));
  });

  test('uninstall keeps a locally edited file rather than deleting it', () => {
    run('install');
    writeFileSync(p('.claude/skills/handoff/SKILL.md'), read('.claude/skills/handoff/SKILL.md') + EDIT);
    const r = run('uninstall');
    assert.match(r.out, /locally-edited file\(s\) kept/);
    assert.ok(existsSync(p('.claude/skills/handoff/SKILL.md')), 'my edit was not deleted');
  });
});

// ===========================================================================
describe('uninstall leaves no orphans', () => {
  test('a bare project returns to exactly its original contents', () => {
    run('install', '--profile', 'full');
    run('uninstall');
    assert.deepEqual(readdirSync(proj), ['main.py']);
  });

  test('settings.json we created is removed even after a reinstall', () => {
    run('install', '--profile', 'core');
    run('install', '--profile', 'full');
    run('uninstall');
    assert.ok(!existsSync(p('.claude/settings.json')),
      'createdByUs must survive re-install, or an empty {} is orphaned');
    assert.deepEqual(readdirSync(proj), ['main.py']);
  });

  test('a settings.json we did not create keeps its own keys', () => {
    mkdirSync(p('.claude'), { recursive: true });
    writeFileSync(p('.claude/settings.json'), JSON.stringify({ env: { A: '1' } }));
    run('install');
    run('uninstall');
    const s = JSON.parse(read('.claude/settings.json'));
    assert.equal(s.env.A, '1');
    assert.ok(!s.hooks, 'harness hook removed, file kept');
  });

  test('CLAUDE.md keeps user content and loses only the block', () => {
    writeFileSync(p('CLAUDE.md'), '# Acme\n\nWe use pnpm.\n');
    run('install');
    run('uninstall');
    const after = read('CLAUDE.md');
    assert.match(after, /We use pnpm\./);
    assert.doesNotMatch(after, /BEGIN harness/);
  });

  test('CLAUDE.md is deleted when it held only the harness block', () => {
    run('install');
    const r = run('uninstall');
    assert.match(r.out, /removed CLAUDE\.md/);
    assert.ok(!existsSync(p('CLAUDE.md')));
  });

  test('lessons are project knowledge and survive uninstall', () => {
    run('install');
    mkdirSync(p('.claude/lessons'), { recursive: true });
    writeFileSync(p('.claude/lessons/a-lesson.md'), '# kept\n');
    run('uninstall');
    assert.ok(existsSync(p('.claude/lessons/a-lesson.md')), 'never delete recorded lessons');
  });

  test('uninstalling with no manifest refuses instead of guessing', () => {
    const r = run('uninstall');
    assert.equal(r.code, 1);
    assert.match(r.err, /no manifest found/);
  });
});

// ===========================================================================
describe('manifest and portability', () => {
  test('every tracked file carries a content hash and exists', () => {
    run('install');
    const m = manifest();
    assert.ok(m.files.length > 20);
    for (const f of m.files) {
      assert.match(f.sha, /^[0-9a-f]{16}$/, `${f.to} has a hash`);
      assert.ok(existsSync(p(f.to)), `${f.to} exists`);
    }
    assert.equal(m.profile, 'core');
  });

  test('the plugin-root token is rewritten so scripted skills resolve', () => {
    run('install');
    const skill = read('.claude/skills/promote-lesson/SKILL.md');
    assert.doesNotMatch(skill, /CLAUDE_PLUGIN_ROOT/,
      'that token only substitutes for plugin installs, not copied ones');
    assert.match(skill, /\$\{CLAUDE_PROJECT_DIR\}\/\.claude\/harness\/scripts\/vault\.mjs/);
    assert.ok(existsSync(p('.claude/harness/scripts/vault.mjs')), 'the script travelled with it');
  });

  test('a rewritten file is not reported as locally edited afterwards', () => {
    run('install');
    const r = run('status');
    assert.match(r.out, /0 locally edited/, 'hashes must be taken on the transformed bytes');
  });

  test('--dry-run writes nothing at all', () => {
    const r = run('install', '--profile', 'full', '--dry-run');
    assert.equal(r.code, 0);
    assert.match(r.out, /nothing was written/);
    assert.deepEqual(readdirSync(proj), ['main.py']);
  });

  test('update KEEPS the installed profile instead of silently downgrading it', () => {
    // Found in a real project: a `full` install came back as `core` after an
    // update, with both stack packs deleted. parseArgs defaults profile to
    // 'core', so `opts.profile ?? manifest.profile` never fell through.
    run('install', '--profile', 'full');
    assert.ok(skillNames().includes('stateful-markers'), 'packs present before update');
    run('update');
    assert.equal(manifest().profile, 'full', 'update must not change the profile');
    assert.ok(skillNames().includes('stateful-markers'), 'backend pack survived the update');
    assert.ok(skillNames().includes('loading-and-empty'), 'frontend pack survived the update');
  });

  test('update DOES change the profile when one is explicitly passed', () => {
    run('install', '--profile', 'full');
    run('update', '--profile', 'core');
    assert.equal(manifest().profile, 'core');
    assert.ok(!skillNames().includes('stateful-markers'), 'explicit downgrade still works');
  });

  test('update re-reads the local checkout without a network fetch', () => {
    run('install');
    rmSync(p('.claude/skills/handoff/SKILL.md'));
    const r = run('update');
    assert.match(r.out, /local checkout, no download/);
    assert.ok(existsSync(p('.claude/skills/handoff/SKILL.md')));
  });
});
