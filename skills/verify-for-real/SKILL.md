---
name: verify-for-real
description: Confirm a change works by exercising the real entry point and reporting the actual output, not by inferring it from a green test run. Use before claiming a task is done or a bug is fixed.
---

# Verify for real

"The tests pass" and "it works" are different claims. Only one of them was
checked by running the tests.

## The three checks

1. **Did the test actually cover this?** Revert your change, run the test, watch
   it fail. If it still passes, the test does not exercise your change and its
   greenness is telling you nothing.
2. **Does the real entry point work?** Run the thing the way a user runs it —
   the CLI command, the HTTP request, the page, the job. Test doubles are wrong
   in exactly the places that matter, because they were written by someone who
   already believed the code was correct.
3. **Does the failure path still behave?** Feed it the bad input, the missing
   file, the empty result. A change that fixes the happy path and breaks the
   error path reads as working right up until production.

## Verify the thing that was asked, in the words it was asked in

Re-read the original request before declaring done. Check each stated
requirement individually against something you ran.

The common failure is verifying the mental model of the problem you built while
working, which has quietly drifted from the request. If the request said
"invoices over 30 days", verify an invoice at 29, 30, and 31 days — not that
"the date filter works".

## Reporting

State what you ran and what came back. Paste the relevant output.

- "I ran `npm run e2e -- --grep checkout` — 14 passed, and the previously
  failing `applies expired coupon` case now passes."
- Not: "Tests pass, this should work now."

The second sentence is not a weaker version of the first. It is a different
claim, and the reader cannot tell which one you are making.

## When you could not run it

Say so, in the same place you report the change. Name what would need to be true
to run it — a credential, a service, a fixture, a device.

An unverified change reported as verified costs more than an unverified change
reported honestly, because the honest one gets checked.

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
