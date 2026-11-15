/**
 * The plugin and a project install both register every harness hook. sual-cavab had both from 9 November,
 * so each hook ran twice: its decisions log counted 86 decisions that were 66, and its usage log
 * counted 94 reviewer runs that were 67. Where a project has its own copy, the plugin's copy must
 * stand down: no decision, no output, no log line.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, symlinkSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOKS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks');
const ALL = ['guard-risky-ops', 'guard-merge', 'guard-prod-ddl', 'guard-review-before-merge', 'harness-usage'];

function run(hook, payload, projectDir) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(HOOKS, `${hook}.mjs`)], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('close', () => resolve(out));
    child.stdin.end(JSON.stringify(payload));
  });
}

/** A loop project, with or without its own copies of the hooks (a placeholder is enough: the file's presence is the signal). */
function project(withOwnCopies) {
  const dir = mkdtempSync(path.join(tmpdir(), 'hook-dup-'));
  mkdirSync(path.join(dir, '.claude', 'hooks'), { recursive: true });
  writeFileSync(path.join(dir, '.claude', 'harness-loop.json'), '{}');
  if (withOwnCopies) for (const h of ALL) writeFileSync(path.join(dir, '.claude', 'hooks', `${h}.mjs`), '// project copy\n');
  return dir;
}

const log = (dir, name) => path.join(dir, '.claude', name);
const FORCE_PUSH = { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git push --force origin main' }, session_id: 's' };
const SKILL = { hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill: 'harness:reproduce-first' }, session_id: 's' };

test('with no project copy the plugin hooks run: the guard decides, and both logs are written', async () => {
  const dir = project(false);
  assert.match(await run('guard-risky-ops', FORCE_PUSH, dir), /deny/);
  await run('harness-usage', SKILL, dir);
  assert.equal(readFileSync(log(dir, 'harness-decisions.log'), 'utf8').trim().split('\n').length, 1);
  assert.equal(readFileSync(log(dir, 'harness-usage.log'), 'utf8').trim().split('\n').length, 1);
});

test('with a project copy, the plugin copy of every hook stands down: no output, no log line', async () => {
  const dir = project(true);
  for (const hook of ALL) assert.equal(await run(hook, hook === 'harness-usage' ? SKILL : FORCE_PUSH, dir), '', hook);
  assert.equal(existsSync(log(dir, 'harness-decisions.log')), false);
  assert.equal(existsSync(log(dir, 'harness-usage.log')), false);
});

test('a project copy is not mistaken for the plugin copy: the hook run from the project decides', async () => {
  const dir = project(false);
  const copy = path.join(dir, '.claude', 'hooks');
  for (const h of ['guard-risky-ops']) writeFileSync(path.join(copy, `${h}.mjs`), readFileSync(path.join(HOOKS, `${h}.mjs`)));
  const out = await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(copy, 'guard-risky-ops.mjs')], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
    let o = '';
    child.stdout.on('data', (d) => (o += d));
    child.on('close', () => resolve(o));
    child.stdin.end(JSON.stringify(FORCE_PUSH));
  });
  assert.match(out, /deny/, `the project's own copy must decide (dir ${dir})`);
});

// macOS keeps temp dirs behind a symlink (/var -> /private/var). A hook compared import.meta.url (resolved)
// with argv[1] (as typed), so launched through a symlink it never ran main() and said nothing: found by CI.
test('a hook launched through a symlinked path still runs', async (t) => {
  const real = mkdtempSync(path.join(tmpdir(), 'hook-real-'));
  const link = path.join(tmpdir(), `hook-link-${path.basename(real)}`);
  try {
    symlinkSync(real, link, 'junction');
  } catch {
    return t.skip('cannot create a symlink here');
  }
  copyFileSync(path.join(HOOKS, 'guard-risky-ops.mjs'), path.join(real, 'guard-risky-ops.mjs'));
  const out = await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(link, 'guard-risky-ops.mjs')], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, CLAUDE_PROJECT_DIR: project(false) } });
    let o = '';
    child.stdout.on('data', (d) => (o += d));
    child.on('close', () => resolve(o));
    child.stdin.end(JSON.stringify(FORCE_PUSH));
  });
  assert.match(out, /deny/);
});
