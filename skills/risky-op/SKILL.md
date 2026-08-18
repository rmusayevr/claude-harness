---
name: risky-op
description: Procedure for operations that destroy data, rewrite shared history, or touch production. Use when a step is irreversible, externally visible, or the risky-ops hook has asked for confirmation.
---

# Risky operations

The hook is the guarantee. This is the procedure the hook cannot express.

## Before running it

1. **Name the reversal, out loud, before running.** "This is reversed by X."
   If there is no X, that is the finding — report it and stop. Discovering the
   absence of a rollback *after* the operation is how a mistake becomes an
   incident.
2. **Dry-run first, and read the output.** `--dry-run`, `terraform plan`,
   `--check`, `SELECT` before `DELETE`, `git log` before `git reset`. Running a
   dry run and skimming it is the same as not running it — the whole value is in
   the line you were not expecting.
3. **Narrow the target.** Delete the six rows by id, not by predicate. Restart
   the one pod, not the deployment. Scope is the only control you keep once the
   command starts.
4. **Confirm the target is what you think.** `git branch --show-current`,
   `kubectl config current-context`, `echo $DATABASE_URL`, `pwd`. The overwhelming
   majority of destructive accidents are correct commands aimed at the wrong
   place.

## When the hook asks

The hook escalated because the decision is the operator's, not yours.

Give them what they need to decide, in one short message: **what will change**,
**how it is reversed**, and **what you checked**. Do not paraphrase the hook's
reason back at them — they already read it.

## When the hook denies

**Do not route around it.** A denial is not an obstacle to solve.

Deleting the remote branch and re-pushing to defeat a force-push denial, writing
to a temp file and moving it to defeat a path denial, or spawning a subshell to
defeat a command match — each of these converts a guard the operator trusts into
one that silently does not work. That is worse than having no guard, because the
operator does not know to look.

Report that the operation is blocked, why, and what you would do instead.

## After

Verify the effect, not the exit code. Query the row count. Hit the endpoint.
Check the branch. A destructive command that half-succeeded exits 0 more often
than you would like.

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
