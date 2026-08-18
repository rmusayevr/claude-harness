---
name: isolate-the-layer
description: Find which component owns a fault by probing each directly and bypassing the rest. Use when there is NO useful error to follow — a hang, wrong data, or silence that could come from any of several parts.
---

# Isolate the layer

Reading code across a whole request path is linear in the size of the system.
Probing each layer directly is logarithmic in the number of layers. Do the
second one.

Use when the answer to "where is this broken?" is currently "somewhere between
the browser and the database."

## Probe from both ends inward

Do not start at the top and read down. Pick the middle boundary and establish
which side of it the fault is on, then repeat inside that half.

A typical web path, with the direct probe for each layer:

| Layer | Bypass everything above it with |
|---|---|
| Database | Run the query in a client, by hand, with the same parameters |
| ORM / data layer | Log the generated SQL and run that string directly |
| Service / business logic | Call the function in a REPL or a one-off script |
| HTTP handler | `curl` the endpoint, bypassing the frontend entirely |
| Network / proxy / CDN | `curl` the origin directly, then through the proxy |
| Client | Compare the request the client sent against the `curl` that works |

The first probe that behaves *correctly* puts the fault above it. The first that
misbehaves puts the fault at or below it.

## The parameters must be identical

This is where the procedure fails in practice. When your direct probe works and
the real path does not, the difference is usually not the layer — it is that you
typed different parameters, ran as a different user, hit a different database,
or your client sent a header you did not reproduce.

Capture the real inputs (log the actual query, copy the request as `curl` from
devtools) rather than reconstructing them from what you believe they are.

## Isolating without a bypass

Where you cannot skip a layer, make it inert instead:

- Replace one dependency with a stub returning known-good data. If the symptom
  persists, that dependency is innocent.
- Feed known-bad data to a layer you believe is fine. If it doesn't fail, it
  isn't validating what you thought.
- Disable caching. A cache turns "broken" into "broken sometimes", which reads
  as a race and wastes hours.

## When every layer works alone

The fault is in the interaction, and the usual suspects are narrow: encoding
(unicode, escaping, encoding applied twice), timeouts stacked so an inner one
exceeds an outer one, connection pool exhaustion, and any retry that is not
idempotent. Check these before concluding the layers are fine.

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
