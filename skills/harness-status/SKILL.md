---
name: harness-status
description: Check that the harness installed in this project is complete, current, and actually wired up, and report what drifted. Use when skills or hooks seem missing, or after pulling changes.
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/install.mjs *), Bash(node "${CLAUDE_PLUGIN_ROOT}/install.mjs" *), Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/audit.mjs *), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/audit.mjs" *)
---

# Harness status

Answers one question: **is what is installed here the thing I think is
installed here?**

## Run

```
node ${CLAUDE_PLUGIN_ROOT}/install.mjs status --target $ARGUMENTS
node ${CLAUDE_PLUGIN_ROOT}/scripts/audit.mjs --target $ARGUMENTS
```

Default the target to the project root if no argument is given.

## Interpret

`status` classifies every tracked file into three states, which need three
different answers:

| State | Meaning | Action |
|---|---|---|
| **clean** | Matches the manifest hash | Nothing |
| **locally edited** | You changed it | Leave it. Ask whether the edit should be promoted upstream instead of living as drift. |
| **missing** | Tracked but gone | `repair` |

`audit --target` adds two things `status` cannot see:

- **dead manifest entries** — the manifest references a source file that no
  longer exists in the checkout, meaning the install predates a rename or
  removal. `install` again to re-plan.
- **install behind source** — skills exist in the checkout that were never
  installed here. `update`.

## Check it is actually wired, not just present

Files on disk are not the same as an active harness. Confirm:

- `.claude/settings.json` contains the `PreToolUse` entry pointing at
  `.claude/hooks/guard-risky-ops.mjs`. Files can be installed with the hook
  entry removed by a settings edit, and nothing will tell you.
- The hook runs: `node .claude/hooks/guard-risky-ops.test.mjs` — or the whole
  suite — should be green from the installed location.
- `CLAUDE.md` still contains the harness block between its markers.

A harness that is installed but unwired is the worst state, because it looks
present and enforces nothing.

## Report

Say plainly: the profile, how many files are clean, what drifted, and whether
the hook is live. If everything is current, say so in one line — this skill
exists to be run often and cheaply.

Where there is drift, recommend the specific command (`repair`, `update`,
`install --force`) rather than describing the situation and stopping.
