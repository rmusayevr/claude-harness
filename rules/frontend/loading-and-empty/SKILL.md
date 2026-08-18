---
name: loading-and-empty
description: Enumerate the four states any data-backed UI has — loading, empty, error, populated — and check the transitions between them. Use when building or changing a view that fetches data.
---

# Four states, and the transitions between them

Every data-backed view has four states. Implementations reliably ship two of
them, because the developer's machine has fast data and no failures.

| State | Ships broken as | What it must not do |
|---|---|---|
| **Loading** | Nothing rendered, or a full-page spinner | Shift layout when data arrives |
| **Empty** | The loading state, forever | Look like an error |
| **Error** | A blank region | Discard what the user typed |
| **Populated** | The only one tested | — |

## Empty is not error, and neither is loading

"No results" and "the request failed" are different facts and need different
copy and different affordances. A user who sees "No invoices" when the API is
down will stop looking, and will report the bug days later as data loss.

An empty state also needs to say *what would put something here*. "No invoices
yet" is a dead end; "No invoices yet — create one" is a UI.

## The transitions are where the bugs are

Check these explicitly. Static state review will not surface them:

- **Loading → populated:** does layout shift? Reserve the space, or use a
  skeleton with the real dimensions. A spinner that collapses to content is a
  guaranteed misclick.
- **Populated → loading (refetch):** does existing content vanish? Prefer
  keeping stale content visible with an inflight indicator. Blanking the screen
  on every refetch is the most common self-inflicted regression here.
- **Error → retry:** is the user's input still there? A form that clears on a
  failed submit loses work that was never the user's fault.
- **Out-of-order responses:** request A fires, then B; A returns last and
  overwrites B's newer data. Any typeahead or filter without cancellation has
  this bug. Abort the previous request or discard responses that are not the
  latest.
- **Unmount mid-flight:** the response arrives after the view is gone.

## Verify by making it slow

Throttle the network to 3G in devtools and force a failure — block the request
or return a 500. Every state you have not seen render is a state you have not
built, regardless of what the code says.

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
