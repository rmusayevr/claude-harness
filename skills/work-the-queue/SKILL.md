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
- A protected `base` (`main`, `production`…) means `autoMerge` is false for
  this run: the loop gets PRs to ready and a human merges them.

## 1. Pick the issue

Take the first open, unparked issue (order in `reference.md`). Its comments
hold plans and the owner's decisions: **they are the spec**, the newest owner
comment winning over the body. If that is unclear, ask.

**Empty queue:** write an issue only from a problem the user named or a
concrete finding from this run; never invent work. Create it with the queue
label, then work from `gh issue view`, not from your draft.

## 2. Size it, then plan

Size by the first rule that matches: **Risky** (touches a `risky` path from the
config, or migrations), **Medium** (changes an API, documented behaviour, or
more than 3 non-test files), **Small** (anything else). Never size down.

- A new package in the plan: run `review-a-dependency` before proposing it.
- Medium and Risky: post the plan as an issue comment and **stop for approval**.
  While waiting, plan the next issues too, so the user approves them in one go.
- Bigger than planned once started: say so (`scope-change`), re-size, re-plan.

## 3. Build

Branch from `origin/<base>` (`feat/<topic>-YYYYMMDD`). Per `design-a-test`,
every behaviour change gets a test; a fix gets one that fails without it.
Run every command in `checks`; each passes only by **its own** exit code
(`verify-for-real`). Commit per `write-commit`, then `read-your-own-diff`,
push, and open the PR into `base` per `reference.md` with `Closes #<issue>`.

## 4. Review, triage, fix

Delegate the PR diff, and nothing else, to the `fresh-eyes-reviewer` subagent;
never review your own PR in this context. `triage-review` what comes back.
Fix blockers, ask decisions, repeat until ready, or stop after three rounds.

## 5. Merge, confirm, then back to step 1

- `gh pr checks <n> --watch`. A failure in a test the PR does not touch may be
  rerun **once** (`gh run rerun <id> --failed`); a second failure is a blocker.
- Ready and `autoMerge` → `gh pr merge <n> --<mergeMethod> --delete-branch`
  (local and remote), then `git switch <base> && git pull`. Otherwise stop
  with "PR #n is ready to merge" and wait for the user's go.
- Wait for the **base** CI run of the merge commit to finish green. Red base =
  stop the loop; fixing it is the next issue, before anything else.
- Close what GitHub did not: `Closes #n` only fires on the default branch, so
  on any other base close the issue yourself and tick it in its parent.
- Post a status line on the issue (merged as, not verified, how to accept).

## Park, don't wait

A step that needs a human (a deploy, a credential, a design file) and blocks
no other issue is parked: comment what is needed, add the `parkedLabel`, take
the next issue. Resume it when the user says the thing is done.

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
- **sual-cavab (2026-11-08).** Merged PR branches piled up on GitHub and
  locally: the merge step had no `--delete-branch`.
- **sual-cavab, day one.** Only skills this file names loaded; with six new
  packages, `review-a-dependency` never did. Each step now names its skill.
- **A second client project.** A suite was reported green because the shell's
  exit code was the trailing `echo`'s. The runner itself had failed.
