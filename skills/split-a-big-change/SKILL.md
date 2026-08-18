---
name: split-a-big-change
description: Break work that is genuinely large into independently reviewable, independently revertible pieces that each land on their own. Use when a change is too big to review in one sitting but cannot be made smaller by scoping.
---

# Split a big change

`scope-change` is about *not doing more than you meant to*. This is the other
case: the work is genuinely large, correctly scoped, and still too big to land
in one piece.

A change nobody can review gets approved anyway, and that approval means
nothing. The upper bound is not a line count; it is **what one person can hold
in their head at once**.

## Cut along seams that let each piece ship alone

Each piece must be safe to merge and deploy on its own, even if the next one
never lands. Ordered by how well they usually work:

1. **Additive first.** New function, new column, new endpoint, unused by
   anything. Zero risk, and it makes the next diff small.
2. **Mechanical separate from meaningful.** Renames, moves, and formatting go in
   their own commit, reviewed by skimming. Bury a logic change inside a 2000-
   line rename and nobody will find it — including you.
3. **Behind a flag.** Land the new path dark, switch later. See
   `add-a-feature-flag`.
4. **Read before write.** Ship the query, the parsing, the display first; the
   mutation last. The dangerous piece then arrives as a small diff.
5. **Producer before consumer.** Write the new field before anything reads it;
   see `migrate-data` for the four-phase form.

Cut against the **direction of dependency**, not by directory. Three commits
that each touch six directories but stand alone are better than six commits per
directory that only work together.

## What each piece must satisfy

- Tests pass at that commit. Not "at the end of the series."
- It can be reverted without reverting the others.
- Its message says where it sits in the sequence and what is not yet true.

If a piece fails these, it is not a piece — it is half of one.

## When it genuinely will not split

Some changes are atomic: a protocol change on both sides, a lock-step schema
and code change. Then reduce review cost instead of diff size:

- Say **what to read first** and in what order.
- Separate the commits inside the PR even if they must merge together, so the
  reviewer can step through.
- Point out the two or three places where the actual decisions live. The rest is
  consequence, and reviewers cannot tell which is which without being told.

## Do not

Do not land pieces that are individually meaningless — twelve commits of
"part 4/12" force the reviewer to reassemble the whole thing mentally, which is
worse than one honest big diff.

Do not leave a half-migrated state indefinitely. A split that stalls at step
three leaves the codebase requiring knowledge of both shapes; finish or revert.

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
