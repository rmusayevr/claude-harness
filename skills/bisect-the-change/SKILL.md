---
name: bisect-the-change
description: Find the commit, config change, or dependency bump that introduced a regression by binary search, including when the history has no clean build points. Use when something worked before and does not now.
---

# Bisect

"It used to work" is the most useful sentence in debugging, and the most
commonly wasted. It converts an open-ended search of the whole codebase into
log₂(n) mechanical steps.

## Make the test scriptable first

Before starting, get a command that exits 0 for good and non-zero for bad, in
under a minute if possible. `git bisect run ./check.sh` is worth ten manual
rounds, and manual bisect is where the mistakes happen — one mislabelled
`good`/`bad` sends the whole search into the wrong half and you will not know.

The script must **fail for the specific symptom**, not for any failure. During a
bisect you will land on commits that are broken for unrelated reasons. Those
need `git bisect skip`, and a script that just checks "did the build pass" marks
them `bad` and lies to you.

## Establish both ends before searching

Verify the "good" commit is actually good by running the check on it. A bisect
started from an assumed-good end that is secretly bad returns a confident wrong
answer, and you will trust it because bisect feels mechanical.

## When the code is not the variable

If bisect lands on a commit that obviously cannot cause the symptom, the
variable is not the code. Bisect the other axes:

- **Dependencies** — lockfile changes. `git bisect` over the lockfile alone, or
  pin the whole tree to an older resolution date.
- **Data** — restore yesterday's snapshot against today's code.
- **Config and environment** — diff the env between working and broken. A
  bisect that crosses a config migration is testing two variables at once.
- **Time** — code that broke with no deploy is usually a certificate, a token, a
  DST boundary, a leap day, or a scheduled job that ran for the first time.

## When there is no clean history

Squashed merges and long-lived branches leave bisect landing on huge commits.
Bisect to the merge, then bisect *inside* it with `git bisect start --
<subdir>` or by replaying the branch's own commits onto the parent.

## When you find it

The commit that introduced the symptom is not necessarily the commit that is
wrong. A change that exposes a latent bug is a real finding, but reverting it
often just re-hides the defect. Read the commit and decide which you have —
then fix accordingly, and say which one it was.

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
