#!/usr/bin/env node
/**
 * PreToolUse guard: what an agent may merge, and where it may push.
 *
 * Bought by a client web project, where Claude ran an autonomous issue -> PR ->
 * review -> merge loop for a week. The standing rule was "merge only into staging, only on green
 * CI, never main", and it lived in a pasted prompt and a memory note. Prose is a
 * request; whether `gh pr merge` targets `main` or merges over a red check is
 * decidable from GitHub, so it belongs here.
 *
 * Two modes, chosen by whether `.claude/harness-loop.json` exists:
 *
 *   No loop config (plain conversation). Merging when asked is routine, so a
 *   green merge says nothing. `ask` only when the merge skips something:
 *   failing or pending checks, or `--admin` (bypasses branch protection).
 *
 *   Loop config present (`/work-the-queue`). Nobody is watching, and `ask` is a
 *   hard block or a silent allow depending on the permission mode (see
 *   ARCHITECTURE.md in the harness repo), so every rule is a `deny`:
 *     - the PR's base is a protected branch, or is not the configured `base`
 *     - checks are failing, or pending without `--auto`
 *     - `--admin`
 *     - `git push` straight to the base or a protected branch (work lands
 *       through a reviewed PR, or it does not land)
 *
 * The PR's base and checks are not in the command, so this hook asks `gh`.
 * That is a network call, made only for a `gh pr merge` segment, with a
 * timeout under the hook's own. It is the only way the rule is decidable.
 *
 * FAIL OPEN, like every hook here: `gh` missing, unauthenticated, slow, or
 * returning something unexpected -> no decision. The loop skill also checks
 * before it merges; this hook is the guarantee for the case where it did not.
 */
import { pathToFileURL } from 'node:url';
import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

// ---------------------------------------------------------------- helpers
// Duplicated from guard-risky-ops on purpose: hooks install as independent
// files, and a shared module is one more thing that can be missing.

const unquote = (t) => t.replace(/^['"]|['"]$/g, '');

/**
 * Split a shell command into the segments that run independently: on `&&`,
 * `||`, `;`, `|`, a lone `&` and newlines, outside quotes.
 *
 * What it understands, and why each one is here:
 * - Quotes. Text inside quotes is not a command, so a `.env` path in a quoted
 *   loop list is not judged as a write (sual-cavab PR #13).
 * - Comments. `#` at the start of a word runs to the end of the line, so the
 *   apostrophe in `# don't` does not open a quote that swallows every later
 *   line (sual-cavab PR #16).
 * - Heredocs. A body fed to `cat` or `node` is data and is skipped; a body
 *   fed to a shell (`bash <<EOF`) is commands and is checked.
 * - Arithmetic. `<<` inside `$(( ))` is a shift, not a heredoc.
 * - Nested commands. The string after `bash -c`, `sh -c`, `su -c`, `eval` or
 *   `ssh host` is a command too, so it is split and returned as well. So is
 *   the inside of `( )`, `{ }` and `$( )`.
 * - Keywords. `then`, `do`, `else`, `!`, `time` and friends are dropped from
 *   the front of a segment, so `then rm -rf ~` is seen as `rm -rf ~`.
 *
 * Not understood, so not checked: backtick substitutions, commands
 * assembled from variables, and scripts that do the work themselves. That
 * under-blocks, like every other undecidable case here.
 */
const SHELL = /^\s*(?:sudo\s+)?(?:[\w./-]*\/)?(?:bash|sh|zsh|dash|ksh)\b/;
const KEYWORDS = /^(?:(?:then|do|else|elif|if|while|until|time|!|\{)\s+)+/;

/**
 * Command strings handed to `bash -c`, `sh -c` or `eval` anywhere in a
 * segment, so wrappers (`wsl -d Ubuntu -- bash -lc '...'`, `docker exec web
 * sh -c "..."`) are seen. A shell word inside quotes is only text.
 */
function nestedCommands(seg) {
  let masked = ''; // quoted content blanked, quote marks kept, same length
  let q = null;
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (q) {
      if (c === '\\' && q === '"') { masked += '  '; i++; continue; }
      if (c === q) q = null;
      masked += c === q || q === null ? c : ' ';
      continue;
    }
    if (c === '\\') { masked += c + (seg[i + 1] ?? ''); i++; continue; }
    if (c === "'" || c === '"') q = c;
    masked += c;
  }
  const quoted = (at) => {
    const open = seg[at];
    let body = '';
    for (let i = at + 1; i < seg.length; i++) {
      if (seg[i] === '\\' && open === '"') { body += seg[i + 1] ?? ''; i++; continue; }
      if (seg[i] === open) break;
      body += seg[i];
    }
    return body;
  };
  const out = [];
  // Options may take a value (`-o pipefail`) before `-c`.
  const shell = /(?:^|[\s;&|(])(?:[\w./-]*\/)?(?:bash|sh|zsh|dash|ksh)\s+(?:(?:[-+]o\s+\w+|-[a-zA-Z]+)\s+)*?-[a-zA-Z]*c[a-zA-Z]*\s+(['"])/g;
  // `su [user] -c '...'` runs it as another user; `ssh host '...'` runs it remotely.
  const su = /(?:^|[\s;&|(])su\b[^'"\n]*?\s-c\s+(['"])/g;
  const ssh = /(?:^|[\s;&|(])ssh\s[^'"\n]*?(['"])/g;
  for (const re of [shell, su, ssh]) for (const m of masked.matchAll(re)) out.push(quoted(m.index + m[0].length - 1));
  for (const m of masked.matchAll(/(?:^|[\s;&|(])eval\s+/g)) {
    const at = m.index + m[0].length;
    out.push(seg[at] === '"' || seg[at] === "'" ? quoted(at) : seg.slice(at));
  }
  return out;
}

function segments(command, depth = 0) {
  const s = String(command ?? '');
  const out = [];
  let cur = '';
  let quote = null;
  let arith = 0; // open `$((` count
  let heredoc = null; // set by `<<TAG`; its body starts at the next newline
  const push = () => {
    const seg = cur.trim().replace(KEYWORDS, '');
    cur = '';
    if (!seg || seg === '}') return;
    out.push(seg);
    if (depth < 3) for (const inner of nestedCommands(seg)) out.push(...segments(inner, depth + 1));
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      // In "..." and in bash's $'...', a backslash escapes the next character.
      if (c === '\\' && (quote === '"' || quote === '$')) { cur += c + (s[i + 1] ?? ''); i++; continue; }
      if (c === (quote === '$' ? "'" : quote)) quote = null;
      cur += c;
      continue;
    }
    if (c === '\\') { cur += c + (s[i + 1] ?? ''); i++; continue; }
    if (c === "'" || c === '"') { quote = c === "'" && cur.endsWith('$') ? '$' : c; cur += c; continue; }
    if (c === '#' && (cur === '' || /[\s;&|(]$/.test(cur))) {
      while (i + 1 < s.length && s[i + 1] !== '\n') i++; // comment: skip to end of line
      continue;
    }
    if (c === '$' && s[i + 1] === '(' && s[i + 2] === '(') { arith++; cur += '$(('; i += 2; continue; }
    if (arith > 0) {
      if (c === ')' && s[i + 1] === ')') { arith--; cur += '))'; i++; continue; }
      cur += c;
      continue;
    }
    if (c === '<' && s[i + 1] === '<' && s[i + 2] !== '<') {
      const m = s.slice(i).match(/^<<(-?)\s*(['"]?)([A-Za-z_][\w-]*)\2/);
      if (m) {
        // A shell reading the heredoc runs it: leave the body to be split.
        if (!SHELL.test(cur)) heredoc = { tag: m[3], strip: m[1] === '-' };
        cur += m[0];
        i += m[0].length - 1;
        continue;
      }
    }
    if (c === '\n') {
      push();
      if (heredoc) {
        // Skip the body, up to and including the line that is exactly the tag.
        let j = i + 1;
        for (;;) {
          const end = s.indexOf('\n', j);
          const line = s.slice(j, end === -1 ? s.length : end);
          const bare = heredoc.strip ? line.replace(/^\t+/, '') : line;
          if (bare.trim() === heredoc.tag || end === -1) { i = end === -1 ? s.length : end; break; }
          j = end + 1;
        }
        heredoc = null;
      }
      continue;
    }
    if (c === ';') { push(); continue; }
    if (c === '(' || c === ')') {
      // Subshells, `$( )` and case patterns: what is inside runs on its own.
      if (c === '(' && cur.endsWith('$')) cur = cur.slice(0, -1);
      push();
      continue;
    }
    if (c === '|') {
      push();
      if (s[i + 1] === '|' || s[i + 1] === '&') i++;
      continue;
    }
    if (c === '&') {
      if (s[i + 1] === '&') { push(); i++; continue; }
      // `2>&1`, `<&3` and `&>file` redirect; they do not separate commands.
      if (cur.endsWith('>') || cur.endsWith('<') || s[i + 1] === '>') { cur += c; continue; }
      push();
      continue;
    }
    cur += c;
  }
  push();
  return out;
}
/**
 * Every segment either splitter finds: the guards are never weaker than the
 * plain split they started with.
 *
 * Two review rounds in sual-cavab (PRs #13 and #16) showed that each rule the
 * shell-aware splitter added to remove a false positive also removed blocks
 * the plain split caught by accident: heredocs piped to a shell, commands
 * passed to `ssh` or `su -c`, quotes inside `$( )`. Patching case by case kept
 * missing cases, so the guards check both and the most severe answer wins.
 * The price is the plain split's old false positives, such as a `.env` path
 * mentioned inside quotes; they were there before the shell-aware splitter.
 */
function plainSegments(command) {
  return String(command ?? '')
    .split(/&&|\|\||[;|\n]/) // exactly the baseline split: no lone &
    .map((s) => s.trim())
    .filter(Boolean);
}



function tokens(segment) {
  const raw = segment.match(/(?:[^\s'"]+|'[^']*'|"[^"]*")+/g) ?? [];
  const out = raw.map(unquote);
  while (out.length && (out[0] === 'sudo' || /^[A-Z_][A-Z0-9_]*=/.test(out[0]))) out.shift();
  return out;
}

const PROTECTED_BRANCH = /^(main|master|develop|prod|production|release\/.+|hotfix\/.+)$/i;

// `gh pr merge` flags that take a value, so the value is not mistaken for the PR.
const VALUE_FLAGS = new Set([
  '-R', '--repo', '-b', '--body', '-F', '--body-file', '-t', '--subject',
  '-A', '--author-email', '--match-head-commit',
]);

const FAILED = new Set(['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR', 'STALE']);

// ---------------------------------------------------------------- config

/** The loop config, or null when this project does not run the loop. */
export function loadConfig(dir) {
  try {
    const raw = readFileSync(join(dir, '.claude', 'harness-loop.json'), 'utf8').replace(/^﻿/, '');
    const cfg = JSON.parse(raw);
    if (!cfg || typeof cfg !== 'object' || typeof cfg.base !== 'string' || !cfg.base) return null;
    return cfg;
  } catch {
    return null;
  }
}

function isProtected(branch, cfg) {
  const b = String(branch ?? '').replace(/^refs\/heads\//, '');
  if (!b) return false;
  if (PROTECTED_BRANCH.test(b)) return true;
  return Array.isArray(cfg?.protected) && cfg.protected.includes(b);
}

// ---------------------------------------------------------------- gh lookup

/** Default lookup: ask GitHub for the PR's base and check rollup. */
function ghLookup(viewArgs, cwd) {
  const out = execFileSync(
    'gh',
    ['pr', 'view', ...viewArgs, '--json', 'baseRefName,statusCheckRollup,number'],
    { cwd, timeout: 7000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
  );
  return JSON.parse(out);
}

/** 'failing' | 'pending' | 'green' (no checks counts as green: nothing to wait for). */
export function checkState(rollup) {
  if (!Array.isArray(rollup)) return 'green';
  let pending = false;
  for (const c of rollup) {
    const conclusion = String(c?.conclusion ?? '').toUpperCase();
    const state = String(c?.state ?? '').toUpperCase();
    const status = String(c?.status ?? '').toUpperCase();
    if (FAILED.has(conclusion) || FAILED.has(state)) return 'failing';
    if (c?.__typename === 'StatusContext' || (state && !status)) {
      if (state === 'PENDING' || state === 'EXPECTED') pending = true;
    } else if (status && status !== 'COMPLETED') {
      pending = true;
    }
  }
  return pending ? 'pending' : 'green';
}

// ---------------------------------------------------------------- rules

function checkMerge(t, segment, ctx) {
  if (t[0] !== 'gh' || t[1] !== 'pr' || t[2] !== 'merge') return null;
  const rest = t.slice(3);
  const loop = Boolean(ctx.config);
  const severe = loop ? 'deny' : 'ask';

  if (rest.includes('--admin')) {
    return {
      decision: severe,
      rule: 'merge-admin-bypass',
      reason: `\`--admin\` merges past branch protection and required checks: \`${segment}\`. A human runs this, not the agent.`,
    };
  }
  // `--disable-auto` only cancels a queued auto-merge; it merges nothing.
  if (rest.includes('--disable-auto')) return null;

  const viewArgs = [];
  for (let i = 0; i < rest.length; i++) {
    const x = rest[i];
    if (x === '-R' || x === '--repo') { viewArgs.push('--repo', rest[i + 1]); i++; continue; }
    if (x.startsWith('--repo=')) { viewArgs.push(x); continue; }
    if (VALUE_FLAGS.has(x)) { i++; continue; }
    if (x.startsWith('-')) continue;
    viewArgs.unshift(x); // the PR: number, URL or branch
  }

  let pr;
  try {
    pr = ctx.lookup(viewArgs, ctx.cwd);
  } catch {
    return null; // gh missing, offline, unauthenticated: fail open
  }
  if (!pr || typeof pr.baseRefName !== 'string') return null;

  const base = pr.baseRefName;
  const label = pr.number ? `#${pr.number}` : 'this PR';

  if (loop && isProtected(base, ctx.config)) {
    return {
      decision: 'deny',
      rule: 'loop-merge-protected',
      reason:
        `${label} targets \`${base}\`, a protected branch. The loop merges only into \`${ctx.config.base}\`; ` +
        `promoting to \`${base}\` is a human's call.`,
    };
  }
  if (loop && base !== ctx.config.base) {
    return {
      decision: 'deny',
      rule: 'loop-merge-wrong-base',
      reason:
        `${label} targets \`${base}\`, but the loop's base is \`${ctx.config.base}\` (.claude/harness-loop.json). ` +
        `Retarget the PR or change the config; do not merge it as is.`,
    };
  }

  if (rest.includes('--auto')) return null; // GitHub itself waits for the checks

  const state = checkState(pr.statusCheckRollup);
  if (state === 'green') return null;
  return {
    decision: severe,
    rule: state === 'failing' ? 'merge-red-checks' : 'merge-pending-checks',
    reason:
      state === 'failing'
        ? `${label} has failing checks. Fix them, or rerun a check that failed for a reason unrelated to the change, then merge.`
        : `${label} still has checks running. Wait with \`gh pr checks ${pr.number ?? ''} --watch\` (or merge with \`--auto\`).`,
  };
}

function checkPush(t, segment, ctx) {
  if (!ctx.config || t[0] !== 'git' || !t.includes('push')) return null;
  const after = t.slice(t.indexOf('push') + 1).filter((x) => !x.startsWith('-'));
  const refs = after.slice(1); // first positional is the remote
  const dests = refs
    .map((r) => r.replace(/^\+/, ''))
    .map((r) => (r.includes(':') ? r.slice(r.indexOf(':') + 1) : r))
    .map((r) => r.replace(/^refs\/heads\//, ''))
    .filter(Boolean);
  const hit = dests.find((d) => d === ctx.config.base || isProtected(d, ctx.config));
  if (!hit) return null;
  return {
    decision: 'deny',
    rule: 'loop-push-to-base',
    reason:
      `\`${segment}\` pushes straight to \`${hit}\`. In the loop, work reaches \`${ctx.config.base}\` only ` +
      `through a reviewed, green PR. Push a feature branch and open a PR.`,
  };
}

// ---------------------------------------------------------------- entry

/**
 * Pure apart from the injected lookup; exported for tests.
 * deps.config: loop config (undefined -> read from disk; null -> no loop).
 * deps.lookup: (viewArgs, cwd) -> {baseRefName, statusCheckRollup, number}.
 */
export function decide(payload, deps = {}) {
  try {
    if (payload?.tool_name !== 'Bash') return null;
    const command = payload?.tool_input?.command;
    if (typeof command !== 'string' || !command) return null;

    const dir = deps.dir ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
    const config = deps.config === undefined ? loadConfig(dir) : deps.config;
    const lookup = deps.lookup ?? ghLookup;

    // Each split is walked on its own, with its own working directory and
    // every `cd` in order. One merged, de-duplicated list applied the `cd`s
    // of both splits to one directory (and dropped a repeated `cd ..`), so
    // gh ran outside the repo, failed, and the merge was let through
    // (sual-cavab PR #16, round 3). The stricter answer of the two wins.
    let found = null;
    for (const split of [segments(command), plainSegments(command)]) {
      const ctx = { config, lookup, cwd: deps.cwd ?? process.cwd() };
      for (const segment of split) {
        const t = tokens(segment);
        if (!t.length) continue;
        if (t[0] === 'cd' && t[1]) { ctx.cwd = resolve(ctx.cwd, t[1]); continue; }
        const hit = checkMerge(t, segment, ctx) ?? checkPush(t, segment, ctx);
        if (hit && (!found || (hit.decision === 'deny' && found.decision !== 'deny'))) found = hit;
        if (found?.decision === 'deny') return found;
      }
    }
    if (found) return found;
    return null;
  } catch {
    return null; // fail open
  }
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function record(decision, payload) {
  try {
    appendFileSync(
      join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), '.claude', 'harness-decisions.log'),
      JSON.stringify({
        ts: new Date().toISOString(),
        hook: 'guard-merge',
        decision: decision.decision,
        rule: decision.rule,
        tool: payload?.tool_name,
        target: String(payload?.tool_input?.command ?? '').slice(0, 300),
        session: payload?.session_id,
        mode: payload?.permission_mode,
      }) + '\n',
    );
  } catch { /* never let logging change the decision */ }
}

async function main() {
  let decision = null;
  let payload = null;
  try {
    payload = JSON.parse(await readStdin());
    decision = decide(payload);
  } catch {
    process.exit(0);
  }
  if (!decision) process.exit(0);
  record(decision, payload);
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: decision.decision,
        permissionDecisionReason: `[harness:${decision.rule}] ${decision.reason}`,
      },
    }),
  );
  process.exit(0);
}

const invokedDirectly = (() => {
  try {
    return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();
if (invokedDirectly) main().catch(() => process.exit(0));
