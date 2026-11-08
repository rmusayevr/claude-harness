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

function segments(command) {
  return String(command ?? '')
    .split(/&&|\|\||[;|\n]/)
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
    const ctx = {
      config: deps.config === undefined ? loadConfig(dir) : deps.config,
      lookup: deps.lookup ?? ghLookup,
      cwd: deps.cwd ?? process.cwd(),
    };

    for (const segment of segments(command)) {
      const t = tokens(segment);
      if (!t.length) continue;
      if (t[0] === 'cd' && t[1]) { ctx.cwd = resolve(ctx.cwd, t[1]); continue; }
      const hit = checkMerge(t, segment, ctx) ?? checkPush(t, segment, ctx);
      if (hit) return hit;
    }
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
