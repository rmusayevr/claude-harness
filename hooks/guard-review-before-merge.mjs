#!/usr/bin/env node
/**
 * PreToolUse guard: ask before `gh pr merge` when the PR has no review triage comment, or when
 * its latest triage says "not ready". Active only where `.claude/harness-loop.json` exists, i.e.
 * where `/work-the-queue` runs and step 4 (review fresh, triage) is the rule; elsewhere a PR has no
 * such comment and it would ask on every merge.
 *
 * Bought by sual-cavab PR #59 (2026-11-09), merged without step 4 of work-the-queue (review fresh,
 * triage). The review run afterwards found two regressions, fixed in #60. Lesson:
 * merged-without-review (.claude/lessons/).
 *
 * `ask`, not `deny`: the owner may tell the agent to merge a docs-only PR without a review, and a
 * guard that over-blocks gets switched off. UNKNOWN: what an `ask` does when nobody can answer
 * (an unattended loop). The harness's guard-merge.mjs says it is "a hard block or a silent allow
 * depending on the permission mode" and uses `deny` in loop mode for that reason. Until it is seen
 * in the loop's real permission mode, treat this hook as a guard for attended sessions.
 *
 * Decidable from GitHub, not from the command, so it asks `gh` (a network call, made only for a
 * command whose first word is `gh pr merge`, with a timeout under the hook's own). FAIL OPEN, like
 * every hook here: `gh` missing, unauthenticated, slow or an unexpected answer means no decision.
 *
 * Limit: the hook sees the PR before the command runs. `gh pr comment ... && gh pr merge` in one
 * command therefore asks (the triage is not posted yet), and that ask is correct: post the triage
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
    while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i++; // VAR=x gh ...
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
    if (repo === null && process.env.GH_REPO) repo = process.env.GH_REPO;
    const url = selector ? /\/pull\/(\d+)/.exec(selector) : null;
    found.push({ selector, repo, number: url ? Number(url[1]) : /^\d+$/.test(selector ?? '') ? Number(selector) : null });
  }
  return found;
}

/** Comment and review bodies of a PR, oldest first, or null if they cannot be read. */
function fetchBodies({ selector, repo }) {
  try {
    const args = ['pr', 'view'];
    if (selector) args.push(selector);
    if (repo) args.push('-R', repo);
    args.push('--json', 'comments,reviews');
    const out = execFileSync('gh', args, { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
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
  for (const m of merges(payload?.tool_input?.command)) {
    const bodies = (deps.fetchBodies ?? fetchBodies)(m);
    if (!Array.isArray(bodies)) continue; // fail open for this one
    const triages = bodies.filter((b) => /review triage/i.test(b));
    const exception =
      'Merge only if the owner told you to merge this PR without a review (for example a docs-only PR); otherwise run the review first.';
    if (triages.length === 0)
      return {
        decision: 'ask',
        rule: 'review-before-merge',
        reason: `${label(m)} has no "Review triage" comment. work-the-queue step 4: the fresh-eyes review runs and its triage is posted before the merge (PR #59 was merged without it; the review then found two regressions). ${exception}`,
      };
    const latest = triages[triages.length - 1];
    if (/(?:→|->)\s*not ready/i.test(latest))
      return {
        decision: 'ask',
        rule: 'review-before-merge',
        reason: `${label(m)}: its latest review triage says "not ready". Fix the blockers and post the next triage round first. ${exception}`,
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
