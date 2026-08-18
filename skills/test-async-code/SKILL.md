---
name: test-async-code
description: Write tests for concurrent, timer-based, or event-driven code that fail deterministically rather than flaking. Use when a test involves waiting, polling, scheduling, or more than one thing in flight.
---

# Test async code

Almost every flaky test is an async test that raced. The fix is nearly always
the same: **stop waiting for time to pass, and wait for the condition instead.**

## Never sleep

`sleep(100)` encodes a guess about someone else's machine. It is simultaneously
too short on loaded CI (flake) and too long everywhere else (slow suite). It is
the single largest cause of both problems.

Replace with, in order of preference:

1. **Await the actual signal.** The promise, the future, the completion callback,
   the `done`. If the code under test offers no way to know it finished, that is
   a design finding worth more than the test.
2. **Poll for the condition** with a timeout: retry until the row exists or 2s
   pass, checking every 10ms. Fast when it works, and it fails with "condition
   never became true" rather than a mystery.
3. **Control the clock.** Fake timers let you advance time explicitly, turning a
   30-second retry test into an instant deterministic one. This is the only way
   to test backoff, expiry, and scheduling without waiting for real time.

## Control concurrency instead of hoping

- **Inject the scheduler or executor** so the test runs tasks in a controlled
  order rather than whatever the runtime picks today.
- **Use a barrier or latch** when you need two operations genuinely
  simultaneous — start both, release them together, and assert the outcome.
  Two calls issued back to back are not concurrent, they are usually sequential
  and the test proves nothing.
- **Run the race many times.** A concurrency test that passes once may have won
  the race. Loop it 100 times, or use a deterministic scheduler.

## Assert the absence of things too

Async bugs are frequently *extra* work: a duplicate write, a retry that fired
when it should not have, a listener called twice.

Count invocations rather than checking "it happened". `expect(handler).toHaveBeenCalledTimes(1)`
catches a class of bug that `toHaveBeenCalled()` never will.

## Clean up, or the next test flakes

Unawaited work outlives its test and fails inside an unrelated one, producing
failures that move around when you reorder the file. Cancel timers, close
connections, await pending tasks, and unsubscribe in teardown.

Make unhandled rejections fail the suite. A test that "passes" while an
exception vanishes into a detached promise is not passing.

## Diagnosing an existing flake

Do not reach for a retry annotation. Retrying converts a real defect into an
intermittent one nobody investigates.

Run it in a loop until it fails, then look at *what differed* — the ordering,
the timing, the leftover state. See `reproduce-first` for the rate discipline:
a fix means 0/20, measured against a known rate before.

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
