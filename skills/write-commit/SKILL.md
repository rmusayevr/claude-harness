---
name: write-commit
description: Write a commit message or PR description that states the effect and the reason, so a future bisect or incident review can use it. Use when committing, or when a change needs explaining to a reviewer.
---

# Write a commit

The audience is someone at 2am who has bisected to this commit and does not know
what it was for. Write for them.

## Subject line

State the **effect on the system**, not the action you took.

- `Fix race in session refresh that logged users out mid-request`
- Not `Update auth.ts` — the diff already says which file changed.
- Not `Fix bug` — the log is now a list of the word "bug".

If the subject needs the word **and**, it is two commits. Split it. This is the
single highest-value habit in this skill: it is what makes a revert land cleanly
six months later.

## Body

The diff shows *what* changed. The body exists for what the diff cannot show:

- **Why now** — the trigger. The bug report, the failure, the constraint.
- **Why this way** — the approach you rejected and the reason. This is the part
  future readers need most, because they will otherwise re-litigate it and
  arrive somewhere you already ruled out.
- **How it was verified** — the exact command. A bisect landing here needs to
  know what to run.
- **Known limits** — what this deliberately does not fix.

Omit the body only when all four are genuinely empty. For a typo fix, they are.

## Do not write

- Process narration: "as requested", "per feedback", "addressing review
  comments". The commit is not a message to the reviewer; it outlives them.
- Restated diffs: "changed foo to bar in baz.ts".
- Speculation as fact: "should improve performance" without a number. Either
  measure it and give the number, or say it is unmeasured.

## PR descriptions

Same content, plus what a reviewer needs that a bisector does not:

- **What to look at first** — the file where the actual decision lives. A
  reviewer's attention is finite and defaults to the first file alphabetically.
- **What you are unsure about** — name it. Reviewers reliably miss what they
  were not told to check, and this is the cheapest way to direct them.
- **How to try it** — the branch, the command, the URL.

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
