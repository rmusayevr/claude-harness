---
name: design-failure-behavior
description: Decide per dependency what happens when it fails — fail fast, degrade, queue, or cache — instead of letting the default be an exception nobody planned for. Use when adding a call to anything that can be unavailable.
---

# Design failure behavior

Every call that leaves your process will fail sometime. The default behavior is
whatever your language does with an unhandled exception, which is a decision
made by someone who had never heard of your product.

Decide deliberately, per call site. The right answer differs between two calls
in the same function.

## The question: is this dependency *required* for this operation?

| Answer | Behavior | Example |
|---|---|---|
| Required | **Fail fast**, with a clear error naming what was unavailable | The database for a write |
| Optional, improves the result | **Degrade** — return without it, log, carry on | Recommendations on a product page |
| Required, but deferrable | **Queue** and confirm later | Sending a receipt email |
| Required, tolerates staleness | **Serve stale** from cache and refresh in the background | Feature flag config |

The common defect is treating an optional dependency as required. An analytics
call, a logging sidecar, or an enrichment service that takes down checkout is
almost always an accident of error propagation rather than a decision.

The inverse is worse: swallowing a failure from something genuinely required,
so the operation reports success and the data is silently wrong.

## Fail fast well

- **Say what was unavailable and what the caller should do.** "Payment provider
  timed out after 5s, the charge was not made, safe to retry" — not
  "Internal server error".
- **Preserve the cause.** Attach it (`{ cause: e }`, `raise … from e`, `%w`).
  A wrapper that discards the original is the most expensive line in most
  codebases; see `trace-a-failure`.
- **Distinguish retryable from permanent.** The caller cannot guess, and will
  retry a 400 forever, or give up on a 503 that would have worked.

## Degrade well

- **The degraded state must be visible.** A page silently missing a section
  looks like a product decision. Log it, count it, and where the user is
  affected, tell them.
- **Decide what the empty state means.** Zero recommendations because the
  service is down is not the same as zero because there are none; see
  `loading-and-empty`.
- **Never degrade something safety-relevant.** Failing open on an authorization
  check, a fraud check, or a rate limit is a vulnerability, not resilience.

## Bound everything

- **A timeout on every remote call.** No exceptions. A call with no timeout is
  an unbounded hang waiting for a bad day; see `diagnose-a-hang`.
- **Inner timeouts shorter than outer ones**, or the outer gives up while the
  inner still holds resources.
- **Retries with backoff, jitter, and a cap** — and only for retryable errors,
  and only where the operation is idempotent (`make-it-idempotent`).
  Synchronized retries from many clients are how a slow dependency becomes a
  dead one.
- **A circuit breaker** for anything called often. Failing instantly during a
  known outage is better for you and necessary for them.

## Then test it

Turn the dependency off and run the operation. Every branch above is code that
only executes on a bad day, and code that has never run is not a plan.

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
