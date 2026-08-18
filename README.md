# harness

A portable Claude Code plugin: on-demand workflow skills, mechanical enforcement
hooks, and a lesson vault that survives between projects.

Read [`ARCHITECTURE.md`](./ARCHITECTURE.md) first. It is the routing rule every
addition gets checked against, and it explains why the volume lives where it
does.

## Install

From a git remote:

```
/plugin marketplace add <owner>/<repo>
/plugin install harness@harness
```

Locally, for development:

```
claude --plugin-dir ./harness
```

Into a project, profile-driven and manifest-tracked:

```
node install.mjs install   --profile core --target /path/to/project
node install.mjs status    --target /path/to/project
node install.mjs repair    --target /path/to/project
node install.mjs update    --target /path/to/project   # re-reads this checkout, no download
node install.mjs uninstall --target /path/to/project
```

Profiles: `core` (skills only) · `backend` · `frontend` · `full`.
Flags: `--dry-run`, `--force`, `--claude-md block|sidecar|skip`.

Everything placed is recorded in `.claude/harness-manifest.json` with a content
hash, which is what lets the installer tell **"you edited this"** from **"this is
stale"** from **"this is missing"** — three states that need three different
answers. Locally-edited files are never overwritten or deleted without `--force`.

`CLAUDE.md` is never overwritten. If one exists, the harness block is *appended*
with markers and removed cleanly on uninstall; your content is not touched. Use
`--claude-md sidecar` to keep the file entirely untouched and get
`CLAUDE.harness.md` instead (you then add `@CLAUDE.harness.md` yourself).

## Layout

| Path | What |
|---|---|
| `.claude-plugin/plugin.json` | Plugin manifest. The **only** thing in this directory. |
| `.claude-plugin/marketplace.json` | Catalog, so the repo can be added as a marketplace. |
| `skills/` | Core skills. Installed by every profile. |
| `rules/` | Stack packs — same format, installed selectively. See `rules/README.md`. |
| `agents/` | Subagent definitions. |
| `hooks/` | `hooks.json` plus one `.mjs` per guard and a `.test.mjs` beside it. |
| `templates/` | `CLAUDE.md.template`, merged into a marked block on install. |
| `install.mjs` | Profile-driven installer with manifest, repair, and uninstall. |

## Tests

```
npm test
```

Every hook ships with a test beside it. The suite weights **false positives**
heavily — a guard that over-blocks gets disabled within a week, and a disabled
guard enforces nothing. Any new rule needs both a case it catches and an
adjacent case it must let through.

Note: `node --test hooks` does not work on Windows (Node resolves the bare
directory as a module). Use the globbed form in `npm test`.

## The learning loop

`/promote-lesson` turns a mistake into a rule that fires *before* the same
mistake next time. It refuses hypotheticals — a lesson needs the occasion that
cost work — checks whether the lesson already exists and **sharpens** it rather
than adding a near-duplicate, and routes by asking *"at what moment would this
have had to be in front of me?"*, preferring the narrowest layer that still
fires in time. When the rule is mechanically decidable it proposes the hook, its
`deny`/`ask` call, and the false-positive case, then **waits for approval**.
Promoting nothing is a valid and common outcome.

```
node scripts/vault.mjs check  --slug <s> --project-dir <project>
node scripts/vault.mjs record --slug <s> --title "…" --layer <l> --body <file> --cost "…"
node scripts/vault.mjs list   --project-dir <project>
```

Lessons live **per project** in `<project>/.claude/lessons/`. A lesson recorded
in **2 or more distinct projects** graduates to the global vault at
`~/.claude/harness/lessons/` (override with `HARNESS_VAULT`), carrying every
project's occurrences with it. Repetition *within* one project never graduates —
that is a project-specific problem, and copying it everywhere is how a shared
vault fills with irrelevant context.

Everything is plain Markdown, including the index, which is a table you can read
in a diff. Local only, no telemetry.

## Auditing the harness

`/harness-audit` turns the harness on itself.

```
npm run audit                      # or: node scripts/audit.mjs --target <project>
```

The script does what is decidable — description overlap, untested hooks and
scripts, oversized bodies, `CLAUDE.md` budget, dead manifest entries. The skill
body carries the judgment pass: does each skill earn its listing cost, do two
skills overlap in *intent* (which word-scoring misses), does each rule name its
cost, does anything in `CLAUDE.md` belong in a skill body.

It never invents an incident to satisfy a check. A fabricated provenance is
worse than a missing one, because later nobody can tell them apart.

## The two rules that keep this readable

1. **Every rule carries the incident that bought it.** A rule that cannot name a
   cost is a guess. Guesses are what make large harnesses unreadable.
2. **A rule that has failed twice reads as having failed twice.** The second
   occurrence sharpens the existing entry; it never adds a near-duplicate bullet.

## Local only

Plain Markdown on disk. No telemetry, no network calls, no service. The lesson
vault is inspectable in a diff or it is not a vault.
