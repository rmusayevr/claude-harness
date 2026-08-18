---
name: add-a-feature-flag
description: Introduce a flag with its removal condition decided up front, so it decouples deploy from release without becoming permanent branching. Use when adding a toggle, kill switch, or gradual rollout.
---

# Add a feature flag

A flag buys one specific thing: **deploying code and releasing behavior become
separate events**, so a bad release is a config change rather than a rollback.

It costs one specific thing: every flag doubles the number of code paths, and
they multiply. Three live flags is eight possible systems, of which you test one.

## Decide the kind before adding it

The kind determines the lifetime, and a flag with no declared lifetime never
leaves.

| Kind | Lives for | Removed when |
|---|---|---|
| **Release** — ship dark, enable later | Days to weeks | Fully on, everywhere. Delete both the flag and the old path. |
| **Kill switch** — turn off a risky subsystem | Permanent, by design | Never, but it must be *tested*, or it will not work when needed |
| **Experiment** — A/B measurement | The experiment | The result is in. Losing arm deleted, not left dormant. |
| **Permission** — who may use this | Permanent | It is not a flag; it is authorization. Put it with the auth code. |

## Rules

- **Default off.** The flag's absence must mean the old behavior. A flag that
  fails open to new code has no safety value, and defaults are what apply when
  the config service is unreachable.
- **Fail to the safe side.** If the flag cannot be read — service down, cache
  cold, parse error — take the old path. Write this explicitly; do not rely on a
  null being falsy somewhere three layers down.
- **One decision point.** Read the flag once, near the boundary, and pass the
  result down. A flag consulted in eleven places produces a system where half
  the request is on and half is off.
- **Name it for the behavior, not the ticket.** `checkout_uses_new_pricing`
  beats `flag_CS_1841`, which is meaningless the day the ticket is closed.
- **Make the current state visible.** Log it with the request, or expose it on a
  status endpoint. A flag whose value you cannot observe turns every
  investigation into guesswork about which code actually ran.

## Removal is part of the change

Put the removal condition in the code comment and the ticket: *"delete once
100% for 2 weeks, expected <date>"*.

Old flags are worse than dead code, because dead code is obviously dead while a
stale flag looks like a live decision. When the flag goes, **delete the losing
branch too** — leaving it "in case we need it" is how a codebase accumulates
paths nobody has run in a year and nobody dares remove.

## Test both paths

Both sides of the flag must be exercised, in CI, at least once. A dark path
that has never run is not a safety mechanism; it is untested code that will be
turned on under pressure.

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
