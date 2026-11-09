/**
 * The loop names skills at the steps where they matter, and only skills it
 * names reliably fire (sual-cavab, day one). A name that outlives its skill
 * sends Claude to nothing, so every skill the loop names must exist and must
 * still appear in the loop. The design skill also ships a DESIGN.md skeleton
 * its body points at.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
const loop = read('skills', 'work-the-queue', 'SKILL.md');

const NAMED = [
  'review-a-dependency', 'audit-permissions', 'migrate-data', 'review-for-data-loss', 'scope-change', 'design-a-test',
  'verify-for-real', 'write-commit', 'read-your-own-diff', 'triage-review', 'handoff', 'design-direction',
];

test('every skill the loop names exists, and the loop still names it', () => {
  for (const name of NAMED) {
    assert.ok(existsSync(path.join(ROOT, 'skills', name, 'SKILL.md')), `${name} has no SKILL.md`);
    assert.ok(loop.includes(`\`${name}\``), `work-the-queue no longer names ${name}`);
  }
});

test('UI work goes through design-direction, and the owner picks the direction', () => {
  assert.match(loop, /UI work: with `DESIGN\.md`, follow it\. Without one, run `design-direction`/);
  assert.match(loop, /a visual direction/, 'a visual direction is on the stop list');
});

test('design-direction ships the DESIGN.md skeleton its body names', () => {
  const body = read('skills', 'design-direction', 'SKILL.md');
  const template = 'design.template.md';
  assert.ok(body.includes(`\`${template}\``), 'the body names its template');
  const skeleton = read('skills', 'design-direction', template);
  for (const heading of ['## Direction', '## Tokens', '## Layout', '## Components and their states', '## Voice', "## Don't"])
    assert.ok(skeleton.includes(heading), `the skeleton lacks ${heading}`);
  assert.match(skeleton, /--bg:/);
  assert.match(skeleton, /prefers-color-scheme: dark/);
});

test('design-direction asks for three directions, an owner pick, and a look at the rendered screen', () => {
  const body = read('skills', 'design-direction', 'SKILL.md');
  assert.match(body, /Three directions that differ in kind/);
  assert.match(body, /The owner picks: stop/);
  assert.match(body, /400 px and 1280 px/);
  assert.match(body, /4\.5:1/);
});
