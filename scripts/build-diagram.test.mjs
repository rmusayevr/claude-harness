/**
 * The README diagram is a static copy of the interactive page's <svg>.
 * These tests keep the copy current and keep it safe to show on GitHub,
 * which renders SVG as an image: no scripts, no external fonts or files.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'build-diagram.mjs');

test('the committed SVGs match docs/index.html', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

for (const f of ['how-it-works.svg', 'how-it-works-dark.svg']) {
  test(`${f} is self-contained and draws arrowheads`, () => {
    const svg = readFileSync(path.join(ROOT, 'docs', f), 'utf8');
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.doesNotMatch(svg, /<script|<foreignObject|https?:\/\/(?!www\.w3\.org)/, 'nothing GitHub would strip or block');
    assert.match(svg, /\.edge path\{marker-end:url\(#a\)\}/, 'arrowheads come from CSS, since no script sets them');
    assert.match(svg, /aria-label="[^"]{40,}"/, 'readable without the picture');
  });
}
