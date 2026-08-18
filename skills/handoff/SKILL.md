---
name: handoff
description: Write a pause or handoff note that records what was ruled out and why, not just where things stand. Use when stopping mid-task, ending a session, or when context is about to compact.
---

# Handoff

The next reader — a colleague, or you in a fresh context — will re-derive
everything you do not write down. The expensive part is not the current state;
it is the dead ends, which look inviting precisely because they have not been
tried yet from the outside.

## The note

### 1. Current belief, with confidence
> "I think the token refresh races with the retry interceptor. Fairly confident —
> the timing lines up — but I have not proven it."

Not "investigating the auth bug". State what you currently think is true and how
much you trust it. A wrong belief clearly labeled is more useful than no belief,
because the reader can attack it.

### 2. Ruled out, and how
The most valuable section, and the one always omitted.

> - Not a clock skew issue — set the container clock 5m ahead, symptom unchanged.
> - Not the CDN cache — reproduced with `Cache-Control: no-store`.

Each entry needs the *method*, not just the conclusion. "Not the cache" without
evidence gets re-checked immediately; the reader has no way to know whether you
tested it or assumed it. Include the ones you ruled out by reasoning, marked as
such — those are the ones worth re-examining.

### 3. Exact next action
Not a direction. A command or an edit.

> Next: add a log line at `interceptor.ts:88` recording the token expiry at
> retry time, then run `npm run e2e -- --grep "session"` and look for a retry
> that starts within 200ms of an expiry.

"Continue debugging the interceptor" makes the reader redo your planning.

### 4. How to get back here
The branch, uncommitted files, the reproduction command, any service that must
be running, any state you mutated by hand. Anything a fresh clone would lack.

State explicitly what is uncommitted — a handoff that assumes the reader has your
working tree fails silently.

### 5. Live and dangerous
Anything left running, half-migrated, feature-flagged on, or manually edited in
a shared environment. Put it last so it is the final thing read.

## Where it goes

A file in the repo, not just a chat message: chat scrolls away and compaction
eats it. `HANDOFF.md`, a scratch file, or the PR description. Say where you put
it.

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
