---
name: promote-lesson
description: Turn a mistake that already cost work into a rule that fires before the same mistake next time, routed to the narrowest layer that still fires in time. Use after something went wrong that was foreseeable.
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/vault.mjs *), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/vault.mjs" *)
---

# Promote a lesson

A lesson is a rule that would have prevented a specific cost. Not a resolution,
not a preference, not something that sounds wise.

**Promoting nothing is a valid and common outcome.** Most mistakes do not
generalize. Say so and stop — a vault of near-misses and generic advice is
worse than an empty one, because nobody reads it.

## 1. Require the occasion

Before anything else, establish: **what did this cost, concretely, and when?**

Ask the user if it is not already in the conversation. Acceptable answers name a
thing that happened — a ticket, an incident, an hour lost, a review that caught
it, a deploy that rolled back.

Refuse on: "this could cause problems" (hypothetical), "it's good practice to…"
(a preference), "we should be careful about X" (name the time carelessness about
X cost something, or there is nothing to record).

If there is no occasion, say plainly: *"There's no incident behind this, so
there's nothing to promote. If it bites us, run this again and we'll have one."*
Then stop.

## 2. Check whether it is already recorded

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/vault.mjs check --slug <slug> --project-dir <project>
```

Try more than one slug — the same lesson under a different name is the duplicate
this whole design exists to prevent. The command reports near-miss slugs; read
them.

**If it is already recorded, do not add a second entry.** Sharpen it: rewrite
the `**Rule:**` line to cover *both* occurrences (the second usually shows the
first was stated too narrowly) and append the new one under `## Occurrences`.
A rule that failed twice must *read* as having failed twice.

## 3. Route it: at what moment would this have had to be in front of me?

This question, not "where does it fit". Always choose the **narrowest layer that
still fires in time.**

| The moment | Layer | Why |
|---|---|---|
| At the instant of a specific tool call, decidable from its arguments | **Hook** | Fires exactly then. Cannot be forgotten. |
| While already doing a known procedure | **Skill body** — its `## Incidents` section | Loads with the procedure, costs nothing otherwise. |
| In plain conversation, before any skill loaded | **`CLAUDE.md`** | The only layer always present. Most expensive — justify it. |
| Only when someone asks "have we hit this before?" | **Vault only** | Reference, not enforcement. |

Bias downward: `CLAUDE.md` is paid in every session and every subagent. If
the mistake only happens while doing X, it belongs in X's skill.

## 4. If it is mechanically decidable — propose, do not write

If a script could decide this from a tool call's name and arguments, **the rule
is a hook**. Prose is a request; a hook is a guarantee.

Do not write the hook. Present:

1. The rule, as a sentence: *"deny `Write` when the path basename is X"*
2. The **deny vs. ask** call, with reasoning. `deny` for what should never
   happen by accident; `ask` for what you should not self-authorize but the
   operator may approve. When unsure, `ask` — a guard that over-blocks gets
   disabled, and a disabled guard enforces nothing.
3. **The false-positive case it must let through.** State it explicitly. A
   proposed hook without one is not ready.
4. The test cases, as a short list.

Then **stop and wait for approval.** Hooks are the layer that can block the
operator's own work; they do not get written unprompted.

## 5. Record it

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/vault.mjs record \
  --slug <slug> --title "<one line>" --layer <hook|claude-md|skill:<name>|vault> \
  --rule-file <file with the rule, one line> --body <file with the occurrence> \
  --cost "<what it cost>" --project-dir <project>
```

The rule goes in a file, like the body: a rule often quotes a command in
backticks, which a shell would run. A second project may leave `--rule-file`
out and starts from the rule already recorded; pass it to rewrite the rule so
it covers both.

Write the body as the incident, not as advice: *"CS-64 and CS-65 both shipped
Redis markers nothing ever cleared; 3h incident each"* — not *"be careful with
Redis keys"*. Lessons stay **local**; seen in a second project, the vault
graduates them. Repetition within one project never graduates.

## 6. Apply it where it was routed

Editing the target layer is the actual point; recording it is bookkeeping. For a
skill body, append a `- ` bullet to that skill's `## Incidents` section (the
installer keeps only bullets through an update). For `CLAUDE.md`, add
one line inside the harness block. For a hook, wait for approval per step 4.

Then tell the user, in one line each: what was recorded, where it will fire, and
what will now happen differently.
