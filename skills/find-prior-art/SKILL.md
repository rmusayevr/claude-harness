---
name: find-prior-art
description: Search the codebase for an existing solution before writing a new one, searching by concept and by shape rather than by the name you would have chosen. Use before adding a utility, helper, or pattern.
---

# Find prior art

The second implementation of something is more expensive than the first, because
now both must be maintained and they will diverge. The cost is paid by whoever
has to work out which one is authoritative — usually at the worst moment.

## Search by concept, not by your name for it

The reason duplicates get written is that the existing version is called
something else. Your search for `formatCurrency` misses `toMoneyString`.

Search for:

- **The domain word**, not the technical one: `invoice`, `refund`, `tenant`.
- **The distinctive constant or literal.** A currency symbol, a magic number, a
  regex fragment, an error string, the API path. Literals do not get renamed the
  way identifiers do, so they are the most reliable index into a codebase.
- **The dependency.** If the job needs a specific library, grep for its import.
  Anyone who solved this already imported the same thing.
- **The shape.** Search for a call to the underlying primitive — the fetch
  wrapper, the retry helper, the date parser.

Use several spellings: camelCase, snake_case, and the hyphenated file-name form.

## Also look where code goes to be forgotten

`utils/`, `helpers/`, `lib/`, `common/`, `shared/`, and the test directory —
test helpers routinely contain a mature version of the thing you are about to
write. Check sibling packages in a monorepo and any internal package registry.

## What to do with what you find

- **It fits** — use it, even if the name is wrong. Rename later, separately.
- **It nearly fits** — extend it. A parameter with a default keeps one
  implementation. Two near-identical functions is the outcome to avoid.
- **It does not fit, but exists** — say so explicitly in the commit and say why
  you did not use it. Otherwise the next reader assumes you did not look, and
  the one after that writes a third.
- **It is the *wrong* implementation** and yours is better — then this is a
  migration, not an addition. Do not leave both live without a plan; see
  `deprecate`.

## The reverse check

Before finishing, search for what you just wrote, using the words *someone else*
would have used. Finding your own duplicate at that point costs ten minutes.
Finding it in review costs a rewrite; finding it in six months costs a bug
fixed in one copy.

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
