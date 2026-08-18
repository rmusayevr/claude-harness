---
name: trace-a-failure
description: Follow an error back to its true origin when the trace names the wrong place, across async, process, and wrapper boundaries that discarded the cause. Use when you HAVE an error or stack trace to follow.
---

# Trace a failure to its origin

The place an error surfaces and the place it originates are usually different,
and every boundary between them degrades the evidence.

## Read the trace correctly

- **The top frame is where it was noticed, not where it went wrong.** Scan down
  for the deepest frame *in your own code*. Framework frames above it are
  reporting, not causing.
- **Follow the `caused by` chain to the bottom.** The bottom exception is the
  real one. The wrapping layers each added a message that is more general and
  less true than the one beneath it.
- **A trace with no frames of yours** means the failure happened in a callback,
  a worker, or a different process. The trace you are reading was constructed
  where it was caught, so it cannot contain the origin. Stop reading it.

## What each boundary destroys

| Boundary | What is lost | How to recover it |
|---|---|---|
| `async` / promise / thread | Frames before the await point | Async stack traces on; capture at the call site, not the catch |
| Process / service | Everything | A correlation id logged at both ends |
| Serialization (JSON, RPC) | The error type, and often the message | Log the raw error before it crosses |
| `catch (e) { throw new Error('failed') }` | The original entirely | Fix this — it is the single most expensive line in most codebases |
| Retry wrapper | Which attempt failed and why the earlier ones did | Log every attempt, not just the last |

## The catch that discards

When you find `catch { throw new Error('something went wrong') }`, you have
found why the bug is hard, and often the highest-value change available. Attach
the cause (`{ cause: e }`, `raise ... from e`, `%w`) before continuing to debug —
you may not need the rest of this procedure.

## Establish the boundary first

Do not read code across the whole path. Determine *which side* of each boundary
the failure originates on, then only read that side:

1. Log or breakpoint at the boundary, both entering and leaving.
2. Confirm the input crossing in is already wrong, or still correct.
3. That answer halves the search. Repeat at the next boundary in.

Reading every layer looking for something suspicious costs more and finds
plausible causes rather than the actual one.

## Errors that name the wrong thing

`undefined is not a function`, `NullPointerException`, `connection refused` —
these name the *symptom's location*, which is downstream of a value that was
wrong earlier and travelled. Find where the bad value was created, not where it
was finally dereferenced. Print it at each hop backwards until it is correct;
the last hop where it was fine is the one that broke it.

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
