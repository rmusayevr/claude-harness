---
name: smoke-test-a-deploy
description: Confirm after shipping that the new version is actually serving and the change you made is live, rather than trusting a green pipeline. Use immediately after any deploy or release.
---

# Smoke test a deploy

A green pipeline proves the artifact built and the orchestrator accepted it. It
does not prove your code is running, and those come apart more often than
anyone expects.

## First: is the new version actually serving?

Before checking behavior, establish identity. Otherwise a passing smoke test may
be passing against the old build.

- Hit a version or health endpoint that reports the deployed SHA.
- Confirm every instance rolled — a partial rollout serves both versions, so
  "it works" and "it is broken" are both true depending on which one you hit.
  Check repeatedly, or check the replica count.
- Confirm caches and CDNs are serving the new assets, not a stale bundle.

Ninety percent of "the deploy did not fix it" is this: the deploy did not
happen, rolled back automatically, or only reached some instances.

## Then: verify the specific thing you changed

Not a generic health check — a health endpoint returning 200 tells you the
process is up, which was rarely the risk.

Exercise the actual change, in production, with a real request. If you fixed
checkout for expired coupons, apply an expired coupon. Have the exact steps
ready *before* deploying, because writing them afterwards while watching error
rates is how they get skipped.

## Then: check what you did not change

The regression is never in the thing you were thinking about. Touch the two or
three highest-traffic paths — login, the main list view, whatever a user does
first. This takes a minute and catches the class of failure where a shared
change broke an unrelated caller.

## Watch the right window, on the right signal

- **Error rate and latency**, compared against the same time yesterday, not
  against five minutes ago. Traffic shape varies by hour and you will
  misread it.
- **Wait for the slow signals.** Background jobs, cron, cache expiry, and
  session-dependent paths can take an hour to show a problem. A deploy is not
  "verified" at the two-minute mark; say what window you watched.
- **Watch the dependency you affected**, not just your own service. Queue depth
  and downstream error rates surface the failures your own metrics miss.

## If it is wrong

Roll back first, investigate after — see `mitigate-first`. The smoke test
existing means you find out in two minutes rather than from a customer in two
hours, which is the entire value of doing it.

## Report what you checked

State the version you confirmed, the specific case you exercised, and the window
you watched. "Deployed" and "verified working in production" are different
claims.

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
