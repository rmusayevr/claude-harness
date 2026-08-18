---
name: recall-lessons
description: Check whether this project or the global vault already recorded a lesson about what you are working on, before repeating a mistake someone already paid for. Use when starting on an area with known history.
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/vault.mjs *), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/vault.mjs" *)
---

# Recall lessons

The vault is only worth keeping if it is read *before* the work, not after the
repeat. A lesson recorded and never recalled is a diary, not a harness.

## When to check

- Starting on a subsystem that has bitten someone before.
- About to do anything from the `risky-op` family — a migration, a deploy, a
  bulk write.
- Mid-debugging, when the shape of the problem feels familiar.
- When the user says "didn't we hit this before?" — they are usually right, and
  the vault can tell you where.

## How

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/vault.mjs list --project-dir <project>
node ${CLAUDE_PLUGIN_ROOT}/scripts/vault.mjs show --slug <slug> --project-dir <project>
```

`list` shows both this project's lessons and the global vault, with occurrence
counts and which layer each was routed to. `show` prints one in full, including
every occurrence and what it cost.

Scan the slugs rather than searching for a phrase — there are few enough to
read, and the slug is written to be recognizable.

## Reading a lesson properly

- **The `**Rule:**` line is the operative part.** The occurrences are evidence
  for it, not instructions.
- **Check the occurrence count.** A lesson at three occurrences is describing
  something that keeps happening, and deserves more weight than one at one.
- **Check `status`.** `global` means it was seen in two or more projects, so it
  is about a class of problem rather than this codebase's quirk. `local` means
  the opposite — do not over-generalize it to a new project.
- **Check the layer.** If it was routed to a hook, the guard should already be
  enforcing it; if it is not firing, that is a finding worth reporting.

## What to do with what you find

Apply it, and say that you did — "the vault has this: markers need a TTL set at
write time, from CS-64 and a repeat in another service, so I'm setting EX in the
same call." That sentence is the entire return on keeping a vault, and it also
lets the user correct a lesson that has gone stale.

If a lesson turns out to be **wrong or obsolete**, say so. A vault that only
grows accumulates advice that no longer applies, and stale entries cost more
than missing ones because they are trusted.

If you hit something the vault should have contained, that is `promote-lesson`.

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
