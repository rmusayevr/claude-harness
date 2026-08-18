---
name: review-an-interface
description: Scrutinize a public API, function signature, or event contract before it ships, since callers make it permanent. Use when adding an endpoint, exported function, config key, or message schema.
---

# Review an interface

Internal code can be changed by whoever needs it changed. An interface can only
be changed by everyone who uses it, simultaneously. Spend review effort in
proportion to that difference.

Applies to: HTTP endpoints, exported functions, CLI flags, config keys, database
views other services read, queue message shapes, webhook payloads.

## Ask what a caller can do wrong

Design so the wrong call is *impossible*, not documented.

- **Booleans are traps.** `render(true, false)` at the call site is unreadable
  and easy to transpose. Named options or an enum survive contact with readers.
- **Two parameters of the same type, adjacent**, can be swapped silently.
  `transfer(fromId, toId)` will one day be called backwards. Distinct types or a
  single named object prevents it at compile time.
- **Optional parameters that are actually required in some combination.** If
  passing A means you must also pass B, the signature should not permit A alone.
- **Stringly-typed values.** A `status: string` accepts `"activ"`. A union or
  enum does not.

## Ask what you are promising by accident

Every observable behavior becomes a contract, whether you meant it or not:

- **Ordering** you did not commit to but currently provide.
- **Timing** — a caller will depend on it being synchronous.
- **The shape of errors** — the class, the message, the status code.
- **Extra fields** in a response. Once returned, removing them breaks someone.
- **Nullability.** A field always present today is required tomorrow.

Return the minimum. Adding a field later is easy; removing one is not.

## Ask how it evolves

- Can a field be added without breaking existing callers? (Objects yes,
  positional tuples no.)
- Is there a version or capability signal, before you need one?
- What is the deprecation path? See `deprecate` — an interface designed without
  one gets removed by breaking people.
- Do errors distinguish *retryable* from *permanent*? Callers cannot guess, and
  will retry things that will never succeed.

## Ask what it costs to call correctly

An interface that requires three calls in the right order, or that returns data
the caller must join client-side, will be used wrongly — not through
carelessness but because the correct usage is expensive. Make the common case
one call.

## The test

Write the call site *before* the implementation, as the caller would. If it
reads badly, the signature is wrong, and that is far cheaper to learn now.

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
