/**
 * The loop names skills at the steps where they matter, and only skills it
 * names reliably fire (sual-cavab, day one). A name that outlives its skill
 * sends Claude to nothing, so every skill the loop names must exist and must
 * still appear in the loop. The design skill also ships a DESIGN.md skeleton
 * its body points at, and the loop must park a UI issue that waits on the
 * owner's pick instead of stopping everything (a fresh-eyes review of the
 * first version found it stopped the loop on any UI change).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
const loop = read('skills', 'work-the-queue', 'SKILL.md');
const design = read('skills', 'design-direction', 'SKILL.md');

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

test('UI work is parked, not a stop, until the owner picks; a one-element fix is not UI work', () => {
  const bullet = loop.match(/- UI work[\s\S]*?(?=\n- )/)?.[0] ?? '';
  assert.match(bullet, /`design-direction`/);
  assert.match(bullet, /park every\s+UI issue waiting on the pick/);
  assert.match(bullet, /the rest of the queue goes on/);
  assert.match(bullet, /not copy, a bug, or a one-element fix/);
  assert.match(loop, /a design file or pick\) and blocks/, 'the park rule names a design pick');
  const stops = loop.match(/## Stop and ask only for[\s\S]*$/)[0];
  assert.doesNotMatch(stops, /visual direction/, 'parked, not a stop');
});

test('design-direction ships the DESIGN.md skeleton its body names', () => {
  const template = 'design.template.md';
  assert.ok(design.includes(`\`${template}\``), 'the body names its template');
  const skeleton = read('skills', 'design-direction', template);
  for (const heading of ['## Direction', '## Tokens', '## Layout', '## Components and their states', '## Voice', "## Don't"])
    assert.ok(skeleton.includes(heading), `the skeleton lacks ${heading}`);
  assert.match(skeleton, /--bg:/);
  assert.match(skeleton, /--status-open-ink:/, 'a text and background pair per status, not good/warn/bad');
  assert.match(skeleton, /prefers-color-scheme: dark/);
});

test('design-direction: three directions, the owner picks, an existing look is written down, a rendered check', () => {
  assert.match(design, /Three directions that differ in kind/);
  assert.match(design, /## 4\. The owner picks/);
  assert.match(design, /\*\*A look already exists\*\*/);
  assert.match(design, /do not offer new directions/);
  assert.match(design, /400 px and 1280 px/);
  assert.match(design, /4\.5:1/);
  assert.match(design, /At the \*\*repo root\*\*/);
  assert.match(design, /above the harness block and not inside it/);
});

test("the skill's description does not claim all UI work, and stays short", () => {
  const desc = design.match(/description: (.*)/)[1];
  assert.match(desc, /not for a copy fix or a one-element tweak/);
  assert.ok(desc.length < 260, `it is already the longest in the listing (${desc.length} characters)`);
});
