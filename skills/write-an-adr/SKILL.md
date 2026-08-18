---
name: write-an-adr
description: Record an architectural decision as an immutable dated entry capturing the constraints and the rejected options, so it can be revisited on evidence rather than re-argued. Use when a choice will be expensive to reverse.
---

# Write an ADR

An architecture decision record exists so that a future team can tell the
difference between *a considered trade-off* and *an accident*. Without it, both
look identical in the code, and the considered ones get undone by someone who
did not know the constraint.

Write one when a decision is expensive to reverse: a datastore, a protocol, an
auth model, a boundary between services, a language or framework, a schema shape
many things will depend on.

Do not write one for a decision you could change in an afternoon.

## The sections that carry the value

**Context** — the forces at the time. Load, team size, deadlines, existing
systems, what you did not know yet. This is what dates the decision, and what
lets a reader judge whether the situation still holds. Without it, an ADR reads
as a permanent rule instead of a response to circumstances.

**Decision** — one paragraph, active voice, stated as a commitment.
"We will store sessions in Redis with a 24h TTL."

**Options rejected, and why** — the most valuable section and the one usually
missing. Each rejected option with the actual reason it lost. This is what stops
the same debate recurring every eighteen months, and what makes reversal
possible: when the reason no longer holds, the decision is ready to revisit.

**Consequences** — what this makes easy, what it makes hard, and what it
forecloses. Include the costs you are accepting. An ADR listing only benefits is
advocacy, not a record, and future readers will discount it.

**What would change our mind** — the specific condition that should trigger
revisiting. "If we exceed 50k concurrent sessions" or "if the vendor's SLA drops
below…". This converts the ADR from a monument into an instrument.

## Immutability

An ADR is a record of what was decided *then*. Do not edit it when the decision
changes.

Write a new ADR that supersedes it, and add one line to the old one pointing
forward. The history of decisions is itself the information — a reader needs to
see that you tried the other thing for a year and it did not work. Editing in
place destroys exactly that.

## Keep them findable and short

In the repo, numbered, in the same version control as the code they govern.
One page. An ADR nobody reads is worse than none, because it creates the
impression the reasoning is recorded somewhere.

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
