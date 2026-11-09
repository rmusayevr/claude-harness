/**
 * The CLAUDE.md block the installer writes into every project.
 *
 * It is loaded every session and again inside every subagent, so it stays
 * small, and every skill it names must exist: a trigger list that names a
 * skill that was renamed sends Claude to nothing. Its markers carry the
 * harness version, which must match the release (0.2.0 markers survived into
 * a 0.3.0 tree once).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const template = readFileSync(path.join(ROOT, 'templates', 'CLAUDE.md.template'), 'utf8');
const version = JSON.parse(readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version;

const skillNames = () => {
  const names = new Set(readdirSync(path.join(ROOT, 'skills')));
  const rules = path.join(ROOT, 'rules');
  for (const stack of existsSync(rules) ? readdirSync(rules) : []) {
    const dir = path.join(rules, stack);
    try { for (const n of readdirSync(dir)) names.add(n); } catch { /* a file, not a pack */ }
  }
  return names;
};

test('the block stays under 80 lines', () => {
  assert.ok(template.trimEnd().split('\n').length < 80, `${template.split('\n').length} lines`);
});

test('its markers carry the release version', () => {
  assert.match(template, new RegExp(`<!-- BEGIN harness v${version.replace(/\./g, '\\.')} -->`));
  assert.match(template, new RegExp(`<!-- END harness v${version.replace(/\./g, '\\.')} -->`));
});

test('every skill the Skills section names exists', () => {
  const section = template.match(/### Skills\n([\s\S]*?)\n### /)?.[1];
  assert.ok(section, 'the block has a Skills section');
  const named = [...section.matchAll(/`([a-z][a-z0-9-]+)`/g)].map((m) => m[1]);
  assert.ok(named.length >= 4, 'it names the situations and their skills');
  const have = skillNames();
  assert.deepEqual(named.filter((n) => !have.has(n)), []);
});

test('the situations are plain words, one skill each', () => {
  const section = template.match(/### Skills\n([\s\S]*?)\n### /)[1];
  const bullets = section.split('\n').filter((l) => l.startsWith('- '));
  for (const b of bullets) assert.equal((b.match(/`[^`]+`/g) ?? []).length, 1, b);
});
