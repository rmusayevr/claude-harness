---
name: review-for-data-loss
description: Check a change specifically for ways it can destroy or corrupt data that cannot be reconstructed. Use before merging anything that writes, deletes, transforms, or expires stored records.
---

# Review for data loss

Most defects cost time. This class costs data, and data has no rollback. A
review pass aimed only at this question finds things a general review misses,
because a general review is looking for wrongness and this is looking for
*irreversibility*.

## The question for every write path

**If this runs with the wrong input, what cannot be reconstructed?**

Not "is it correct" — assume it is wrong and ask what survives.

## Where the loss hides

- **Unbounded destructive statements.** A `DELETE` or `UPDATE` whose `WHERE` is
  built from a variable that can be empty, null, or `undefined`. Many query
  builders drop an empty condition and produce an unfiltered statement. Check
  what happens when the filter is empty rather than assuming it cannot be.
- **Overwrite instead of merge.** A `PUT` or full-object save that writes every
  field, blanking the ones the caller did not supply. Two clients with different
  versions of a schema will silently erase each other's fields.
- **Migrations that transform in place.** A one-way conversion with no copy of
  the original. See `migrate-data`; the relevant part here is whether the
  pre-image still exists anywhere after the change.
- **Cascading deletes**, especially newly added ones. A foreign key gaining
  `ON DELETE CASCADE` changes the blast radius of every existing delete path in
  the system, none of which are in the diff.
- **Truncation on write.** A column narrower than the value, a field capped by
  the client. Silent in some engines and permanent in all of them.
- **Retention and TTL.** A shortened expiry, a cleanup job whose predicate got
  wider, an idle-timeout that now catches active records.
- **Uniqueness collisions.** An upsert keyed on something not actually unique
  merges two distinct entities into one, and the second one is gone.
- **Encoding and precision.** Unicode through a latin-1 column, money in a
  float, timestamps losing the zone. Corruption is data loss that passes tests.

## What the change must have

- **A filter that cannot be empty.** Assert it, or fail closed.
- **A bound.** `LIMIT`, batch size, an expected-count check that aborts if the
  number of affected rows is surprising.
- **Soft delete or a recoverable window**, where the record has any value.
- **A verified backup** where none of the above is possible — verified means a
  restore was actually performed, not that a backup job reports success.

## Before approving

Ask the author what the recovery procedure is, and treat a vague answer as a
finding. "We have backups" is not a procedure; "restore the table from the
nightly snapshot, losing up to 24h of writes, here is the command" is.

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
