---
name: survive-a-dependency-outage
description: Respond when a third party or upstream service you do not control is down, and stop your own system from making it worse. Use when the failure is outside your code and outside your ability to fix.
---

# Survive a dependency outage

You cannot fix it. Everything you can control is on your side of the boundary,
and the first thing to control is your own system's contribution to the problem.

## First, stop making it worse

A dependency that is degraded will be taken fully down by its clients retrying.
If it is slow rather than dead, your retries are a meaningful share of its load.

- **Cut retries** to that dependency, or widen backoff sharply.
- **Open the circuit breaker** if you have one, manually if it has not tripped.
  Failing instantly is better for you and necessary for them.
- **Shed the optional work.** Anything calling them that is not required for
  your core operation should stop calling them now.

Failing fast also protects you: requests piled up waiting on a dead dependency
exhaust your own thread or connection pool, and then you are down too, for a
reason that has nothing to do with them (`diagnose-a-hang`).

## Then, degrade deliberately

Decide — and say out loud — which of these you are doing:

- **Serve stale.** Extend cache TTLs, serve the last known good value. Usually
  the best option and usually possible for longer than people assume.
- **Queue for later.** Accept the work, confirm to the user, process when they
  return. Requires that the operation is deferrable and idempotent.
- **Degrade the feature.** Hide the section, disable the button with an honest
  message.
- **Refuse cleanly.** Where correctness depends on them, an honest error beats a
  guess. Never fabricate a value from a failed call — a fallback price, a
  default permission, or an assumed "yes" is worse than an outage.

Whatever you choose, **make the degraded state visible** — to users where it
affects them, and in your own metrics either way.

## Watch for what queues up

The backlog is the second incident. While they are down, work accumulates:
queue depth, retry buffers, unsent webhooks, pending jobs.

Plan the recovery *before* they come back. A queue draining at full rate into a
service that has just recovered will knock it over again — throttle the drain,
and expect the recovery to be the more delicate half.

## Communicate with the boundary in mind

- Check their status page, and do not trust it — status pages lag, and partial
  outages routinely show green.
- Say in your own comms that the dependency is the cause, without waiting for
  them to confirm it. Your users need to know it is not their fault.
- Note the start time and symptoms precisely; you will need them for the
  writeup and possibly for a credit claim.

## Afterwards

The incident is theirs; the exposure is yours. `incident-writeup` still applies,
and the useful questions are: why did their failure become our failure, what did
we retry that we should not have, and what would have let us serve stale
instead. "The vendor was down" is a cause, not a conclusion.

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
