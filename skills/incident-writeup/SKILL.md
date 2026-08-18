---
name: incident-writeup
description: Write up an outage as a timeline of what was known versus believed at each moment, producing changes that address why it took so long to see. Use after any user-visible failure or near miss.
---

# Incident writeup

The purpose is not to record that something broke. It is to find the parts of
the system — including the human and tooling parts — that made the failure hard
to *see*, since detection time usually dominates total impact.

## Timeline: known vs. believed

Write the timeline in two columns, or annotate each entry. For each moment
record what was **actually happening** and what responders **believed** was
happening.

```
14:02  Deploy of v412 begins.        (believed: routine)
14:09  Error rate 0.3% -> 4%.        (believed: noisy metric, not investigated)
14:31  First customer report.        (believed: single-customer config issue)
14:52  Second report, different org. (belief updated: systemic)
15:04  Rollback started.
```

The gap between those columns is the finding. 14:09 to 14:52 is 43 minutes of
impact caused by a signal that was present and misread — and no amount of
fixing the deploy bug recovers it. Fixing why 4% error looked like noise does.

## Rules that keep it useful

- **Facts with timestamps.** Pull from logs, deploy records, chat. Memory
  compresses and reorders under stress, reliably.
- **No names as causes.** "The check was skipped because the runbook did not
  mention it" is actionable. "X forgot" is not, and it guarantees the next
  person volunteers less information.
- **Counterfactuals are not causes.** "If we had caught it, it would not have
  happened" is true of everything and teaches nothing.
- **Include the near miss.** The thing that almost went wrong, or that went
  right by luck, is a free incident. Write it up with the same rigor.

## The questions worth answering

1. What made this **possible**? (the change or condition)
2. What made it **hard to detect**? (alerting, signal-to-noise, dashboards)
3. What made it **hard to diagnose**? (missing logs, no correlation id, an
   error that discarded its cause)
4. What made it **hard to fix**? (no rollback, a slow deploy, an unrehearsed
   procedure)
5. Where were we **lucky**? Name it — luck does not recur.

Most writeups answer only (1), which is why the same class of incident takes
just as long to resolve the second time.

## Action items

Each one: a specific change, a named owner, a date. Ranked by which question it
answers — usually (2) and (3) beat (1) on value, because they cut the duration
of every future incident rather than preventing one.

"Add more monitoring" is not an action item. "Alert when checkout error rate
exceeds 1% for 5 minutes, paging the on-call" is.

Fewer, real items beat a long list. An action list nobody completes trains
everyone that the writeup is theater.

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
