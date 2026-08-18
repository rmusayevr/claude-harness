---
name: fresh-eyes-review
description: Review a diff in a subagent that has no memory of writing it, to catch defects the author's own context hides. Use before opening a PR, or after a change that grew past its original plan.
---

# Fresh-eyes review

You cannot review your own diff. Not because of carelessness — because the
knowledge that makes the code look correct is in your context and not in the
file. The reviewer who lacks that knowledge is the one who finds the bug.

## Procedure

1. **Get the diff.** `git diff`, `git diff --staged`, or `git diff main...HEAD`
   for a branch. If the change is uncommitted and large, stage it first so the
   diff is stable while the review runs.

2. **Delegate to `fresh-eyes-reviewer`.** Give it the diff and *nothing else*:

   > Use the fresh-eyes-reviewer subagent to review this diff: `<diff>`

   Do **not** include your reasoning, the goal, or what you already ruled out.
   Every sentence of context you add re-creates the blind spot you are trying to
   escape. If the code needs an explanation to look correct, that is a finding.

3. **Fan out when the change spans concerns.** Run several reviewers in parallel
   with different briefs — one on the data layer, one on the error paths, one on
   the public interface. Separate contexts find separate things; one reviewer
   given three briefs prioritizes and drops two.

4. **Triage every finding into one of three:**
   - **Real** — fix it.
   - **Wrong, because of something the reviewer could not see** — then ask why
     it could not see it. The answer is usually a missing assertion, a missing
     type, or a comment that should exist. Often the fix is to make the code say
     what you knew.
   - **Out of scope** — record it, do not fix it here (see `scope-change`).

   Dismissing a finding as "the reviewer lacked context" without doing step 2 of
   that triage is how this skill stops working.

5. **Re-run after non-trivial fixes.** Fixes introduce defects at roughly the
   rate original code does, and you now have fresh context blindness about the
   fix.

## When to skip it

A one-line change with a test. Formatting. Generated files. Running this on
trivia trains you to skim the output, and then it is not there when it matters.

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
