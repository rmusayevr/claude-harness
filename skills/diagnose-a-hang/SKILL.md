---
name: diagnose-a-hang
description: Find what a stalled process is waiting on when there is no error and no result — deadlocks, exhausted pools, unbounded waits. Use when something hangs, times out, or silently never finishes.
---

# Diagnose a hang

A hang gives you no error to read and no wrong answer to inspect. But it has one
advantage over every other bug: **the evidence is still there, frozen, right
now.** Capture it before you restart anything — restarting is the reflex, and it
destroys the only copy of the state that explains the failure.

## Capture the stacks first

Every runtime has a way to ask "what is every thread or task doing":

| Runtime | Command |
|---|---|
| JVM | `jstack <pid>`, or `kill -3` |
| Python | `py-spy dump --pid <pid>` |
| Node | `kill -SIGQUIT`, or the inspector with `--inspect` |
| Go | `SIGQUIT` for a full goroutine dump, or `/debug/pprof/goroutine?debug=2` |
| Postgres | `SELECT * FROM pg_stat_activity WHERE state <> 'idle'` |
| Any | `gdb -p <pid>` and `thread apply all bt` as a last resort |

Take **two dumps, thirty seconds apart**. Identical stacks mean truly blocked;
changing stacks mean it is doing something slowly, which is a different problem
with a different fix.

## Read the dump for what is *waiting*

Ignore the threads doing work. Look for what is parked, and on what:

- **Two threads holding what the other wants** — a deadlock. Fix by ordering
  lock acquisition consistently, never by adding a timeout and calling it done.
- **Many threads parked on the same monitor or pool** — contention, or
  exhaustion. See below.
- **One thread in a network read with no timeout** — the classic. A socket read
  with no deadline waits forever, and "forever" is exactly what you are looking
  at.

## Exhaustion is the most common cause and looks like a deadlock

A connection pool, thread pool, or semaphore with every permit taken produces a
hang identical to a deadlock in every symptom.

Check pool metrics: in-use vs. maximum. If in use == max, the question is not
"why is it hanging" but "who is holding connections and not returning them".
Usual answers: a connection leaked on an error path, a request that acquires a
second connection while holding the first, or a slow query that outlives its
caller.

## The specific patterns worth checking

- **Nested acquisition.** A handler that takes a pool connection and then calls
  something that takes another will deadlock at exactly `pool_size` concurrent
  requests, and never below it. This is why it works in testing.
- **A timeout longer than its caller's.** The inner call waits 60s inside a
  30s outer budget, so the outer times out while the inner still holds
  resources. Inner timeouts must be shorter than outer ones, always.
- **`await` on something never resolved** — a promise with no rejection path, a
  channel nobody sends to, a callback dropped on an error branch.
- **Sync work on the event loop.** Node and single-threaded runtimes stop
  serving everything, so the symptom is total, not partial.
- **The lock held across an I/O call.** Correct until the I/O is slow, then it
  serializes the whole system.

## Prove it before fixing

State it as a claim: *"thread A holds X, waits for Y; thread B holds Y, waits
for X"* or *"all 20 pool connections are held by requests blocked on the
payments API"*. If you cannot name what holds what, you have a theory, and
adding a timeout to a theory just converts a hang into an error under load.

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
