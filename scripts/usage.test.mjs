/**
 * The usage report: counts only harness skills, splits auto from typed,
 * lists what was never used, and survives an empty or damaged log.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'usage.mjs');

function report(lines) {
  const dir = mkdtempSync(path.join(tmpdir(), 'harness-usage-report-'));
  try {
    if (lines) {
      mkdirSync(path.join(dir, '.claude'));
      writeFileSync(path.join(dir, '.claude', 'harness-usage.log'), lines.join('\n') + '\n');
    }
    const r = spawnSync(process.execPath, [SCRIPT, '--project-dir', dir, '--json'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const e = (skill, via, ts, session = 's1') => JSON.stringify({ ts, skill, via, session });

test('counts harness skills, ignores other slash commands and broken lines', () => {
  const r = report([
    e('reproduce-first', 'auto', '2026-11-01T10:00:00Z'),
    e('reproduce-first', 'auto', '2026-11-03T10:00:00Z', 's2'),
    e('start', 'typed', '2026-11-04T10:00:00Z', 's2'),
    e('model', 'typed', '2026-11-04T10:01:00Z', 's2'),
    '{not json',
  ]);
  assert.equal(r.uses, 3, '/model is Claude Code\'s, not ours');
  assert.equal(r.sessions, 2);
  assert.deepEqual(r.used.map((u) => [u.skill, u.auto, u.typed]), [['reproduce-first', 2, 0], ['start', 0, 1]]);
  assert.ok(r.never.some((n) => n.skill === 'write-an-adr' && n.slashOnly), 'never-used lists slash-only ones as such');
  assert.ok(r.never.some((n) => n.skill === 'stateful-markers' && n.group === 'backend'), 'stack packs are included');
  assert.ok(!r.never.some((n) => n.skill === 'reproduce-first'));
});

test('no log yet is an empty report, not a crash', () => {
  const r = report(null);
  assert.equal(r.uses, 0);
  assert.ok(r.never.length > 40);
});
