---
name: write-a-bug-report
description: Write up a defect so it can be acted on without a follow-up conversation, separating what was observed from what was expected from what you think is happening. Use when filing or forwarding a bug.
---

# Write a bug report

A report is good when someone who was not there can reproduce it and knows
whether they have fixed it. Most reports fail on one of those two.

## Separate the three things people merge

Keep them in distinct sections, explicitly labelled. Merging them is what makes
a report unusable, because the reader cannot tell which parts are evidence.

1. **Observed** — what actually happened, in plain fact. The exact error text,
   the wrong number, the screenshot. No interpretation.
2. **Expected** — what should have happened, and *why you believe that*. The
   spec, the docs, the previous behavior, the other 99 records that work. A
   surprising number of bugs are disagreements about the requirement, and this
   line surfaces them immediately.
3. **Suspected** — your theory, clearly marked as a theory.

The third one is genuinely useful and routinely poisons the first two. A
reader who accepts your theory will stop looking where you already looked, so
label it and keep it out of the evidence.

## The reproduction is the report

- **Numbered steps from a known starting state.** "Log in as a user with no
  saved cards" — not "go to checkout", which assumes everything you had set up.
- **Real identifiers.** Order id, user id, request id, timestamp with timezone.
  These let someone read the actual logs instead of guessing.
- **Frequency.** Every time, or once out of ten? An intermittent bug reported
  as deterministic wastes an afternoon before anyone realises. See
  `reproduce-first` for the rate discipline.
- **When it started**, and what changed near then, if you know.

## Environment, only where it might matter

Version, browser, OS, region, account type, feature flags. Not a hardware dump —
the fields you list should be ones that could plausibly differ.

## State the impact, not the urgency

"Three enterprise customers cannot invoice, since Tuesday" is impact, and the
reader can prioritize it. "URGENT P1!!" is a claim about someone else's queue
and will be discounted.

Say whether there is a workaround, and whether data is being lost or corrupted —
that changes the response, not just the priority.

## Say what you already checked

The dead ends, and how you eliminated them. Otherwise the assignee repeats
them — this is the same discipline as `handoff`, and for the same reason.

## Before filing

Search for an existing report. A duplicate splits the evidence across two
tickets, and both look thinner than the one combined report would have.

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
