#!/usr/bin/env node
/**
 * Which harness skills are actually used in a project.
 *
 *   node scripts/usage.mjs [--project-dir <dir>] [--json]
 *
 * Reads `.claude/harness-usage.log`, written by hooks/harness-usage.mjs.
 * Counts per skill, split into "auto" (Claude loaded it) and "typed" (a
 * person ran the slash command), plus the harness skills never used.
 *
 * The never-used list is the point: the listing costs every session, and a
 * skill that has not loaded in months of real work is the first candidate
 * to cut or make slash-only. A short log proves little; say how long it
 * covers before drawing conclusions from it.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const project = path.resolve(flag('--project-dir') ?? process.cwd());
const asJson = args.includes('--json');

// Skills this harness ships: plugin layout (skills/, rules/<stack>/) or an
// installed copy (.claude/skills/, where the script lives in .claude/harness/scripts).
function shipped() {
  const out = new Map();
  const add = (dir, group) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const name = e.name;
      const f = path.join(dir, name, 'SKILL.md');
      if (!existsSync(f)) continue;
      const fm = readFileSync(f, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
      out.set(name, { group, slashOnly: /disable-model-invocation:\s*true/.test(fm) });
    }
  };
  add(path.join(ROOT, 'skills'), 'core');
  if (existsSync(path.join(ROOT, 'rules')))
    for (const e of readdirSync(path.join(ROOT, 'rules'), { withFileTypes: true }))
      if (e.isDirectory()) add(path.join(ROOT, 'rules', e.name), e.name);
  if (!out.size) add(path.resolve(ROOT, '..', 'skills'), 'core'); // installed copy
  // Agents ship as agents/<name>.md and are logged as agent:<name>.
  for (const dir of [path.join(ROOT, 'agents'), path.resolve(ROOT, '..', 'agents')]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) if (f.endsWith('.md')) out.set(`agent:${f.slice(0, -3)}`, { group: 'agent', slashOnly: false });
  }
  return out;
}

const skills = shipped();
const logPath = path.join(project, '.claude', 'harness-usage.log');
const entries = existsSync(logPath)
  ? readFileSync(logPath, 'utf8').split('\n').filter(Boolean).flatMap((l) => {
      try { return [JSON.parse(l)]; } catch { return []; }
    })
  : [];

// Typed slash commands include Claude Code's own (/model, /clear); keep ours.
const ours = entries.filter((e) => skills.has(e.skill));
const counts = new Map();
for (const e of ours) {
  const c = counts.get(e.skill) ?? { auto: 0, typed: 0, last: '' };
  c[e.via === 'typed' ? 'typed' : 'auto']++;
  if (e.ts > c.last) c.last = e.ts;
  counts.set(e.skill, c);
}
const used = [...counts].map(([skill, c]) => ({ skill, ...c, total: c.auto + c.typed })).sort((a, b) => b.total - a.total);
const never = [...skills].filter(([n]) => !counts.has(n)).map(([n, s]) => ({ skill: n, ...s }));
const first = ours.reduce((m, e) => (!m || e.ts < m ? e.ts : m), '');
const last = ours.reduce((m, e) => (e.ts > m ? e.ts : m), '');
const sessions = new Set(ours.map((e) => e.session).filter(Boolean)).size;

if (asJson) {
  console.log(JSON.stringify({ log: logPath, uses: ours.length, sessions, first, last, used, never }, null, 2));
  process.exit(0);
}

if (!entries.length) {
  console.log(`No usage recorded yet in ${logPath}.`);
  console.log('The harness-usage hook writes it as skills load; check back after some real work.');
  process.exit(0);
}

const day = (ts) => (ts ? ts.slice(0, 10) : '');
console.log(`\nHarness usage — ${project}`);
console.log(`${ours.length} uses in ${sessions} session(s), ${day(first)} to ${day(last)}\n`);
console.log('  total  auto  typed  last used   skill');
for (const u of used)
  console.log(`  ${String(u.total).padStart(5)} ${String(u.auto).padStart(5)} ${String(u.typed).padStart(6)}  ${day(u.last)}  ${u.skill}`);

const neverAuto = never.filter((n) => !n.slashOnly);
console.log(`\nNever used: ${never.length} of ${skills.size}`);
if (neverAuto.length)
  console.log(`  in the listing (paid every session): ${neverAuto.map((n) => n.skill).join(', ')}`);
const neverSlash = never.filter((n) => n.slashOnly);
if (neverSlash.length) console.log(`  slash-only (cost nothing): ${neverSlash.map((n) => n.skill).join(', ')}`);
console.log('\nA few weeks of real work says more than a few days. Cut on a long log, not a short one.\n');
