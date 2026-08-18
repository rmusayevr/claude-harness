---
name: harness-audit
description: Turn the harness on itself — find overlapping skills, rules with no incident, untested hooks, dead manifest entries, and CLAUDE.md content that should have been a skill body.
disable-model-invocation: true
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/audit.mjs *), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/audit.mjs" *), Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/listing-cost.mjs *), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/listing-cost.mjs" *)
---

# Harness audit

A harness decays in a specific direction: it accumulates. Skills that sounded
useful, rules nobody can trace, hooks that were never tested. This finds that.

## 1. Run the mechanical pass

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/audit.mjs --target $ARGUMENTS
node ${CLAUDE_PLUGIN_ROOT}/scripts/listing-cost.mjs
```

`--target <project>` adds the manifest checks; omit it to audit the source only.

The script decides what is decidable — overlap scores, missing tests, body
lengths, `CLAUDE.md` budget, dead manifest entries. Do not re-check those by
reading files; that is the whole reason they are a script.

## 2. The judgment pass

The script cannot answer these. You have to read.

### Does each skill earn its listing cost?

Open any skill flagged as near-duplicate, plus a random three. For each, apply
the bar:

> **Does the body tell Claude something a competent engineer wouldn't already
> do by default?**

If it could be replaced by "use good judgment", it is dead weight. Say so and
name the deletion — a skill that survives an audit because nobody wanted to
argue about it is how the listing budget doubles.

### Do two skills overlap in *intent*, not just in words?

The overlap score is word-based and misses the real hazard: two skills whose
descriptions share no vocabulary but cover the same moment. Read the flagged
pairs and the whole listing. Ask: *given a realistic prompt, would Claude have
to guess between these?* If yes, either merge them or rewrite one description to
name what the other explicitly does not cover.

### Does each rule name its cost?

The script reports `no-incident` for every skill still carrying the placeholder.
Most of those are fine — a seeded skill is reasoning, not a lesson, and it
should not have a fabricated incident.

The finding that matters is different: a rule stated as though it were bought
by experience, with no experience behind it. "Both CS-64 and CS-65 shipped
Redis markers nothing ever cleared" earns its place; "be careful with Redis
keys" does not. Flag confident-sounding rules with no traceable origin.

**Never invent an incident to satisfy this check.** A fabricated provenance is
worse than a missing one, because it cannot be distinguished from a real one
later, and the entire discipline rests on that distinction.

### Is anything in `CLAUDE.md` that should be a skill body?

Read the harness block. For each line ask: *must this hold in plain
conversation, before any skill has loaded?*

- If it only matters while doing a specific task → move it to that skill's body.
- If it is decidable from a tool call's arguments → it should be a hook, and
  prose is the weaker version of something available for free.
- If it is a procedure with steps → it is a skill by definition.

`CLAUDE.md` is paid every session *and* inside every subagent, so this section
usually returns the largest saving in the audit.

### Are the hooks still right?

For each hook, read its test file and ask what is **not** covered — especially
which false positives are unasserted. Then ask the operator whether any guard
has been annoying them. A hook people work around is worse than no hook, and it
will not show up in any test.

## 3. Report

Group by what you want done: **delete**, **merge**, **move to another layer**,
**needs a test**, **leave alone**.

Rank by what it costs to keep. Say plainly when the harness is in good shape —
an audit that manufactures findings to look thorough trains the reader to skip
the next one.

Propose deletions; do not perform them. Removing a skill someone relies on is
the operator's call.
