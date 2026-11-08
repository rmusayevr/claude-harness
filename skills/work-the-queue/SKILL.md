---
name: work-the-queue
description: Run the GitHub issue loop unattended — pick the next issue (or write one), plan, build, open a PR, review it fresh, triage, fix blockers, merge into the configured base on green CI, wait for the base CI, then take the next issue. Stops only for real questions.
disable-model-invocation: true
---

# Work the queue

One loop, one issue at a time, GitHub issues only. Commands, the config
schema and the templates are in `reference.md` next to this file; read it on
first use.

## 0. Before the first issue

- Read `.claude/harness-loop.json`. If it is missing, propose one from
  `reference.md` (base branch, queue label, checks, risky paths) and stop until
  the user approves it. `guard-merge` enforces it (see `reference.md`).
- `gh auth status` succeeds, the tree is clean, `git fetch origin`, and what
  `checks` need (a database) runs; if nothing in the repo starts it, say so.
- If `base` is a protected branch (`main`, `master`, `production`…), set
  `autoMerge` to false for this run: the loop gets PRs to ready and a human
  merges them.

## 1. Pick the issue

Take the first open, unparked issue from the queue (order rules in
`reference.md`). Its comments hold earlier plans and the owner's decisions:
**they are the spec.** If they contradict the issue body, the newest owner
comment wins; if that is unclear, ask.

**Empty queue:** write a new issue only from a problem the user named, or a
concrete finding from this run (a failing check, a review finding outside the
last PR's scope). Never invent work. Create it with the queue label, then read
it back with `gh issue view` and work from what GitHub has, not your draft.

## 2. Size it, then plan

Size by the first rule that matches: **Risky** (touches a `risky` path from the
config, or migrations), **Medium** (changes an API, documented behaviour, or
more than 3 non-test files), **Small** (anything else). Never size down.

- Small: go on.
- Medium and Risky: post the plan as an issue comment and **stop for approval**.
  While waiting, plan the next issues too, so the user approves them in one go.
- Bigger than planned, once started: say so, re-size, re-plan.

## 3. Build

Branch from `origin/<base>` (`feat/<topic>-YYYYMMDD`). A behaviour change gets a
test; a bug fix gets a test that fails without the fix. Run every command in
`checks` and read **its own** exit code (see Incidents). Then
`read-your-own-diff`, push the branch and open the PR into `base` with the
template from `reference.md`, including `Closes #<issue>`.

## 4. Review, triage, fix

Delegate the PR diff, and nothing else, to the `fresh-eyes-reviewer` subagent;
never review your own PR in this context. Run `triage-review` on what comes back.
Fix blockers, ask decisions, repeat until ready, or stop after three rounds.

## 5. Merge and confirm

- `gh pr checks <n> --watch`. A failure in a test the PR does not touch may be
  rerun **once** (`gh run rerun <id> --failed`); a second failure is a blocker.
- Ready and `autoMerge` → `gh pr merge <n> --<mergeMethod>`. Otherwise stop
  with "PR #n is ready to merge" and wait for the user's go.
- Wait for the **base** CI run of the merge commit to finish green. Red base =
  stop the loop; fixing it is the next issue, before anything else.
- Close what GitHub did not: `Closes #n` only fires on the default branch, so
  on any other base close the issue yourself and tick it in its parent.
- Post a one-line status on the issue (merged as, what was not verified, how to
  accept it), then go back to step 1.

## Park, don't wait

A step that needs a human but does not block other issues — a deploy, a
credential, a design file, manual acceptance — is parked: comment what is
needed, add the `parkedLabel`, move to the next issue. Resume parked issues
when the user says the thing is done.

The issue is the memory. Before context runs low, comment on the issue where
you are and what is next (`handoff`); a new session resumes from that alone.

## Stop and ask only for

Business rules (money, who may do what, reservations, identity, or anything in
`stopFor`), new dependencies or services, work bigger than its plan, a guard
that denied, a red base, or an empty queue with no problem to write up. Ask one
question with a recommendation first.


## Incidents

- **Client web project (2026-11).** A reviewer subagent ran `git checkout`
  and left the shared checkout on a detached HEAD; the next commit went
  nowhere. Reviewers are now read-only.
- **Same project.** Tasks merged into `staging` stayed open: `Closes #n` only
  acts on the default branch. The owner had to ask for them to be closed.
- **Same project.** One flaky frontend test failed unrelated PRs; rerunning
  the failed job once was the agreed fix, and a second failure counts as real.
- **sual-cavab #1 (2026-11-08).** Checks needed PostgreSQL and the repo had
  no way to start one; a local service already held port 5432.
- **A second client project.** A suite was reported green because the shell's
  exit code was the trailing `echo`'s. The runner itself had failed.
