---
name: design-a-test
description: Decide what a test should assert and how it should be named, so it fails for one reason and that reason is legible from the failure output alone. Use when writing new tests or when a test is hard to name.
---

# Design a test

A test is a claim about behavior that a machine can check. Most weak tests are
weak because they claim something about *structure* instead.

## Assert the contract, not the construction

Ask: if someone rewrote the implementation entirely but kept the promised
behavior, should this test still pass? If no, it is testing construction and
will break during every refactor while catching no bugs — a pure tax.

- Assert the returned value, the persisted row, the response body, the effect.
- Do not assert which internal functions were called, in what order, how many
  times — unless the call *is* the contract, as with "sends exactly one email".
- Do not assert on log output, whitespace, key ordering, or full-object equality
  where only two fields matter. Each incidental assertion is a future false
  failure.

## One reason to fail

A test should have a single reason to go red, and the name should say what it
is. When a test can fail for four reasons, its failure tells you almost nothing
and the usual response is to re-run it.

If a test needs "and" in its description, it is two tests.

## Name it as the rule it enforces

The name is read far more often than the body — usually in a CI failure list, by
someone who did not write it and cannot see the code.

- `rejects_withdrawal_that_exceeds_balance`
- `returns_empty_list_when_no_orders_match`
- Not `test_withdraw_2`, not `it works`, not `test_edge_case`.

A failure line that reads `rejects_withdrawal_that_exceeds_balance FAILED` has
already told the reader what broke. That is most of a test's value.

## Arrange the minimum

Build only the state the claim needs. A test that constructs a full object graph
to check one boolean makes the reader search for which part mattered, and breaks
whenever any unrelated constructor changes.

Prefer factories with explicit overrides for what matters:
`user(plan: "free")` says the plan is the point.

## Test at the level where the rule lives

A business rule belongs in a unit test of the thing that owns the rule. Do not
verify it through six layers of HTTP — that test is slow, fails for unrelated
reasons, and does not say which layer broke.

Reserve end-to-end tests for the wiring: that the layers are connected at all.
There should be few of them, and they should not enumerate business rules.

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
