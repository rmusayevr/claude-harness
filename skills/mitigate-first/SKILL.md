---
name: mitigate-first
description: Restore service before diagnosing it, capturing the evidence you will need before the mitigation destroys it. Use while something is actively broken for users.
---

# Mitigate first

While users are affected, the goal is not to understand the problem. It is to
stop the harm. Understanding is the next task, and it is much more pleasant when
nothing is on fire.

The instinct to find the root cause first is the expensive one: diagnosis is
unbounded in time, and every minute of it is paid in impact.

## Order of operations

1. **Stop the bleeding.** Roll back, disable the flag, drain the bad instance,
   fail over, block the abusive caller. Rollback is the *default* action, not
   the last resort — it is the fastest known-good state available.
2. **Confirm the mitigation worked**, by the user-visible signal rather than by
   the deploy succeeding. A rollback that completed while the error rate stayed
   flat means you rolled back the wrong thing, and you need to know that now.
3. **Then** diagnose.

## Capture evidence before you destroy it

The mitigation usually deletes exactly what you need. Take thirty seconds first
— this is the one step worth delaying a rollback for, and only just:

- Logs from the affected window, saved somewhere that outlives the container.
- A heap dump, thread dump, or `SHOW PROCESSLIST` if the process is about to be
  restarted. Restarting is the most common mitigation and the most complete
  evidence destruction available.
- The current config, feature flag states, deployed version, and instance
  identity.
- A screenshot or copy of the graph, since retention on high-resolution metrics
  is shorter than you think.
- The exact time the mitigation was applied. Every later correlation depends on
  it.

If evidence capture would meaningfully delay recovery, skip it and say so in the
writeup. Recovery wins. But a restart done reflexively, before anyone thought
about capture, is how an incident becomes permanently unexplained.

## While mitigating

- **Say what you are doing, before you do it**, where others can see. Two people
  independently mitigating produce a second incident.
- **One change at a time**, with an observation between. Three simultaneous
  changes leave you unable to tell which worked, and possibly with two new
  problems.
- **Write the timeline as you go.** Reconstructing it afterwards from memory
  loses precisely the belief-versus-fact detail that `incident-writeup` needs.

## Do not

Do not "fix forward" under pressure unless rollback is genuinely impossible. A
hastily written fix deployed into an outage is an unreviewed change to a system
already in an unknown state, and it frequently produces the second, worse
incident.

Do not close the incident when the symptom stops. A mitigated incident is still
open — the flag is still off, the instance is still drained, and the underlying
defect is still there. Record what must be undone later, or it becomes
permanent, undocumented, and load-bearing.

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
