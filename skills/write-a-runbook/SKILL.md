---
name: write-a-runbook
description: Write an operational procedure someone can follow at 3am without having built the system, with a verification step after each action. Use when documenting a recovery, failover, rotation, or on-call response.
---

# Write a runbook

The reader is tired, under pressure, and did not build this. They may have been
asleep twenty minutes ago. Every assumption you leave implicit is one they have
to derive in the worst conditions for deriving anything.

## Lead with the decision, not the background

The first section answers: **am I in the right runbook, and is this urgent?**

- The symptom, as it appears in the alert or the dashboard, worded the way they
  will see it.
- What is affected — which users, which functionality, what is degraded.
- Whether they can wait until morning. This is the most valuable line in the
  document and it is almost always missing.

Architecture explanations go at the bottom, if at all. Nobody reads context
first at 3am.

## Every step: exact command, expected output, what if not

A step that says "restart the service" is not a step. Three things per action:

```
2. Drain the unhealthy node.

   kubectl drain node-7 --ignore-daemonsets --delete-emptydir-data

   Expect: "node/node-7 drained" within ~60s.
   If it hangs: a PodDisruptionBudget is blocking. Check with
     kubectl get pdb -A
   and see step 2b before forcing anything.
```

Copy-pasteable, with placeholders that are obviously placeholders
(`<NODE_NAME>`, not `node-7` where the reader might paste it literally).

**The "expect" line is what makes a runbook usable.** Without it the reader
cannot tell whether the step worked, so they either continue on a failed step or
stop and escalate unnecessarily.

## Say what is dangerous, at the step, not in a preamble

Warnings at the top are read once and forgotten by step six. Put the caution
immediately above the command it applies to, and say what it does that cannot be
undone.

Anything irreversible gets a checkpoint before it: what to capture first, and
what the reversal is (`risky-op` is the general procedure).

## Include the exits

- **How to verify the incident is over** — the concrete signal, not "monitor
  the situation."
- **How to escalate**, with who and how, and at what point. Give a time bound:
  "if not resolved in 30 minutes, page the database on-call."
- **What to undo afterwards.** A drained node, a disabled flag, a scaled-up
  replica set. Mitigations that become permanent by being forgotten are their
  own future incident.

## Keep it true

A runbook is only as good as its last execution. Untested ones are worse than
none, because they are trusted.

- Note the date and who last ran it, at the top.
- Fix it *during* the incident, while the gap is obvious — the correction will
  never be cheaper than the moment you hit it.
- Where feasible, rehearse it: a failover nobody has practiced is a hypothesis.

If a runbook is followed identically every time with no judgment, that is not a
document — it is a script that has not been written yet.

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
