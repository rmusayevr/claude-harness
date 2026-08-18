# Architecture

This file is the routing rule. Every future addition to this harness gets checked against
the table below **before** it is written, and the answer to "which layer?" is decided by
load cost, not by convenience.

## The routing table

The principle: **volume goes in the layer that loads lazily.** A harness gets large without
getting expensive only if the growth lands somewhere that isn't paid for on every session.

| Layer | Load cost | What belongs there |
|---|---|---|
| `CLAUDE.md` rules | Every session, always — **and again in every subagent** | Only rules that must hold in *plain conversation*, where no skill has been invoked. Target: under 80 lines. |
| Skill `description` | Every session, in the listing | One line each. This is the real budget. Descriptions must be *discriminating* — they are what Claude routes on. |
| Skill body (`SKILL.md`) | On invoke/match, then **resident for the rest of the session** | The procedure itself: steps, decision points, the checklist Claude works through. Bounded — this is not the dumping ground. |
| Skill bundle files (`reference.md`, `templates/`, `scripts/`) | Only when Claude actually reads the file | **All the volume goes here.** Reference tables, long checklists, worked examples, API specs. Truly lazy. |
| Hooks | Outside model context — **until the hook speaks** | Anything mechanically decidable from a tool call's arguments. |
| Subagents | Separate context window; only the summary returns | Fan-out searches and fresh-context review. |

## Corrections to the naive version of this table

Three things the docs say that change how the table is used. Each is load-bearing.

### 1. A skill body is not free after it loads

> "Once a skill loads, its content stays in context across turns, so every line is a
> recurring token cost."
> — [Skills](https://code.claude.com/docs/en/skills)

"Loads lazily" is true. "Costs nothing" is not. A skill body is paid **once, then forever**
for the remainder of the session. A 400-line SKILL.md invoked in turn 3 is still being paid
for in turn 90.

So the naive row — *skill body: all the volume goes here* — is wrong, and the correction is
the whole reason the table above has five rows instead of four. The genuinely lazy layer is
**bundled files the body points at**, which load only if Claude reads them:

> "Large reference docs, API specifications, or example collections don't need to load into
> context every time the skill runs."
> — [Skills → Add supporting files](https://code.claude.com/docs/en/skills)

**Rule:** SKILL.md body stays under ~100 lines and describes the *procedure*. Anything that
is lookup rather than procedure goes in a sibling file, named in the body so Claude knows
when to open it. If a body cannot get under 100 lines, that is the signal to split it, not
to make an exception.

**Escape hatch:** a skill that genuinely needs to be enormous gets `context: fork`. A forked
skill's body becomes a subagent prompt, so it is paid in the subagent's window and only the
summary comes back. Fork is how you borrow context and return it.

### 2. Hooks are outside context only until they speak

A hook's *code* never enters context — that part is true, and it is why hooks are the
enforcement layer. But a hook's *output* does:

- `permissionDecisionReason` — shown when the hook denies or asks
- `additionalContext` — injected directly into Claude's context
- `systemMessage` — surfaced as a warning

**Rule:** hooks in this harness deny, ask, or stay silent. A hook that fires on every tool
call and injects a paragraph of "helpful context" is a per-event tax on the exact budget
this architecture exists to protect. If a hook has nothing to block, it exits 0 and says
nothing. `additionalContext` requires a specific justification, not a good intention.

### 3. `CLAUDE.md` is paid more than once per session

A subagent's fresh context window is not empty. It starts with its system prompt, the
delegation message, **and `CLAUDE.md`** (the built-in `Explore` and `Plan` agents are the
exceptions).

So `CLAUDE.md` cost is multiplied by fan-out: a session that spawns six review subagents
pays for `CLAUDE.md` seven times. The under-80-lines target is not aesthetic. It is the
line item that scales worst.

## The corollary

> **If a rule is decidable from a tool call's arguments, prose is the wrong layer.**
> **Prose is a request. A hook is a guarantee.**

Before writing any rule as prose, ask: *could a script decide this by looking at the tool
name and its arguments?* If yes, it is a hook, and writing it as prose is choosing a
weaker version of something you could have had for free.

Worked distinction:

| Rule | Layer | Why |
|---|---|---|
| "Never `git push --force` to `main`" | **Hook** | Fully decidable from the Bash command string. |
| "Don't commit `.env` files" | **Hook** | Decidable from `file_path`. |
| "Run the test suite before saying you're done" | Skill body | Not decidable from any single call's arguments. |
| "This codebase prefers composition over inheritance" | `CLAUDE.md` | A judgment that must hold in plain conversation. |
| "Check the migration checklist before altering a schema" | Skill body + bundle | Procedure in the body, the checklist itself in a bundled file. |

Decidable-but-written-as-prose is the single most common defect this harness is built to
avoid, and `/harness-audit` checks for it specifically.

### deny vs. ask

The permission values are `allow`, `deny`, and `ask`
([Hooks](https://code.claude.com/docs/en/hooks)). This harness uses two of them:

- **`deny`** — things that should never happen by accident. No prompt, no path through.
- **`ask`** — things Claude should not self-authorize, but the operator may legitimately
  approve. This is "escalate."

Choosing `deny` for something an operator does routinely is how a guard gets disabled
within a week. When in doubt, `ask`.

### Hooks fail open

A hook that throws, times out, or receives unparseable input **exits 0 and allows the
call**. A wedged session is worse than a missed check. This is not negotiable and every
hook test asserts it.

## Provenance rule

Every rule in this harness carries the incident that bought it.

> "Both CS-64 and CS-65 shipped Redis markers nothing ever cleared" — earns its place.
> "Be careful with Redis keys" — does not.

A rule that cannot name a cost is a guess, and accumulated guesses are what make large
harnesses unreadable. On second occurrence, the existing rule is **sharpened and the new
incident appended** — a near-duplicate bullet is never added.

Borrowed from private-gpt's one transferable discipline: an answer without a citation is an
unsupported claim. A rule without an incident is the same thing.

## Locality

Everything is plain Markdown on local disk. No telemetry, no network calls, no service.
The lesson vault is inspectable in a diff, or it isn't a vault.
