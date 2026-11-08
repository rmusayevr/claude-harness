/**
 * Model pins only go up. An inline skill's `model` lasts for the rest of the
 * turn, so a `sonnet` or `haiku` pin would downgrade everyone who runs the
 * harness on Opus, for the rest of an unattended loop. See ARCHITECTURE.md,
 * "Model pins only go up".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function frontmatter(file) {
  const m = readFileSync(file, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const out = {};
  for (const line of (m?.[1] ?? '').split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z-]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

function skillFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name === 'SKILL.md')
    .map((e) => path.join(e.parentPath ?? e.path, e.name));
}

test('inline skills pin opus or nothing', () => {
  const bad = [];
  for (const file of [...skillFiles(path.join(ROOT, 'skills')), ...skillFiles(path.join(ROOT, 'rules'))]) {
    const fm = frontmatter(file);
    if (fm.model && fm.context !== 'fork' && !/^(opus|inherit)$/i.test(fm.model)) bad.push(`${path.relative(ROOT, file)}: ${fm.model}`);
  }
  assert.deepEqual(bad, []);
});

test('the pins the docs promise are in place', () => {
  for (const name of ['risky-op', 'review-for-data-loss', 'audit-permissions', 'migrate-data', 'handle-secrets'])
    assert.equal(frontmatter(path.join(ROOT, 'skills', name, 'SKILL.md')).model, 'opus', name);
  assert.equal(frontmatter(path.join(ROOT, 'agents', 'fresh-eyes-reviewer.md')).model, 'opus');
});
