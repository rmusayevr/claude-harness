---
name: triage-review
description: Label each code-review finding on a GitHub PR as blocker, decision, settled or nit, fix the blockers, and post whether the PR is ready. Use when review findings come back or someone asks if a PR is ready.
---

# Triage a review and say whether the PR is done

A code review always returns findings. Their number is not the measure, and
"fix everything the reviewer said" never ends: each round of fixes is new code
for the next round to find things in. The measure is **open blockers and open
decisions**.

**A PR is ready when it has 0 open blockers, 0 open decisions, and its checks
pass.** Nothing else holds it.

Argument: the PR number (ask if missing). Findings: from the review you just
ran, pasted by the user, or the PR's review comments
(`gh api repos/{owner}/{repo}/pulls/<n>/comments`). With none, say so and stop.

## 1. Load what is already settled — before reading the findings

- `gh pr view <n> --comments`: earlier status tables and recorded decisions.
- The issue the PR closes (`gh issue view <i> --comments`): the plan and the
  owner's answers. Treat those answers as the spec.

## 2. Give each finding exactly one label

- **Blocker** — a real defect *in this PR's change* with a concrete bad outcome:
  crash, wrong money, lost or corrupted data, a security hole, a broken decided
  rule. Check the failure scenario against the code first; a scenario that
  cannot happen is a nit, and the outcome column says why.
- **Decision** — a business-rule question nobody has answered yet: who may do
  what, money, reservations, identity. You do not answer it.
- **Settled** — already decided by the owner, or already fixed in an earlier
  round. Link the comment or commit. Reopen only if the review shows something
  new: a different failure, or code that changed since.
- **Nit** — style, naming, speed, "could be designed differently". Close with
  one line on why it is not changed.

A defect in code this PR does not touch is not this PR's blocker. Name it and
propose an issue (`gh issue create`), do not fix it here (`scope-change`).

## 3. Act on the labels

- **Blockers:** fix on the PR branch, each with a test that fails without the
  fix — run it against the old code once to prove it. Then run the project's
  checks. After non-trivial fixes, review again: fixes carry defects too.
- **Decisions:** ask the owner one short question each, with options and your
  recommendation first. Record the answer on the PR when it comes.

## 4. Post one status comment on the PR

A table — finding → label → outcome — ending with exactly this line:

```text
Round <N>: <x> blockers fixed, <y> settled, <z> nits. Open: <a> blockers, <b> decisions → ready | not ready
```

`<N>` is the number of earlier status lines on the PR plus one. Tell the user
the status line and any open decisions.

## Stop rule

Three rounds without reaching ready means the PR is too big or the plan was
wrong. Stop and say which, instead of starting round four (`split-a-big-change`).

## Incidents

- **Client web project, four PRs in a row (2026-11).** Every `/code-review`
  round came back with 5 to 10 findings, fixes were applied, and the next round
  found more. The owner asked "why are the problems not finishing?" and "you
  tell me accept it but every time it shows me some issues". The cycle ended
  only when "ready" was defined as zero open blockers and decisions, not zero
  findings.
