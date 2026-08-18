---
name: refactor-safely
description: Pin existing behavior with characterization tests before restructuring code, so that any behavior change surfaces as a test failure rather than a later incident. Use before rewriting, extracting, or reorganizing working code.
---

# Refactor safely

A refactor is behavior-preserving by definition. If behavior changed, it was not
a refactor — it was an undeclared change, and it shipped inside a diff nobody
reviewed for behavior.

## Characterization tests come first

Before restructuring, write tests that pin what the code does **right now**.

- **Pin the bugs too.** If the function returns `null` for empty input, assert
  `null`. You are recording current behavior, not desired behavior. A
  characterization test that asserts what the code *should* do fails immediately
  and tells you nothing about your refactor.
- **Generate them where you can.** Feed real inputs through the old code, record
  the outputs, assert them. Production logs and existing fixtures are a source
  of realistic input; invented inputs only exercise the paths you already
  understand.
- **Mark them.** Name them `characterizes_*` or keep them in a separate file, so
  later readers know these assertions describe legacy behavior and are not
  specifications. Otherwise someone will "fix" a pinned bug's test.

If you cannot characterize a piece of code, you cannot safely refactor it. Say
so — that is a real finding about the change's risk, not a reason to proceed
carefully and hope.

## Separate the commits, strictly

1. Add characterization tests. Commit. **Tests pass against unchanged code.**
2. Refactor. Commit. **The same tests pass, unmodified.**
3. Change behavior, if that was ever the goal. Commit, updating tests with a
   clear reason for each change.

If step 2 required editing a test, one of two things is true: the test asserted
implementation detail rather than behavior, or your refactor changed behavior.
Determine which before continuing. Do not edit the test to match and move on —
that is the exact moment a refactor becomes a silent regression.

## Restructure in the direction of the seam

Prefer refactors where a mechanical, reversible step exists: extract function,
inline, rename, move. Do these one at a time with tests between, using the
tooling's rename/extract where available rather than editing by hand — hand
edits introduce typos in strings and comments that no compiler catches.

Avoid the rewrite-in-place, where the code is broken for the middle 80% of the
work and correctness is only checked at the end.

## Know when to stop

A refactor that keeps growing is telling you the boundaries are wrong. Stop,
commit what is coherent, and reconsider — see `scope-change`. A half-finished
restructuring left in the tree is worse than either the old shape or the new
one, because it now requires knowing both.

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
