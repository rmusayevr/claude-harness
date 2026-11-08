/**
 * Tests for the merge guard.
 *
 * Outside the loop this hook sits on an action people ask for all the time
 * ("merge it"), so the allow cases come first and carry the weight: a green
 * merge into main on request must never prompt. Inside the loop the same
 * hook is the only thing between an unattended agent and `main`, so there the
 * deny cases are the point.
 *
 * GitHub is never called: every test injects the PR lookup.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { decide, checkState, loadConfig } from './guard-merge.mjs';

const HOOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'guard-merge.mjs');

const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });
const LOOP = { base: 'staging', protected: ['main'] };

const ok = { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' };
const skipped = { __typename: 'CheckRun', name: 'deploy-preview', status: 'COMPLETED', conclusion: 'SKIPPED' };
const red = { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' };
const running = { __typename: 'CheckRun', name: 'test', status: 'IN_PROGRESS', conclusion: '' };
const statusOk = { __typename: 'StatusContext', context: 'vercel', state: 'SUCCESS' };
const statusPending = { __typename: 'StatusContext', context: 'vercel', state: 'PENDING' };

const pr = (baseRefName, checks = [ok], number = 42) => () => ({ baseRefName, statusCheckRollup: checks, number });

function expect(command, want, deps, label) {
  const got = decide(bash(command), deps);
  const actual = got ? got.decision : 'allow';
  assert.equal(actual, want, `${label ?? command}\n  wanted: ${want}\n  got: ${actual}${got ? ` (${got.rule})` : ''}`);
  return got;
}

// ===========================================================================
describe('allow — plain conversation (no loop config)', () => {
  const plain = (lookup) => ({ config: null, lookup });

  test('a green merge into main when asked is routine and says nothing', () => {
    expect('gh pr merge 42 --squash', 'allow', plain(pr('main')));
    expect('gh pr merge 42 --merge --delete-branch', 'allow', plain(pr('main', [ok, skipped, statusOk])));
  });

  test('a PR with no checks at all has nothing to wait for', () => {
    expect('gh pr merge 42', 'allow', plain(pr('main', [])));
    expect('gh pr merge 42', 'allow', plain(pr('main', null)));
  });

  test('--auto lets GitHub wait for the checks itself', () => {
    expect('gh pr merge 42 --auto --squash', 'allow', plain(pr('main', [running])));
  });

  test('direct pushes are not this guard’s business outside the loop', () => {
    expect('git push origin main', 'allow', plain(pr('main')));
  });

  test('other gh pr subcommands and lookalikes are ignored', () => {
    const boom = () => { throw new Error('must not be called'); };
    for (const cmd of [
      'gh pr view 42',
      'gh pr checks 42 --watch',
      'gh pr create --base main --title "merge main into feature"',
      'git merge origin/main',
      'echo "gh pr merge 42"',
      'gh pr merge 42 --disable-auto',
    ]) {
      expect(cmd, 'allow', plain(boom), cmd);
    }
  });
});

// ===========================================================================
describe('ask — plain conversation, the merge skips something', () => {
  const plain = (lookup) => ({ config: null, lookup });

  test('failing checks', () => {
    const got = expect('gh pr merge 42 --squash', 'ask', plain(pr('main', [ok, red])));
    assert.equal(got.rule, 'merge-red-checks');
  });

  test('checks still running, from either API shape', () => {
    expect('gh pr merge 42', 'ask', plain(pr('main', [running])));
    expect('gh pr merge 42', 'ask', plain(pr('feature/x', [statusPending])));
  });

  test('--admin bypasses branch protection', () => {
    const boom = () => { throw new Error('must not be called'); };
    const got = expect('gh pr merge 42 --admin --squash', 'ask', plain(boom));
    assert.equal(got.rule, 'merge-admin-bypass');
  });
});

// ===========================================================================
describe('deny — inside the loop', () => {
  const loop = (lookup) => ({ config: LOOP, lookup });

  test('the incident that bought this hook: the loop must never merge into main', () => {
    const got = expect('gh pr merge 42 --merge', 'deny', loop(pr('main')));
    assert.equal(got.rule, 'loop-merge-protected');
    assert.match(got.reason, /staging/, 'names the base the loop is allowed to use');
  });

  test('built-in protected names are protected even if the config forgets them', () => {
    expect('gh pr merge 42', 'deny', { config: { base: 'staging' }, lookup: pr('production') });
  });

  test('a base that is neither protected nor the configured base', () => {
    const got = expect('gh pr merge 42', 'deny', loop(pr('feat/other-20261108')));
    assert.equal(got.rule, 'loop-merge-wrong-base');
  });

  test('red or pending checks are a deny, not a prompt nobody is there to answer', () => {
    expect('gh pr merge 42 --merge', 'deny', loop(pr('staging', [red])));
    expect('gh pr merge 42 --merge', 'deny', loop(pr('staging', [running])));
  });

  test('--admin', () => {
    expect('gh pr merge 42 --admin', 'deny', loop(pr('staging')));
  });

  test('a protected base cannot be made the loop base', () => {
    expect('gh pr merge 42', 'deny', { config: { base: 'main' }, lookup: pr('main') });
  });

  test('pushing straight to the base or a protected branch', () => {
    for (const cmd of [
      'git push origin staging',
      'git push origin HEAD:staging',
      'git push origin HEAD:refs/heads/staging',
      'git push -u origin main',
      'git push origin +feature:staging',
    ]) {
      const got = expect(cmd, 'deny', loop(pr('staging')), cmd);
      assert.equal(got.rule, 'loop-push-to-base');
    }
  });

  test('a merge hidden after other segments is still seen', () => {
    expect('git fetch origin && gh pr merge 42 --merge', 'deny', loop(pr('main')));
  });
});

// ===========================================================================
describe('allow — inside the loop, the ordinary path', () => {
  const loop = (lookup) => ({ config: LOOP, lookup });

  test('a green PR into the configured base merges', () => {
    expect('gh pr merge 42 --merge', 'allow', loop(pr('staging')));
    expect('gh pr merge 42 --merge', 'allow', loop(pr('staging', [ok, skipped, statusOk])));
  });

  test('--auto into the base is fine while checks run', () => {
    expect('gh pr merge 42 --auto --merge', 'allow', loop(pr('staging', [running])));
  });

  test('feature-branch pushes are the normal loop', () => {
    for (const cmd of [
      'git push -u origin HEAD',
      'git push -u origin feat/order-export-20261108',
      'git push origin feat/staging-banner-20261108',
      'git push',
    ]) {
      expect(cmd, 'allow', loop(pr('staging')), cmd);
    }
  });
});

// ===========================================================================
describe('the PR lookup', () => {
  test('passes the PR and --repo through, not flag values', () => {
    let seen;
    const spy = (args) => { seen = args; return { baseRefName: 'staging', statusCheckRollup: [ok], number: 7 }; };
    decide(bash('gh pr merge 7 --repo acme/app --subject "merge 99" -b "body text" --merge'), { config: LOOP, lookup: spy });
    assert.deepEqual(seen, ['7', '--repo', 'acme/app']);
  });

  test('no PR named: looks up the current branch’s PR', () => {
    let seen;
    const spy = (args) => { seen = args; return { baseRefName: 'staging', statusCheckRollup: [], number: 7 }; };
    decide(bash('gh pr merge --merge'), { config: LOOP, lookup: spy });
    assert.deepEqual(seen, []);
  });

  test('a preceding cd changes where gh runs', () => {
    let cwd;
    const spy = (_a, c) => { cwd = c; return { baseRefName: 'staging', statusCheckRollup: [], number: 1 }; };
    decide(bash('cd backend && gh pr merge 1'), { config: LOOP, lookup: spy, cwd: path.resolve('/repo') });
    assert.equal(cwd, path.resolve('/repo/backend'));
  });

  test('check states', () => {
    assert.equal(checkState([ok, skipped, statusOk]), 'green');
    assert.equal(checkState([ok, running]), 'pending');
    assert.equal(checkState([running, red]), 'failing', 'failing wins over pending');
    assert.equal(checkState([{ __typename: 'StatusContext', state: 'ERROR' }]), 'failing');
    assert.equal(checkState(undefined), 'green');
  });
});

// ===========================================================================
describe('config', () => {
  test('read from .claude/harness-loop.json, BOM tolerated, junk ignored', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'guard-merge-'));
    try {
      assert.equal(loadConfig(dir), null, 'absent -> no loop');
      mkdirSync(path.join(dir, '.claude'));
      const f = path.join(dir, '.claude', 'harness-loop.json');
      writeFileSync(f, '﻿{"base":"staging"}');
      assert.deepEqual(loadConfig(dir), { base: 'staging' });
      writeFileSync(f, '{"base": ""}');
      assert.equal(loadConfig(dir), null, 'no base -> no loop');
      writeFileSync(f, '{not json');
      assert.equal(loadConfig(dir), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
describe('fail open', () => {
  test('gh failing or answering nonsense yields no decision', () => {
    const throws = () => { throw new Error('gh: not found'); };
    expect('gh pr merge 42', 'allow', { config: LOOP, lookup: throws });
    expect('gh pr merge 42', 'allow', { config: LOOP, lookup: () => ({}) });
    expect('gh pr merge 42', 'allow', { config: LOOP, lookup: () => null });
  });

  test('malformed payloads yield no decision', () => {
    for (const p of [null, undefined, {}, 42, [], { tool_name: 'Bash' }, { tool_name: 'Bash', tool_input: {} },
      { tool_name: 'Write', tool_input: { file_path: 'x' } }]) {
      assert.equal(decide(p, { config: LOOP, lookup: pr('main') }), null, JSON.stringify(p));
    }
  });
});

// ===========================================================================
function runHook(stdin, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [HOOK], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env } });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ code, out }));
    child.stdin.end(stdin);
  });
}

describe('process contract', () => {
  test('a loop push to base denies with the PreToolUse envelope and logs it', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'guard-merge-'));
    try {
      mkdirSync(path.join(dir, '.claude'));
      writeFileSync(path.join(dir, '.claude', 'harness-loop.json'), '{"base":"staging"}');
      const { code, out } = await runHook(JSON.stringify(bash('git push origin staging')), { CLAUDE_PROJECT_DIR: dir });
      assert.equal(code, 0);
      const parsed = JSON.parse(out);
      assert.equal(parsed.hookSpecificOutput.permissionDecision, 'deny');
      assert.match(parsed.hookSpecificOutput.permissionDecisionReason, /^\[harness:loop-push-to-base\]/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('garbage stdin exits 0 silently', async () => {
    const { code, out } = await runHook('not json', {});
    assert.equal(code, 0);
    assert.equal(out, '');
  });
});
