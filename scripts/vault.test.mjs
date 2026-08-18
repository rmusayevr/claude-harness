/**
 * Tests for the lesson vault.
 *
 * The graduation rule is the thing worth testing: 2+ DISTINCT projects, never
 * occurrence count. A vault that graduates on repetition within one project
 * fills the global vault with one project's context, which is the failure mode
 * that makes a cross-project vault worse than no vault.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VAULT_CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'vault.mjs');
let root, vault, projA, projB, bodyFile;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'harness-vault-'));
  vault = path.join(root, 'vault');
  projA = path.join(root, 'acme-api');
  projB = path.join(root, 'beta-svc');
  mkdirSync(projA, { recursive: true });
  mkdirSync(projB, { recursive: true });
  bodyFile = path.join(root, 'occurrence.md');
  writeFileSync(bodyFile, 'CS-64 shipped a Redis marker with no TTL; the queue stalled for 3h.');
});

function vaultRun(args) {
  const r = spawnSync(process.execPath, [VAULT_CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, HARNESS_VAULT: vault },
  });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}

const record = (dir, slug, extra = []) =>
  vaultRun(['record', '--slug', slug, '--title', 'Markers need a TTL', '--layer', 'skill:stateful-markers',
    '--body', bodyFile, '--project-dir', dir, ...extra]);

describe('graduation', () => {
  test('one project, one occurrence stays local', () => {
    const r = record(projA, 'markers-need-ttl');
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /stays local/);
    assert.ok(existsSync(path.join(projA, '.claude/lessons/markers-need-ttl.md')), 'local lesson written');
    assert.ok(!existsSync(path.join(vault, 'markers-need-ttl.md')), 'must NOT be in the global vault');
  });

  test('THREE occurrences in ONE project still do not graduate', () => {
    record(projA, 'markers-need-ttl');
    record(projA, 'markers-need-ttl');
    const r = record(projA, 'markers-need-ttl');
    assert.match(r.out, /occurrences: 3/);
    assert.match(r.out, /stays local/);
    assert.ok(!existsSync(path.join(vault, 'markers-need-ttl.md')),
      'repetition within one project is a project problem, not a global lesson');
  });

  test('a second DISTINCT project graduates it', () => {
    record(projA, 'markers-need-ttl');
    const r = record(projB, 'markers-need-ttl');
    assert.match(r.out, /GRADUATED/);
    assert.match(r.out, /projects:\s+acme-api, beta-svc \(2\)/);
    assert.ok(existsSync(path.join(vault, 'markers-need-ttl.md')), 'global copy written');
    assert.match(readFileSync(path.join(vault, 'markers-need-ttl.md'), 'utf8'), /^status: global$/m);
  });

  test('the graduated lesson carries BOTH projects occurrences, not just the trigger', () => {
    const a = path.join(root, 'body-a.md');
    const b = path.join(root, 'body-b.md');
    writeFileSync(a, 'CS-64 in acme-api: lock with no TTL, queue stalled.');
    writeFileSync(b, 'Different service: processing flag cleared only in finally, 400 rows stuck.');
    vaultRun(['record', '--slug', 'm', '--title', 'T', '--layer', 'l', '--body', a, '--project-dir', projA]);
    vaultRun(['record', '--slug', 'm', '--title', 'T', '--layer', 'l', '--body', b, '--project-dir', projB]);

    const global_ = readFileSync(path.join(vault, 'm.md'), 'utf8');
    assert.match(global_, /CS-64 in acme-api/, "first project's occurrence must survive graduation");
    assert.match(global_, /400 rows stuck/, "triggering project's occurrence must be present");
    assert.equal((global_.match(/^### /gm) ?? []).length, 2, 'exactly two occurrence entries');
    assert.match(global_, /acme-api/);
    assert.match(global_, /beta-svc/);
  });

  test('a third occurrence does not duplicate the earlier ones in the global copy', () => {
    const a = path.join(root, 'body-a.md');
    writeFileSync(a, 'occurrence text alpha');
    vaultRun(['record', '--slug', 'm', '--title', 'T', '--layer', 'l', '--body', a, '--project-dir', projA]);
    vaultRun(['record', '--slug', 'm', '--title', 'T', '--layer', 'l', '--body', a, '--project-dir', projB]);
    vaultRun(['record', '--slug', 'm', '--title', 'T', '--layer', 'l', '--body', a, '--project-dir', projB]);
    const global_ = readFileSync(path.join(vault, 'm.md'), 'utf8');
    assert.equal((global_.match(/^# /gm) ?? []).length, 1, 'one title');
    assert.ok((global_.match(/^### /gm) ?? []).length >= 2, 'history preserved');
  });

  test('graduating twice does not re-announce or duplicate the row', () => {
    record(projA, 'markers-need-ttl');
    record(projB, 'markers-need-ttl');
    const r = record(projB, 'markers-need-ttl');
    assert.doesNotMatch(r.out, /GRADUATED/, 'already global');
    const index = readFileSync(path.join(vault, 'index.md'), 'utf8');
    const rows = index.split('\n').filter((l) => l.includes('markers-need-ttl'));
    assert.equal(rows.length, 1, 'exactly one index row per slug');
  });
});

describe('duplicate prevention', () => {
  test('check reports an unknown slug as new, with no false certainty', () => {
    const r = vaultRun(['check', '--slug', 'something-new', '--project-dir', projA]);
    assert.match(r.out, /is NOT recorded/);
  });

  test('check on a known slug says sharpen, not duplicate', () => {
    record(projA, 'markers-need-ttl');
    const r = vaultRun(['check', '--slug', 'markers-need-ttl', '--project-dir', projA]);
    assert.match(r.out, /IS already recorded/);
    assert.match(r.out, /sharpen it, do not duplicate/);
  });

  test('check surfaces near-miss slugs so a renamed duplicate is caught', () => {
    record(projA, 'redis-markers-need-ttl');
    const r = vaultRun(['check', '--slug', 'redis-markers-always-ttl', '--project-dir', projA, '--json']);
    assert.deepEqual(JSON.parse(r.out).similar, ['redis-markers-need-ttl']);
  });

  test('a second occurrence tells the caller to sharpen the existing rule', () => {
    record(projA, 'markers-need-ttl');
    const r = record(projA, 'markers-need-ttl');
    assert.match(r.out, /second occurrence — sharpen/);
    assert.match(r.out, /do not add a parallel bullet/);
  });

  test('both occurrences land in one file, not two files', () => {
    record(projA, 'markers-need-ttl');
    record(projA, 'markers-need-ttl');
    const text = readFileSync(path.join(projA, '.claude/lessons/markers-need-ttl.md'), 'utf8');
    assert.equal((text.match(/^### /gm) ?? []).length, 2, 'two occurrence entries');
    assert.equal((text.match(/^# /gm) ?? []).length, 1, 'one lesson, one title');
  });
});

describe('refusing empty provenance', () => {
  test('an empty occurrence body is rejected', () => {
    const empty = path.join(root, 'empty.md');
    writeFileSync(empty, '   \n');
    const r = vaultRun(['record', '--slug', 'x', '--body', empty, '--project-dir', projA]);
    assert.equal(r.code, 1);
    assert.match(r.err, /needs the incident that bought it/);
  });

  test('a missing body file is rejected rather than recorded blank', () => {
    const r = vaultRun(['record', '--slug', 'x', '--body', path.join(root, 'nope.md'), '--project-dir', projA]);
    assert.equal(r.code, 1);
    assert.match(r.err, /body file not found/);
  });

  test('an unstated cost is recorded as unstated, not silently omitted', () => {
    record(projA, 'markers-need-ttl');
    const text = readFileSync(path.join(projA, '.claude/lessons/markers-need-ttl.md'), 'utf8');
    assert.match(text, /a lesson with no named cost is a guess/);
  });
});

describe('the index is inspectable markdown', () => {
  test('index is a readable table, not an opaque blob', () => {
    record(projA, 'markers-need-ttl', ['--cost', '3h incident']);
    const index = readFileSync(path.join(vault, 'index.md'), 'utf8');
    assert.match(index, /\| slug \| layer \| projects \| occurrences \| status \| sources \|/);
    assert.match(index, /\| markers-need-ttl \| skill:stateful-markers \| acme-api \| 1 \| local \|/);
    assert.doesNotMatch(index, /\{|\}/, 'no JSON — this file is meant to be read in a diff');
  });

  test('the table round-trips through a second write without corruption', () => {
    record(projA, 'a-lesson-one');
    record(projB, 'b-lesson-two');
    record(projA, 'c-lesson-three');
    const r = vaultRun(['list', '--project-dir', projA, '--json']);
    const rows = JSON.parse(r.out).rows;
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((x) => x.slug), ['a-lesson-one', 'b-lesson-two', 'c-lesson-three']);
  });
});
