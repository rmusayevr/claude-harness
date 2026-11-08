/**
 * Tests for the usage recorder.
 *
 * It must never speak (stdout on UserPromptSubmit lands in Claude's context),
 * never record prompt text, and never fail a call. What it records has to be
 * a skill name and nothing else.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { usage } from './harness-usage.mjs';

const HOOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'harness-usage.mjs');
const skill = (s) => ({ hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill: s } });
const typed = (prompt) => ({ hook_event_name: 'UserPromptSubmit', prompt });

describe('records', () => {
  test('a skill Claude loads, with or without the plugin namespace', () => {
    assert.deepEqual(usage(skill('harness:reproduce-first')), { skill: 'reproduce-first', via: 'auto' });
    assert.deepEqual(usage(skill('reproduce-first')), { skill: 'reproduce-first', via: 'auto' });
  });

  test('a slash command a person types, and only its name', () => {
    assert.deepEqual(usage(typed('/harness:start')), { skill: 'start', via: 'typed' });
    assert.deepEqual(usage(typed('/harness:map-subsystem billing and invoices')), { skill: 'map-subsystem', via: 'typed' });
    assert.deepEqual(usage(typed('  /write-an-adr')), { skill: 'write-an-adr', via: 'typed' });
  });
});

describe('ignores', () => {
  test('ordinary prompts and other tools', () => {
    for (const p of [
      typed('fix the bug in /src/app.ts'),
      typed('what does /harness:start do?'),
      typed('path/like/this'),
      typed(''),
      { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } },
      { hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill: '../../etc/passwd' } },
      { hook_event_name: 'PostToolUse', tool_name: 'Skill', tool_input: { skill: 'x' } },
    ]) {
      assert.equal(usage(p), null, JSON.stringify(p));
    }
  });

  test('malformed payloads', () => {
    for (const p of [null, undefined, {}, 42, [], { hook_event_name: 'UserPromptSubmit' }, { tool_name: 'Skill' }]) {
      assert.equal(usage(p), null, JSON.stringify(p));
    }
  });
});

function run(payload, dir) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [HOOK], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ code, out }));
    child.stdin.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
  });
}

describe('process contract', () => {
  test('writes one line, prints nothing, exits 0', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'harness-usage-'));
    try {
      mkdirSync(path.join(dir, '.claude'));
      const a = await run(typed('/harness:start please, my secret plan'), dir);
      const b = await run(skill('harness:reproduce-first'), dir);
      for (const r of [a, b]) {
        assert.equal(r.code, 0);
        assert.equal(r.out, '', 'stdout would be injected into context');
      }
      const lines = readFileSync(path.join(dir, '.claude', 'harness-usage.log'), 'utf8').trim().split('\n').map(JSON.parse);
      assert.deepEqual(lines.map((l) => [l.skill, l.via]), [['start', 'typed'], ['reproduce-first', 'auto']]);
      assert.doesNotMatch(JSON.stringify(lines), /secret plan/, 'prompt text is never stored');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('garbage in, or no .claude directory: still silent and exit 0', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'harness-usage-'));
    try {
      for (const r of [await run('not json', dir), await run(skill('start'), dir)]) {
        assert.equal(r.code, 0);
        assert.equal(r.out, '');
      }
      assert.equal(existsSync(path.join(dir, '.claude', 'harness-usage.log')), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
