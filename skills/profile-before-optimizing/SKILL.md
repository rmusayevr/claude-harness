---
name: profile-before-optimizing
description: Measure where time or memory actually goes before changing anything for speed, and prove the change helped with the same measurement. Use when something is slow, or when tempted to optimize.
---

# Profile before optimizing

Intuition about performance is wrong often enough that acting on it is a coin
flip that also costs readability. The measurement is usually five minutes.

## Establish the number first

Before touching code, answer: **what is slow, measured how, and what is
acceptable?**

- "The report page takes 8s at p95; it needs to be under 2s."
- Not "the report page feels slow."

Without a target you cannot tell when to stop, and optimization has no natural
end — there is always another 5%.

## Measure the right dimension

Latency, throughput, and resource use are different problems with different
fixes. A change that improves one often degrades another. Know which one you
are being asked about.

Use **percentiles, not averages**. An average hides the tail entirely, and the
tail is what users complain about. p50 tells you the common experience; p99
tells you how many people are having a bad day.

## Find the actual hotspot

Use a profiler, not reasoning:

- **Sampling profiler** for CPU. Read it as a flame graph — width is total time,
  and the widest box at the bottom of a stack is where the time went.
- **Wall-clock or async profiling** when the process is mostly waiting. A CPU
  profile of an I/O-bound service shows almost nothing and looks like it is fine.
- **Query logs and `EXPLAIN`** for anything with a database. In web
  applications the answer is a query more often than it is code.
- **Heap snapshots**, two of them, diffed, for memory growth.

## The usual answers, in order of how often they are the answer

1. **N+1 queries** — one query per row in a loop. Look for a query count that
   scales with result size.
2. **A missing index**, or an index the query cannot use because of a function
   applied to the column.
3. **Fetching far more than needed** — `SELECT *`, no pagination, a payload
   with fields nobody reads.
4. **A serial loop of network calls** that could be concurrent.
5. **Repeated work** — the same computation per item instead of hoisted out.
6. **Only then** — algorithmic complexity in your own code.

Most "slow code" is not slow code. It is a fast function called a surprising
number of times, or waiting on something else.

## After the change

Re-run the **same measurement**, same conditions, same data volume, and report
both numbers. "It feels faster" is not a result.

Then check what got worse. A cache introduces staleness, batching introduces
latency for the first item, an index slows writes. Name the trade you made.

## When not to

If the measurement shows the code is not the bottleneck, say so and stop. An
optimization that does not move the number is a permanent readability cost for
nothing, and it is much harder to argue for removing later than it was to add.

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
