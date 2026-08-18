#!/usr/bin/env node
/**
 * Reports the listing cost: total characters of every skill description.
 *
 * The description listing is paid on every session, so it is the budget that
 * actually matters. Bodies are paid only when invoked; descriptions are paid
 * always. This script is the number Phase 4 reports after each batch.
 *
 * Also flags description pairs similar enough that Claude would route between
 * them badly — two skills Claude cannot tell apart are worse than one skill,
 * because the wrong one loads and its body stays resident for the session.
 *
 * Usage: node scripts/listing-cost.mjs [--json] [--threshold 0.4]
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const threshold = Number(args[args.indexOf('--threshold') + 1]) || 0.4;

/** Minimal frontmatter reader — name and description only. */
function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z-]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

async function findSkills(dir, group) {
  const found = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      found.push(...(await findSkills(full, group)));
    } else if (e.name === 'SKILL.md') {
      const text = await readFile(full, 'utf8');
      const fm = frontmatter(text);
      const userOnly = /^(true|yes|on|1)$/i.test(fm['disable-model-invocation'] ?? '');
      found.push({
        group,
        name: fm.name ?? path.basename(dir),
        description: fm.description ?? '',
        // Verified by observation: a skill with disable-model-invocation is not
        // present in the model's skill listing, so it costs no session budget.
        userOnly,
        bodyLines: text.split(/\r?\n/).length,
        file: path.relative(ROOT, full).replace(/\\/g, '/'),
      });
    }
  }
  return found;
}

const STOP = new Set(
  ('a an the and or of to for in on with when use using this that it its is are be by from as at ' +
    'any not no do does did into than then so if before after each every claude').split(' '),
);

const bag = (s) =>
  new Set(
    s.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)),
  );

function jaccard(a, b) {
  const A = bag(a);
  const B = bag(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / (A.size + B.size - shared);
}

const skills = [
  ...(await findSkills(path.join(ROOT, 'skills'), 'core')),
  ...(await findSkills(path.join(ROOT, 'rules'), 'pack')),
].sort((a, b) => a.name.localeCompare(b.name));

const cost = (s) => (s.userOnly ? 0 : s.name.length + s.description.length);
const total = skills.reduce((n, s) => n + cost(s), 0);
const billed = skills.filter((s) => !s.userOnly);

// Only billed skills can collide: user-only skills are never routed between.
const C_RED = (s) => `\x1b[31m${s}\x1b[0m`;
const nearest = [];
for (let i = 0; i < billed.length; i++) {
  for (let j = i + 1; j < billed.length; j++) {
    nearest.push({ a: billed[i].name, b: billed[j].name, score: jaccard(billed[i].description, billed[j].description) });
  }
}
nearest.sort((x, y) => y.score - x.score);
const collisions = nearest.filter((c) => c.score >= threshold);

// Self-check: the comparator must score an identical pair at 1.0. Without this,
// "no collisions" is indistinguishable from a comparator that always returns 0.
const selfCheck = jaccard('Review a diff for correctness bugs', 'Review a diff for correctness bugs');
if (selfCheck !== 1) {
  console.error(`comparator is broken: identical strings scored ${selfCheck}, expected 1`);
  process.exit(2);
}

const missing = skills.filter((s) => !s.description);
const fat = skills.filter((s) => s.bodyLines > 110);

if (asJson) {
  console.log(JSON.stringify({ total, count: skills.length, skills, collisions, missing, fat }, null, 2));
} else {
  console.log(`\nListing cost — paid every session\n${'='.repeat(46)}`);
  for (const s of skills) {
    const tag = [s.group === 'pack' ? '[pack]' : '', s.userOnly ? '[user-only, unbilled]' : ''].filter(Boolean).join(' ');
    console.log(`${String(cost(s)).padStart(4)}  ${s.name}${tag ? ' ' + tag : ''}`);
  }
  console.log('-'.repeat(46));
  console.log(`${String(total).padStart(4)}  TOTAL across ${billed.length} billed skills (${skills.length} on disk)`);
  console.log(`      ~${Math.round(total / 4)} tokens, every session and every subagent\n`);

  if (missing.length) {
    console.log('MISSING DESCRIPTION (invisible to routing):');
    for (const s of missing) console.log(`  ${s.file}`);
    console.log('');
  }
  if (fat.length) {
    console.log('BODY OVER 110 LINES (split reference material into siblings):');
    for (const s of fat) console.log(`  ${String(s.bodyLines).padStart(4)}  ${s.file}`);
    console.log('');
  }
  // Always print the nearest pairs. A threshold that never trips is
  // indistinguishable from a broken comparator, so show the number regardless.
  console.log(`Nearest description pairs (>= ${threshold} = routing hazard):`);
  for (const c of nearest.slice(0, 5)) {
    const flag = c.score >= threshold ? C_RED('  <-- COLLISION') : '';
    console.log(`  ${c.score.toFixed(2)}  ${c.a}  <->  ${c.b}${flag}`);
  }
  console.log(
    collisions.length
      ? `\n  ${collisions.length} pair(s) at or above ${threshold}: rewrite one description to name what the OTHER does not cover.\n`
      : `\n  none at or above ${threshold}.\n`,
  );
}
