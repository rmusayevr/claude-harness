---
name: verify-a-data-change
description: Prove a migration, backfill, or bulk update did what was intended by counting, sampling, and checking invariants — before and after. Use after any statement that touched many rows.
---

# Verify a data change

A bulk write reports how many rows it changed. It does not report whether those
were the right rows, and that number looks equally plausible either way.

## Before running: predict the number

Write down the expected count, from a `SELECT` with the same predicate:

```sql
SELECT count(*) FROM orders WHERE status = 'pending' AND created_at < now() - interval '30 days';
```

**If the actual count differs from the prediction, stop and reconcile.** Not
"it's close enough" — a predicate that matched 4,102 rows when you expected
3,850 matched something you did not intend, and you now know that while it is
still cheap.

This one step catches most of what goes wrong, and it takes a minute.

## After: the four checks

1. **Count.** Rows now in the new state, rows still in the old. Does the sum
   match the original total? A drop means rows went somewhere unaccounted for.
2. **Sample and read.** Pull ten changed rows and actually look at them, plus
   ten that were *not* supposed to change. The second sample is the one that
   catches an over-broad predicate, and it is the one people skip.
3. **Invariants.** The properties that must hold regardless: no orphans, no
   negative balances, totals still reconcile against the source of truth, no
   duplicate keys, no nulls in a column that must be populated. Write these as
   queries returning zero rows — a non-empty result is a defect.
4. **The boundaries.** Rows at the edge of the predicate: the oldest, the
   newest, the one exactly at the cutoff. Off-by-one in a date range silently
   moves a day's worth of records.

## Check what you did not intend to touch

`updated_at` bumped on every row makes downstream sync jobs reprocess
everything. A trigger fired that sent emails. A cascade removed related rows.

Ask what *else* watches this table — triggers, CDC streams, cache invalidation,
search indexing, audit logs, replicas. A data change is rarely local.

## Verify the application, not just the data

The rows can be correct and the product still broken: a cache holding the old
values, a materialized view not refreshed, a search index stale, a client with
the previous shape. Load the actual page.

## If it is wrong

Do not write a corrective `UPDATE` immediately — that is a second unverified
bulk write on top of an unknown state, and it is how a recoverable mistake
becomes an unrecoverable one. Establish exactly which rows are wrong, in what
way, then reverse deliberately. See `mitigate-first` if users are affected now.

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
