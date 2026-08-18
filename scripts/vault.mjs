#!/usr/bin/env node
/**
 * The lesson vault. Plain Markdown on local disk. No telemetry, no network.
 *
 *   node vault.mjs check   --slug <s> [--project-dir <d>]
 *   node vault.mjs record  --slug <s> --title <t> --layer <l> --body <file>
 *                          [--project-dir <d>] [--project <name>] [--cost <s>]
 *   node vault.mjs list    [--project-dir <d>]
 *   node vault.mjs show    --slug <s> [--project-dir <d>]
 *
 * Layout:
 *   <project>/.claude/lessons/<slug>.md    per-project lesson (the default home)
 *   ~/.claude/harness/lessons/<slug>.md    global vault (graduated lessons only)
 *   ~/.claude/harness/lessons/index.md     the ledger, a Markdown table
 *
 * Graduation rule: a lesson recorded in 2+ DISTINCT projects graduates to the
 * global vault. Occurrence count alone never graduates it — three occurrences in
 * one project is a project-specific problem, and copying it everywhere is how a
 * global vault fills with other people's context.
 *
 * Counting is mechanical, so it lives here rather than in a skill body. The
 * judgment — is this the same lesson, is it worth recording at all — is not
 * mechanical and stays in promote-lesson/SKILL.md.
 */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const VAULT = process.env.HARNESS_VAULT
  ? path.resolve(process.env.HARNESS_VAULT)
  : path.join(os.homedir(), '.claude', 'harness', 'lessons');
const INDEX = path.join(VAULT, 'index.md');

// ------------------------------------------------------------------ args

function parseArgs(argv) {
  const o = { command: argv[0] ?? 'list', projectDir: process.cwd() };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--slug') o.slug = argv[++i];
    else if (a === '--title') o.title = argv[++i];
    else if (a === '--layer') o.layer = argv[++i];
    else if (a === '--body') o.body = argv[++i];
    else if (a === '--cost') o.cost = argv[++i];
    else if (a === '--project') o.project = argv[++i];
    else if (a === '--project-dir') o.projectDir = path.resolve(argv[++i]);
    else if (a === '--json') o.json = true;
  }
  o.project ??= path.basename(o.projectDir);
  return o;
}

const die = (m) => {
  console.error(`error: ${m}`);
  process.exit(1);
};

const slugify = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

// ------------------------------------------------------------------ index

const INDEX_HEADER = `# Lesson index

Local only. Plain Markdown by design — this file is meant to be read in a diff.
A lesson recorded in 2 or more distinct projects graduates to the global vault.

| slug | layer | projects | occurrences | status | sources |
|---|---|---|---|---|---|
`;

async function readIndex() {
  if (!existsSync(INDEX)) return [];
  const text = await readFile(INDEX, 'utf8');
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 5) continue;
    if (cells[0] === 'slug' || /^-+$/.test(cells[0])) continue;
    rows.push({
      slug: cells[0],
      layer: cells[1],
      projects: cells[2] ? cells[2].split(',').map((p) => p.trim()).filter(Boolean) : [],
      occurrences: Number(cells[3]) || 0,
      status: cells[4],
      // Where each project lives, so graduation can gather the EARLIER
      // occurrences instead of shipping only the one that triggered it.
      sources: cells[5] ? cells[5].split(';').map((p) => p.trim()).filter(Boolean) : [],
    });
  }
  return rows;
}

async function writeIndex(rows) {
  await mkdir(VAULT, { recursive: true });
  rows.sort((a, b) => a.slug.localeCompare(b.slug));
  const body = rows
    .map((r) =>
      `| ${r.slug} | ${r.layer} | ${r.projects.join(', ')} | ${r.occurrences} | ${r.status} | ${(r.sources ?? []).join('; ')} |`)
    .join('\n');
  await writeFile(INDEX, INDEX_HEADER + body + '\n', 'utf8');
}

// ------------------------------------------------------------------ lessons

const localPath = (dir, slug) => path.join(dir, '.claude', 'lessons', `${slug}.md`);
const globalPath = (slug) => path.join(VAULT, `${slug}.md`);

function newLesson({ slug, title, layer }) {
  return `---
slug: ${slug}
layer: ${layer}
status: local
---

# ${title}

**Rule:** _(sharpen this as occurrences accumulate — do not add a second bullet
for the same failure; rewrite this line so it covers both.)_

## Occurrences

`;
}

/** Split a lesson into its head (frontmatter, title, Rule) and its occurrences. */
function parseLesson(text) {
  const marker = '## Occurrences';
  const i = text.indexOf(marker);
  if (i === -1) return { head: text.trimEnd(), occurrences: [] };
  const head = text.slice(0, i + marker.length);
  const occurrences = text
    .slice(i + marker.length)
    .split(/\n(?=### )/)
    .map((s) => s.trim())
    .filter(Boolean);
  return { head, occurrences };
}

/**
 * Build the global copy from EVERY project that recorded this lesson.
 *
 * The obvious implementation — copy the local file of whichever project
 * triggered graduation — silently drops the first project's occurrence, which
 * destroys the one property the vault exists to preserve: a rule that failed
 * twice must read as having failed twice.
 */
async function mergeForGlobal(row, fallbackText) {
  let head = null;
  const seen = new Set();
  const all = [];
  for (const dir of row.sources ?? []) {
    const p = localPath(dir, row.slug);
    if (!existsSync(p)) continue;
    const parsed = parseLesson(await readFile(p, 'utf8'));
    head ??= parsed.head;
    for (const occ of parsed.occurrences) {
      if (seen.has(occ)) continue;
      seen.add(occ);
      all.push(occ);
    }
  }
  if (head === null) {
    const parsed = parseLesson(fallbackText);
    head = parsed.head;
    for (const occ of parsed.occurrences) if (!seen.has(occ)) (seen.add(occ), all.push(occ));
  }
  // Chronological by the date in "### YYYY-MM-DD — project".
  all.sort((a, b) => (a.slice(4, 14) < b.slice(4, 14) ? -1 : a.slice(4, 14) > b.slice(4, 14) ? 1 : 0));
  return head.replace(/^status: local$/m, 'status: global') + '\n\n' + all.join('\n\n') + '\n';
}

function occurrenceEntry({ project, cost, body }) {
  const date = new Date().toISOString().slice(0, 10);
  return `### ${date} — ${project}\n\n${body.trim()}\n\n**Cost:** ${cost || '_unstated — a lesson with no named cost is a guess_'}\n\n`;
}

// ------------------------------------------------------------------ commands

async function cmdCheck(o) {
  if (!o.slug) die('check needs --slug');
  const rows = await readIndex();
  const row = rows.find((r) => r.slug === o.slug);
  const local = existsSync(localPath(o.projectDir, o.slug));
  const global_ = existsSync(globalPath(o.slug));

  const result = {
    slug: o.slug,
    known: Boolean(row),
    projects: row?.projects ?? [],
    occurrences: row?.occurrences ?? 0,
    status: row?.status ?? 'new',
    localFile: local ? path.relative(o.projectDir, localPath(o.projectDir, o.slug)) : null,
    globalFile: global_ ? globalPath(o.slug) : null,
    // Near matches let the caller notice "this is the same lesson under a
    // different name" before creating the duplicate the whole design forbids.
    similar: rows
      .filter((r) => r.slug !== o.slug && overlaps(r.slug, o.slug))
      .map((r) => r.slug),
  };

  if (o.json) return console.log(JSON.stringify(result, null, 2));
  if (!result.known) {
    console.log(`"${o.slug}" is NOT recorded.`);
    if (result.similar.length) console.log(`  possible duplicates: ${result.similar.join(', ')}`);
    else console.log(`  no similar slugs in the index.`);
    return;
  }
  console.log(`"${o.slug}" IS already recorded — sharpen it, do not duplicate.`);
  console.log(`  status:      ${result.status}`);
  console.log(`  projects:    ${result.projects.join(', ')} (${result.projects.length})`);
  console.log(`  occurrences: ${result.occurrences}`);
  if (result.localFile) console.log(`  local:       ${result.localFile}`);
  if (result.globalFile) console.log(`  global:      ${result.globalFile}`);
}

const words = (s) => new Set(s.split('-').filter((w) => w.length > 3));
function overlaps(a, b) {
  const A = words(a);
  const B = words(b);
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared >= 2 || (shared >= 1 && Math.min(A.size, B.size) <= 2);
}

async function cmdRecord(o) {
  if (!o.slug) die('record needs --slug');
  if (!o.body) die('record needs --body <file containing the occurrence>');
  if (!existsSync(o.body)) die(`body file not found: ${o.body}`);
  const bodyText = await readFile(o.body, 'utf8');
  if (!bodyText.trim()) die('the occurrence body is empty — a lesson needs the incident that bought it');

  const rows = await readIndex();
  let row = rows.find((r) => r.slug === o.slug);
  const first = !row;
  if (!row) {
    row = { slug: o.slug, layer: o.layer || 'unrouted', projects: [], occurrences: 0, status: 'local' };
    rows.push(row);
  }
  if (o.layer) row.layer = o.layer;

  // Per-project lesson file: create, or append the occurrence.
  const lp = localPath(o.projectDir, o.slug);
  await mkdir(path.dirname(lp), { recursive: true });
  let text = existsSync(lp) ? await readFile(lp, 'utf8') : newLesson({ slug: o.slug, title: o.title || o.slug, layer: row.layer });
  text = text.trimEnd() + '\n\n' + occurrenceEntry({ project: o.project, cost: o.cost, body: bodyText });
  await writeFile(lp, text, 'utf8');

  row.occurrences += 1;
  if (!row.projects.includes(o.project)) row.projects.push(o.project);
  row.sources ??= [];
  if (!row.sources.includes(o.projectDir)) row.sources.push(o.projectDir);

  // Graduation: 2+ DISTINCT projects. Occurrence count is not a substitute.
  let graduated = false;
  const wasGlobal = row.status === 'global';
  if (row.projects.length >= 2) {
    row.status = 'global';
    graduated = !wasGlobal;
    await mkdir(VAULT, { recursive: true });
    // Rebuild from every source each time, so the global copy is always the
    // union of what the projects know rather than a running append.
    await writeFile(globalPath(o.slug), await mergeForGlobal(row, text), 'utf8');
  }

  await writeIndex(rows);

  console.log(`${first ? 'recorded' : 'appended to'} "${o.slug}"`);
  console.log(`  local:       ${path.relative(o.projectDir, lp).split(path.sep).join('/')}`);
  console.log(`  projects:    ${row.projects.join(', ')} (${row.projects.length})`);
  console.log(`  occurrences: ${row.occurrences}`);
  if (graduated) {
    console.log(`  GRADUATED to the global vault — seen in ${row.projects.length} projects`);
    console.log(`  global:      ${globalPath(o.slug)}`);
  } else if (row.projects.length < 2) {
    console.log(`  stays local (needs a 2nd project to graduate)`);
  }
  if (!first) console.log(`  NOTE: second occurrence — sharpen the **Rule:** line, do not add a parallel bullet.`);
}

async function cmdList(o) {
  const rows = await readIndex();
  const localDir = path.join(o.projectDir, '.claude', 'lessons');
  const localFiles = existsSync(localDir) ? (await readdir(localDir)).filter((f) => f.endsWith('.md')) : [];

  if (o.json) return console.log(JSON.stringify({ vault: VAULT, rows, localFiles }, null, 2));
  console.log(`vault: ${VAULT}`);
  console.log(`project: ${o.project} (${localFiles.length} local lesson file(s))\n`);
  if (!rows.length) return console.log('  no lessons recorded yet');
  for (const r of rows) {
    const mark = r.status === 'global' ? 'GLOBAL' : 'local ';
    console.log(`  ${mark}  ${r.slug}  [${r.layer}]  ${r.projects.length} project(s), ${r.occurrences} occurrence(s)`);
  }
  const nearly = rows.filter((r) => r.status !== 'global' && r.projects.length === 1 && r.occurrences >= 2);
  if (nearly.length) {
    console.log(`\n  repeated within one project (NOT grounds for graduation):`);
    for (const r of nearly) console.log(`    ${r.slug} — ${r.occurrences}x in ${r.projects[0]}`);
  }
}

async function cmdShow(o) {
  if (!o.slug) die('show needs --slug');
  for (const p of [localPath(o.projectDir, o.slug), globalPath(o.slug)]) {
    if (existsSync(p)) {
      console.log(`--- ${p} ---\n`);
      console.log(await readFile(p, 'utf8'));
      return;
    }
  }
  die(`no lesson "${o.slug}" locally or in the vault`);
}

// ------------------------------------------------------------------ main

const o = parseArgs(process.argv.slice(2));
const table = { check: cmdCheck, record: cmdRecord, list: cmdList, show: cmdShow };
if (!table[o.command]) die(`unknown command "${o.command}" (check|record|list|show)`);
await table[o.command](o);
