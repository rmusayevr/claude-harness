---
name: manage-a-rollout
description: Release a risky change progressively with abort criteria defined before it starts, so the decision to stop is mechanical rather than a judgment call under pressure. Use for canary, percentage, or staged releases.
---

# Manage a rollout

The purpose is to bound the blast radius: a defect reaches 1% of traffic instead
of 100%, and you find out while it is still cheap.

## Write the abort criteria before you start

This is the whole discipline. Once a rollout is underway there is enormous
pressure to interpret bad numbers charitably — you will be tired, it will be
late, and the graph will be ambiguous.

Decide in advance, in writing:

- **The metric.** Error rate, p99 latency, conversion, queue depth. Name it.
- **The threshold.** "Error rate above 1% for 5 minutes." A number, not "if it
  looks bad."
- **The comparison.** Against the control group, or the same window yesterday.
  Not against the last five minutes.
- **The action.** Roll back. Not "investigate" — investigation happens after
  the rollback.

Then hold yourself to them. A threshold you renegotiate while it is being
crossed was never a threshold.

## Stage it

1. **Internal / dogfood.** Your own team, real traffic, no customers.
2. **Canary.** One instance or ~1%. Enough to see errors, small enough that
   nobody notices.
3. **Ramp.** 5%, 25%, 50%, 100%, with a **bake time** at each step.
4. **Full**, and only then remove the old path.

Bake time is not a formality. It must be long enough for the slow signals —
cache expiry, background jobs, the hourly cron, a session that started before
the change. Ramping faster than your slowest feedback loop means every stage
is measuring the previous stage's absence of data.

## Make the population coherent

Split on a stable key — user id, tenant, session — hashed. Splitting per
request means a single user gets old and new behavior alternately, which
produces incoherent state and bug reports nobody can reproduce.

Watch out for a canary that is not representative: routing 1% by geography, or
to the least-loaded instance, samples a population that will not surface the
problem.

## Compare against a control

At 25%, the other 75% is your control group, and it is far more informative than
a historical baseline — it accounts for traffic shifts, dependency slowness, and
today being unusual. Compare the two directly.

If the metric moves for *both*, the cause is not your change, and rolling back
will not help.

## Know how to stop, and prove it

Before starting, confirm the rollback path works — the flag flips, the previous
version is still deployable, the schema is compatible in both directions. A
rollout with an untested abort is a full deploy with extra steps.

Say who is watching and until when. A rollout left at 50% overnight because
everyone assumed someone else was watching is a common and avoidable incident.

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
