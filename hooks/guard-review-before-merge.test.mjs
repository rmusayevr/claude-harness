// Cases promised when the guard was proposed in sual-cavab, plus the ones the review of its PR #86 found.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { decide, merges, segments, inLoopProject } from './guard-review-before-merge.mjs';

const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });
const bodies = (...b) => ({ fetchBodies: () => b });
const TRIAGE = '## Review triage (fresh-eyes reviewer)\nRound 1: 1 blockers fixed, 0 settled, 2 nits. Open: 0 blockers, 0 decisions → ready.';

test('denies merging a PR that has no review triage comment', () => {
  const d = decide(bash('gh pr merge 59 --merge --delete-branch'), bodies('looks fine', 'CI green'));
  assert.equal(d.decision, 'deny');
  assert.equal(d.rule, 'review-before-merge');
  assert.match(d.reason, /#59/);
});

test('lets a PR with a ready review triage through', () => {
  assert.equal(decide(bash('gh pr merge 60 --merge'), bodies(TRIAGE)), null);
});

test('denies when the latest triage says not ready; a later ready round lets it through', () => {
  const notReady = '## Review triage\nRound 1: 0 blockers fixed. Open: 2 blockers, 0 decisions → not ready.';
  assert.match(decide(bash('gh pr merge 61'), bodies(notReady)).reason, /not ready/);
  assert.equal(decide(bash('gh pr merge 61'), bodies(notReady, TRIAGE)), null);
});

test('reads the number after flags, in a URL, with #, and the selector for a branch', () => {
  assert.equal(merges('gh pr merge --merge --delete-branch 84')[0].number, 84);
  assert.equal(merges('gh pr merge https://github.com/o/r/pull/77 --merge')[0].number, 77);
  assert.equal(merges("gh pr merge '#85'")[0].number, 85);
  assert.equal(merges('gh pr merge feat/x --merge')[0].selector, 'feat/x');
  assert.equal(merges('gh pr merge --merge')[0].selector, null);
});

test('a number that is a flag value is not the PR (review of #86)', () => {
  assert.equal(merges('gh pr merge --subject "fix 12" 59')[0].number, 59);
  assert.equal(merges('gh pr merge -t "Closes 12" --merge 59')[0].number, 59);
  assert.equal(merges('gh pr merge --body-file 12 59')[0].number, 59);
});

test('-R, --repo= and GH_REPO choose the repository to look in', () => {
  assert.equal(merges('gh pr merge -R other/repo 7')[0].repo, 'other/repo');
  assert.equal(merges('gh pr merge --repo=other/repo 7')[0].repo, 'other/repo');
});

test('every merge in a chained command is checked, not only the first', () => {
  const seen = [];
  const deps = { fetchBodies: (m) => (seen.push(m.number), m.number === 1 ? [TRIAGE] : ['nothing']) };
  const d = decide(bash('gh pr merge 1 --merge && gh pr merge 2 --merge'), deps);
  assert.deepEqual(seen, [1, 2]);
  assert.match(d.reason, /#2/);
});

test('a ; & | inside a quoted argument does not cut the command (review of #86)', () => {
  assert.equal(merges('gh pr merge --subject "a; b" 59')[0].number, 59);
  assert.deepEqual(segments('echo "a; b" | cat'), [['echo', 'a; b'], ['cat']]);
});

test('text inside quotes is not a merge, so no network call is made (review of #86)', () => {
  let called = false;
  const deps = { fetchBodies: () => ((called = true), []) };
  assert.equal(decide(bash('echo "next: gh pr merge 59"'), deps), null);
  assert.equal(decide(bash('git commit -m "guard gh pr merge 59 when no triage"'), deps), null);
  assert.equal(called, false);
});

test('ignores commands that are not a merge, and --disable-auto, which merges nothing', () => {
  assert.equal(decide(bash('gh pr view 59'), bodies()), null);
  assert.equal(decide(bash('gh pr checks 59'), bodies()), null);
  assert.equal(decide(bash('git merge feature'), bodies()), null);
  assert.equal(decide(bash('gh pr merge 59 --disable-auto'), bodies()), null);
});

test('also sees gh.exe, a full path to gh and a leading VAR=x', () => {
  assert.equal(merges('gh.exe pr merge 59')[0].number, 59);
  assert.equal(merges('C:\\Program Files\\GitHub CLI\\gh.exe pr merge 59').length, 0); // an unquoted space splits the path: not understood, fails open
  assert.equal(merges('"C:\\Program Files\\GitHub CLI\\gh.exe" pr merge 59')[0].number, 59);
  assert.equal(merges('GH_TOKEN=x gh pr merge 59')[0].number, 59);
});

test('fails open: unreadable comments, other tools, no payload', () => {
  assert.equal(decide(bash('gh pr merge 59'), { fetchBodies: () => null }), null);
  assert.equal(decide({ tool_name: 'Edit', tool_input: {} }, bodies()), null);
  assert.equal(decide(null, bodies()), null);
});

test('the rule exists only in a loop project (.claude/harness-loop.json)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hook-loop-'));
  assert.equal(inLoopProject(dir), false);
  mkdirSync(path.join(dir, '.claude'));
  writeFileSync(path.join(dir, '.claude', 'harness-loop.json'), '{}');
  assert.equal(inLoopProject(dir), true);
});

test('every decision is a deny: nobody is there to answer an ask in a loop (sual-cavab: 23 asks, merges continued)', () => {
  for (const b of [[], ['## Review triage\nOpen: 1 blockers, 0 decisions → not ready.']]) {
    assert.equal(decide(bash('gh pr merge 61'), bodies(...b)).decision, 'deny');
  }
  assert.match(decide(bash('gh pr merge 61'), bodies()).reason, /own command/);
});

test('the triage format triage-review prescribes counts, with or without a heading', () => {
  const skillFormat = '| finding | label | outcome |\n|---|---|---|\n| x | nit | left |\n\nRound 1: 0 blockers fixed, 0 settled, 1 nits. Open: 0 blockers, 0 decisions → ready';
  assert.equal(decide(bash('gh pr merge 5 --squash'), bodies(skillFormat)), null);
});

test('a comment that only mentions a review triage is not one', () => {
  for (const mention of ['will post the review triage after CI', '## Review triage\n(pending)']) {
    assert.equal(decide(bash('gh pr merge 5'), bodies(mention)).decision, 'deny', mention);
  }
});

test('GH_REPO= on the command line chooses the repository', () => {
  assert.equal(merges('GH_REPO=o/r gh pr merge 5')[0].repo, 'o/r');
  assert.equal(merges('GH_REPO=o/r gh pr merge 5 -R x/y')[0].repo, 'x/y');
});
