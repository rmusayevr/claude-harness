---
name: migrate-data
description: Roll out a schema or data-shape change in reversible phases so that old and new code can run simultaneously. Use when changing a column, an index, a serialized format, or a stored contract.
---

# Migrate data

The constraint that determines the whole design: **during a deploy, old code and
new code run at the same time.** Every migration that treats deploy as an instant
is a migration that breaks under rollback.

## Expand / migrate / contract

Never change a field in one step. Four deploys, each independently reversible:

1. **Expand.** Add the new column/field, nullable, with a default. Deploy. Old
   code ignores it; nothing depends on it yet.
2. **Dual-write.** New code writes both old and new. Reads still come from old.
   Deploy. **Reversible** — rolling back only stops the redundant write.
3. **Backfill.** Populate the new field for existing rows, in batches, resumably.
   Then flip reads to the new field, keeping dual-write. Deploy. Rollback flips
   reads back, and the data is still there because you kept writing both.
4. **Contract.** Stop writing the old field, then drop it — as a *separate*
   deploy, after enough time to be certain nothing reads it.

Skipping to step 4 is the mistake. Dropping a column that old code still writes
takes down every instance that has not rolled yet.

## Backfills

- **Batch, with a resumable cursor.** A single `UPDATE` over a large table locks
  it and cannot be resumed after it dies at 80%. Record progress durably.
- **Throttle and observe.** Watch replication lag and lock contention while it
  runs. A backfill that saturates the primary is an outage caused by a change
  that was not supposed to be user-visible.
- **Make it idempotent.** It will be re-run. `WHERE new_col IS NULL` rather than
  a row-count offset.
- **Count before and after.** Know the expected number of affected rows and
  verify it. A backfill that touched a surprising number touched the wrong rows.

## Write the down path, and run it

Write the reverse migration and **execute it once against a copy** before
shipping the forward one. An untested down migration is decoration; you will
discover it does not work at the moment you need it most.

Where reversal is genuinely impossible — a dropped column, a lossy transform —
say so explicitly and take a backup you have verified restores. "It is
irreversible" is a fact the operator needs before the deploy, not after.

## Non-database migrations

The same phases apply to anything with stored shape: cache value formats
(version the key, do not reuse it with a new shape), queue message schemas
(consumers deploy before producers), API response fields, and files on disk.
A cache key whose value shape changed while the key stayed the same is the same
bug as dropping a column early, and it is harder to see.

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
