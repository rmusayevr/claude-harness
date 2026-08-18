---
name: reproduce-first
description: Reproduce a bug as a failing test or command before changing any code. Use when starting on a bug report, a flaky test, or an incident — especially when the cause looks obvious from reading the code.
---

# Reproduce first

A fix without a reproduction is a guess wearing a diff. You cannot tell whether
it worked, and neither can the next person.

## Procedure

1. **Reproduce on the unmodified tree.** Before editing anything, get the
   failure to happen. If it does not happen, you are not looking at the bug —
   you may be looking at a difference in your environment.
2. **Assert the stated reason, not just failure.** The repro must fail *because
   of the bug*: assert on the error message, the wrong value, the missing row.
   A test that only checks "exit code is non-zero" goes green the moment
   anything else changes, and will not tell you when the bug returns.
3. **Shrink it.** Remove one input, one config option, one step at a time until
   removing anything makes the failure disappear. The minimal reproduction
   usually names the cause without you having to guess it.
4. **Fix.**
5. **Confirm the repro passes, then confirm it fails without the fix.** Revert
   the fix, watch the repro fail, restore. A repro that passes both with and
   without the fix is testing something else.

## Intermittent failures

Do not fix a flake off one observation. Run the reproduction at least 20 times
and record the rate — `for i in {1..20}` or the runner's repeat flag.

"Fixed" means 0/20 after the change, against a known rate before it. One green
run on something that failed 1-in-5 is the expected outcome of not fixing it.

## When you cannot reproduce it

Stop. The deliverable is now the missing information, not a speculative fix.

Report: exactly what you ran, what you observed instead, and the specific thing
you would need — a version, a log line, an input, a sequence of steps. Shipping
a plausible fix for an unreproduced bug means nobody can tell later whether the
bug was fixed or merely stopped being reported.

## Anti-pattern

Reading code until you find something that looks wrong, then fixing that. This
reliably finds *plausible* causes. Plausible causes are not actual causes, and
the difference only shows up after the fix ships.

If the cause seems obvious from reading, the reproduction takes five minutes and
confirms it. If the reproduction contradicts you, you just saved a release.

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
