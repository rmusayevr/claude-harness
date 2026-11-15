#!/usr/bin/env node
/**
 * PreToolUse guard: deny `gh pr merge` when the PR has no review triage comment, or when
 * its latest triage says "not ready". Active only where `.claude/harness-loop.json` exists, i.e.
 * where `/work-the-queue` runs and step 4 (review fresh, triage) is the rule; elsewhere a PR has no
 * such comment and it would block every merge.
 *
 * Bought by sual-cavab PR #59 (2026-11-09), merged without step 4 of work-the-queue (review fresh,
 * triage). The review run afterwards found two regressions, fixed in #60. Lesson:
 * merged-without-review (.claude/lessons/).
 *
 * `deny`, not `ask`: this only runs in a loop project, where nobody is there to answer, and an
 * `ask` is then "a hard block or a silent allow depending on the permission mode" (ARCHITECTURE.md).
 * sual-cavab logged 23 of these asks, all in `auto` mode, and kept merging PRs afterwards, so the
 * `ask` was probably not stopping anything. A merge that must not happen unattended is a `deny`,
 * like every rule in guard-merge's loop mode. The cost is the owner's "merge this docs-only PR
 * without a review": inside the loop the owner merges that one by hand.
 *
 * Decidable from GitHub, not from the command, so it asks `gh` (a network call, made only for a
 * command whose first word is `gh pr merge`, with a timeout under the hook's own). FAIL OPEN, like
 * every hook here: `gh` missing, unauthenticated, slow or an unexpected answer means no decision.
 *
 * Limit: the hook sees the PR before the command runs. `gh pr comment ... && gh pr merge` in one
 * command therefore is denied (the triage is not posted yet), and that is correct: post the triage
 * as its own command, then merge.
 */
import { pathToFileURL } from 'node:url';
import { appendFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/** Flags of `gh pr merge` that take a value: the value is not the PR. */
const VALUE_FLAGS = new Set(['-t', '--subject', '-b', '--body', '-F', '--body-file', '-A', '--author-email', '--match-head-commit', '-R', '--repo']);

/**
 * Split a command into segments on `;`, `&`, `|` and newlines OUTSIDE quotes, and each segment into
 * words (quotes removed). Text inside quotes is data, so `echo "gh pr merge 59"` is not a merge and
 * a `;` inside a subject line does not cut the command.
 */
export function segments(command) {
  const out = [];
  let words = [];
  let word = '';
  let has = false;
  let q = null;
  const endWord = () => {
    if (has) words.push(word);
    word = '';
    has = false;
  };
  const endSeg = () => {
    endWord();
    if (words.length) out.push(words);
    words = [];
  };
  const s = String(command ?? '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === q) q = null;
      else if (c === '\\' && q === '"' && i + 1 < s.length && '"\\$`'.includes(s[i + 1])) word += s[++i]; // a shell keeps the backslash before any other character
      else word += c;
    } else if (c === '"' || c === "'") {
      q = c;
      has = true;
    } else if (c === ';' || c === '&' || c === '|' || c === '\n') {
      endSeg();
    } else if (/\s/.test(c)) {
      endWord();
    } else {
      word += c;
      has = true;
    }
  }
  endSeg();
  return out;
}

/**
 * The `gh pr merge` calls in a command: {selector, repo, number}. `selector` is what `gh pr view`
 * takes (a number, a URL or a branch; null for the current branch); `number` is for the message.
 */
export function merges(command) {
  const found = [];
  for (const words of segments(command)) {
    let i = 0;
    let envRepo = null;
    if (words[i] === 'env') i++; // env GH_REPO=o/r gh pr merge ...
    while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) {
      if (words[i].startsWith('GH_REPO=')) envRepo = words[i].slice(8); // GH_REPO=o/r gh pr merge ...
      i++;
    }
    const w = words.slice(i);
    if (!/^gh(\.exe)?$/i.test((w[0] ?? '').replace(/^.*[\\/]/, '')) || w[1] !== 'pr' || w[2] !== 'merge') continue;
    let selector = null;
    let repo = null;
    let disable = false;
    for (let j = 3; j < w.length; j++) {
      const t = w[j];
      if (t === '--disable-auto') disable = true;
      else if (t.startsWith('--repo=')) repo = t.slice(7);
      else if (VALUE_FLAGS.has(t)) {
        if (t === '-R' || t === '--repo') repo = w[j + 1] ?? null;
        j++;
      } else if (t.startsWith('-')) continue;
      else if (selector === null) selector = t.replace(/^#/, '');
    }
    if (disable) continue; // cancels an auto-merge, merges nothing
    if (repo === null) repo = envRepo || process.env.GH_REPO || null;
    const url = selector ? /\/pull\/(\d+)/.exec(selector) : null;
    found.push({ selector, repo, number: url ? Number(url[1]) : /^\d+$/.test(selector ?? '') ? Number(selector) : null });
  }
  return found;
}

/**
 * What triage-review tells the agent to end its comment with:
 * `Round <N>: ... Open: <a> blockers, <b> decisions → ready | not ready`. The words "review triage"
 * are NOT part of that format, so the status line is what counts as a triage. A comment that only
 * mentions the phrase is not one.
 */
const TRIAGE_LINE = /Round\s+\d+\s*:[^\n]*(?:→|->)[\s*_`]*(?:not\s+)?ready\b/i;
/** The verdict is on the status line only: a table row that quotes an earlier round's "→ not ready" is not it. */
const verdict = (body) => body.split('\n').filter((l) => TRIAGE_LINE.test(l)).pop() ?? '';

/** Comment and review bodies of a PR, oldest first, or null if they cannot be read. */
function fetchBodies({ selector, repo }, timeout = 8000) {
  try {
    const args = ['pr', 'view'];
    if (selector) args.push(selector);
    if (repo) args.push('-R', repo);
    args.push('--json', 'comments,reviews');
    const out = execFileSync('gh', args, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    const data = JSON.parse(out);
    return [...(data.comments ?? []), ...(data.reviews ?? [])]
      .sort((a, b) => String(a.createdAt ?? a.submittedAt ?? '').localeCompare(String(b.createdAt ?? b.submittedAt ?? '')))
      .map((c) => String(c.body ?? ''));
  } catch {
    return null; // fail open
  }
}

const label = (m) => (m.number !== null ? `PR #${m.number}` : m.selector ? `PR "${m.selector}"` : 'this PR');

export function decide(payload, deps = {}) {
  if (payload?.tool_name !== 'Bash') return null;
  // Chained merges look up one PR after another; stay inside the hook's own timeout (hooks.json: 15 s).
  const deadline = Date.now() + 12000;
  for (const m of merges(payload?.tool_input?.command)) {
    const left = deadline - Date.now();
    if (!deps.fetchBodies && left < 1000) continue; // out of time: fail open, like every other failure here
    const bodies = (deps.fetchBodies ?? ((x) => fetchBodies(x, Math.min(8000, left))))(m);
    if (!Array.isArray(bodies)) continue; // fail open for this one
    const triages = bodies.filter((b) => TRIAGE_LINE.test(b));
    const recovery =
      'Run the fresh-eyes review and post its triage as its own command (not chained with the merge), then merge. If the owner wants this PR merged without a review, they merge it themselves.';
    if (triages.length === 0)
      return {
        decision: 'deny',
        rule: 'review-before-merge',
        reason: `${label(m)} has no review triage comment (a comment ending with the "Round N: ... → ready" line from triage-review). work-the-queue step 4: the fresh-eyes review runs and its triage is posted before the merge (PR #59 was merged without it; the review then found two regressions). ${recovery}`,
      };
    const latest = triages[triages.length - 1];
    if (/(?:→|->)[\s*_`]*not\s+ready/i.test(verdict(latest)))
      return {
        decision: 'deny',
        rule: 'review-before-merge',
        reason: `${label(m)}: its latest review triage says "not ready". Fix the blockers and post the next triage round first. ${recovery}`,
      };
  }
  return null;
}

function record(decision, payload) {
  try {
    appendFileSync(
      join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), '.claude', 'harness-decisions.log'),
      JSON.stringify({
        ts: new Date().toISOString(),
        hook: 'guard-review-before-merge',
        decision: decision.decision,
        rule: decision.rule,
        tool: payload?.tool_name,
        target: String(payload?.tool_input?.command ?? '').slice(0, 300),
        session: payload?.session_id,
        mode: payload?.permission_mode,
      }) + '\n',
    );
  } catch {
    /* never let logging change the decision */
  }
}

/** The rule exists only where /work-the-queue runs. */
export const inLoopProject = (dir) => existsSync(join(dir, '.claude', 'harness-loop.json'));

async function main() {
  if (!inLoopProject(process.env.CLAUDE_PROJECT_DIR || process.cwd())) process.exit(0); // not a loop project: no rule
  let decision = null;
  let payload = null;
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
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
