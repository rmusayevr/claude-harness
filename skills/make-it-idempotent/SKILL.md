---
name: make-it-idempotent
description: Design an operation so that running it twice has the same effect as running it once, because retries and redeliveries are guaranteed rather than hypothetical. Use when writing anything that can be retried.
---

# Make it idempotent

Every network call, queue message, webhook, and job will be delivered more than
once. Not might — will. Timeouts retry work that actually succeeded, at-least-
once delivery is the default in every queue worth using, and users double-click.

The question is never "could this run twice", it is "what happens when it does".

## The test

Run it twice with the same input. Then run it twice concurrently. The end state
must be identical to running it once, and the second run must not fail loudly at
the caller who is simply retrying.

## Techniques, cheapest first

1. **Make the operation naturally idempotent.** `SET status = 'paid'` is safe;
   `UPDATE balance = balance + 10` is not. Prefer assignment to increment, and
   absolute state to deltas, wherever the domain allows it.
2. **Use a unique constraint as the guard.** Insert with a natural key and let
   the database reject the duplicate. This is the only technique that works
   correctly under concurrency without extra coordination, because the
   uniqueness check and the write are one atomic step.
3. **Take an idempotency key from the caller.** Store it with the result. On a
   repeat, return the stored result rather than redoing the work — and return
   the *same* response, since the caller cannot tell the difference otherwise.
4. **Check-then-act, only with a lock**, and know that check-then-act without
   one is a race that will fire under exactly the retry storm it was meant to
   handle.

## Where it breaks

- **Side effects that are not in your database.** Charging a card, sending an
  email, calling a third party. These need the provider's own idempotency key —
  most payment APIs have one, and it exists for this reason.
- **Partial completion.** Wrote the row, then crashed before sending the email.
  On retry, the row insert fails as a duplicate and the email never sends. The
  guard must cover the *whole* operation, not just the first step: record
  progress, or make each step independently idempotent and re-runnable.
- **Ordering.** Two retries arriving out of order can leave the older value
  winning. Use a version or timestamp and reject stale writes.
- **Idempotency keys with no expiry** grow forever; with too short an expiry
  they stop protecting the retry that arrives late. Match the window to the
  caller's retry policy, and know what it is.

## Do not confuse with

**Retry-safe** is not the same as **safe to retry forever**. An operation can be
idempotent and still hammer a struggling dependency. Idempotency is about
correctness; backoff and a retry limit are about not making things worse.

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
