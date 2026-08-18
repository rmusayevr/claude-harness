---
name: debug-in-production
description: Investigate a fault that only appears in a live environment, read-only and without disturbing it. Use when the bug will not reproduce locally and the only instance of it is serving real users.
---

# Debug in production

Production is the only place this bug exists, so you have to look there. The
constraint is that everything you do is happening to real users at the same time.

## Read-only until proven otherwise

Start with what cannot change anything: logs, metrics, traces, `EXPLAIN`,
read replicas, a `SELECT`. Escalate to anything mutating only with a specific
reason, and prefer the narrowest form of it.

Specifically do not: attach a debugger and hit a breakpoint (it stops a thread
serving traffic), run an unbounded query against the primary, or enable verbose
logging globally on a busy service — the log volume becomes its own incident.

If the investigation itself risks the service, you are no longer debugging; see
`mitigate-first`.

## Correlate before you read

Get an identifier that spans the whole request path — trace id, request id,
user id, order id — and search on it. Reading logs by timestamp across services
does not work: clocks differ, and volume buries the one line you need.

If there is no correlation id, adding one is usually the highest-value change
available and worth doing before continuing.

## Ask the data what happened

The database holds a record of the outcome, and it does not have gaps the way
logs do:

- Find the specific affected row and read its actual current state. Half the
  time it disproves the reported symptom.
- Look for the shape of the failure: how many rows are affected, since when,
  do they share a tenant, a version, a region, a code path.
- Check the boundaries of the window. "Started at 14:02" is worth more than any
  amount of code reading, because it can be matched against deploys, config
  changes, and traffic shifts.

## Sample, do not stream

For extra visibility, add logging at a sampled rate, or scoped to one user, one
tenant, or one feature flag. Full-volume debug logging on a live service is a
self-inflicted outage, and the signal is worse because of the noise.

Set a removal reminder in the same commit. Temporary diagnostics are the most
reliably permanent code there is.

## Beware what changes under you

Production is a moving target. Data changes between your two queries, a deploy
lands mid-investigation, autoscaling replaces the instance holding your
evidence. Snapshot what matters — copy the rows, save the log excerpt, note the
deployed SHA — rather than planning to look again later.

## Leave a trail

Say in a shared channel what you are running before you run it. Someone else may
be mitigating the same incident, and two people independently changing
production is how one incident becomes two.

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
