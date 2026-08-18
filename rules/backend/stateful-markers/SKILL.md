---
name: stateful-markers
description: Audit any lock, flag, cursor, or in-progress marker written to a store for the path that clears it on crash, timeout, and redeploy. Use when adding state that outlives a single request.
---

# Markers need a clearing path

Any value written to a store to mean "something is in progress" is a promise to
delete it later. The write is one line. The delete is four paths, and three of
them are the ones nobody writes.

Applies to: Redis locks and flags, DB `status`/`locked_at` columns, queue
in-flight markers, lockfiles, `processing = true` booleans, idempotency keys.

## The four paths

For every marker you write, name the code that clears it when:

1. **Success** — the path everyone writes.
2. **Handled failure** — the `catch`. Check the marker is cleared *before* any
   early return inside it.
3. **Unhandled crash** — process killed, OOM, pod evicted. There is no code path
   here at all. This is what TTL is for.
4. **Deploy mid-flight** — the new version starts while the old version's
   markers are still set. If the marker's shape changed, the new version cannot
   clear the old one's.

Paths 3 and 4 have no `finally` block. If your answer for them is "the finally
block", the answer is wrong.

## The rule

**Set a TTL at write time, in the same call as the write.** Not a cleanup job,
not a sweeper, not a `finally`. A separate cleanup mechanism is itself code that
can fail to run, and it fails silently — the symptom is a marker that stays set,
which looks exactly like the system working normally until throughput drops.

```
SET lock:order:123 <owner> EX 30 NX     -- TTL and acquisition in one call
SET lock:order:123 <owner> NX           -- a leak with extra steps
```

If the work can legitimately outrun the TTL, the holder refreshes it while
alive. A marker whose TTL is set to "long enough to be safe" is a marker with no
TTL and a delay.

## Verifying

Kill the process mid-operation — `kill -9`, not a graceful stop — and confirm
the marker disappears on its own. If clearing it requires a human running a
command, the marker will one day require a human at 3am.

Then check what the *next* request does while the marker is still set. Blocking
forever and failing fast are both defensible; discovering which one you built
during an incident is not.

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
