---
name: check-the-edges
description: Walk a fixed checklist of boundary inputs — empty, one, many, duplicate, unordered, oversized, hostile — against a function or endpoint. Use after the happy path works, and before calling anything done.
---

# Check the edges

The happy path is the case you had in mind while writing, so it is the one case
you can be confident about. Everything below is a case you did not have in mind.

Walk the list. It is short, and the point is that it is *fixed* — recalling
edge cases from memory reproduces the same blind spots that wrote the bug.

## Cardinality

- **Zero.** Empty list, no rows, no matches. Does it return empty, null, throw,
  or divide by the count?
- **One.** Off-by-one and "join the last element" formatting live here.
- **Two.** The smallest case where order and pairing matter.
- **Many.** Enough to page, batch, or time out. Does it load all of them into
  memory?
- **Exactly at the limit**, and one over. Page size, batch size, max length,
  rate limit, plan quota.

## Shape

- **Null vs. empty vs. absent** — three different states that code routinely
  conflates. `""`, `null`, and "key not present" often take different branches.
- **Duplicates**, where uniqueness was assumed.
- **Unordered input**, where ordering was assumed but never enforced.
- **Whitespace, case, and unicode** — leading/trailing spaces, mixed case in a
  lookup key, emoji and combining characters, right-to-left text, a name with an
  apostrophe.
- **Very long** — a 400-character name, a 10MB payload. What truncates silently?

## Numbers, time, identity

- **Zero, negative, and the maximum.** Also `-0`, `NaN`, `Infinity`, and float
  precision on money (which should not be a float).
- **Timezones and DST.** Midnight boundaries, "today" computed in the wrong
  zone, a duplicated or missing hour.
- **The same entity twice** — double-submit, retried webhook, replayed message.
  If the operation is not idempotent, this is a defect regardless of how
  unlikely it seems.

## Failure and concurrency

- **The dependency is down**, slow, or returns a 500 with an HTML error page
  where you expected JSON.
- **Partial failure** — three of five succeeded. What state is the system in?
- **Two at once** — same user, same row, simultaneously. Last-write-wins is a
  decision; make it deliberately or find a lost update.
- **Interrupted mid-way** — the process dies between two writes.

## Permissions

The other user's id. The deleted record. The expired token. Being logged out
mid-flow. An authorization check that runs after the expensive query still leaks
timing, and one that runs only in the UI does not run at all.

## How to use this

Do not test all of it. Read the list against the specific thing you built and
pick the four or five that are *plausible here*. The value is in reading a fixed
list; the cost is in testing items that cannot occur.

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
