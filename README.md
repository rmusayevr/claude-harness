# harness

[![test](https://github.com/rmusayevr/claude-harness/actions/workflows/test.yml/badge.svg)](https://github.com/rmusayevr/claude-harness/actions/workflows/test.yml)

**A Claude Code plugin that makes Claude check its work before it says it's
done.** It reproduces bugs before fixing them, tests for real, reviews its own
changes with fresh eyes, and refuses dangerous commands.

You don't learn anything new to use it. Install it and keep talking to Claude
the way you already do.

## Install

In Claude Code:

```
/plugin marketplace add rmusayevr/claude-harness
/plugin install harness@harness
```

That's it. Needs Node 22 or newer.

## Just say what's happening

Claude picks the right checklist from what you describe. You never have to
name one.

| You say… | What Claude does |
|---|---|
| "This bug happens sometimes" | Reproduces it first, then fixes it, then proves the fix with a test |
| "Add this feature" | Keeps the change small, says what it won't touch, tests it |
| "Is this ready?" | Has a second Claude, with no memory of writing it, review the change |
| "It's broken in production" | Stops the damage first, investigates after |
| "I'm new to this code" | Maps how it fits together before changing anything |
| "Why is this slow?" | Measures before optimizing anything |

## Safety guards

These run on every command, whether Claude remembers the rules or not.

- **Blocked:** writing to `.env` and private keys, force-pushing to `main`,
  `rm -rf /`.
- **Asks you first:** `git reset --hard`, deleting non-build folders, deploys,
  database migrations aimed at production, merging a PR with failing checks.

If a guard blocks something it shouldn't, that's a bug. Please
[open an issue](https://github.com/rmusayevr/claude-harness/issues).

## Three commands worth knowing

| Command | What it does |
|---|---|
| `/harness:promote-lesson` | "Remember this mistake." Turns it into a rule that fires before the same mistake next time |
| `/harness:work-the-queue` | Works through your GitHub issues on its own: plan, build, PR, review, merge, next. Opt-in per project |
| `/harness:harness-status` | Checks the install is working |

Everything else happens without being asked.

## Learn more

- [All skills](./GUIDE.md#the-skill-catalogue-by-situation): the 52 checklists, grouped by situation
- [`GUIDE.md`](./GUIDE.md): the full guide, including when *not* to use it
- [`TUTORIAL.md`](./TUTORIAL.md): a recorded run on a real project
- [`ARCHITECTURE.md`](./ARCHITECTURE.md): read before extending it

---

## For people extending it

### Two ways to install

The **plugin** (above) gives you the core skills, the guards and the review
agent. The **installer** copies the harness into one project's `.claude/`
folder instead, and is the only way to add the stack packs in `rules/`:

```
node install.mjs install   --profile core|backend|frontend|full --target <project>
node install.mjs status    --target <project>
node install.mjs repair    --target <project>
node install.mjs update    --target <project>   # re-reads this checkout, no download
node install.mjs uninstall --target <project>
```

Flags: `--dry-run`, `--force`, `--claude-md block|sidecar|skip`. Every file
placed is recorded with a hash in `.claude/harness-manifest.json`, so the
installer can tell a file you edited from a stale one from a missing one. Your
edits are never overwritten without `--force`, and an existing `CLAUDE.md` is
never overwritten at all: the harness block is appended between markers and
removed cleanly on uninstall.

### The issue loop

`/harness:work-the-queue` is opt-in through `.claude/harness-loop.json` (schema
in [`skills/work-the-queue/reference.md`](./skills/work-the-queue/reference.md)).
It picks the next issue, or writes one from a problem you named. It sizes the
work, plans (bigger work waits for your approval), builds, opens a PR and has
it reviewed fresh. It triages the findings with `triage-review`, fixes
blockers, merges into the configured branch on green CI, waits for that
branch's CI, then moves on. It stops only for business rules, new dependencies,
work bigger than planned, or a broken base branch. Issues that need a person,
like a deploy or a credential, get parked so the loop can move on.

With that file present, the `guard-merge` hook denies any merge that isn't a
green PR into the configured branch. It never merges into `main`: if `main` is
the base, the loop gets each PR to ready and you merge it.

### Lessons

`/harness:promote-lesson` refuses hypotheticals: a lesson needs the mistake
that cost real work. It sharpens an existing rule rather than adding a
near-duplicate, and puts the rule where it will fire in time. If the rule can
be checked by machine, it proposes a guard and waits for approval. Lessons live
in `<project>/.claude/lessons/`. One recorded in two or more projects moves to
`~/.claude/harness/lessons/`.

### Layout

| Path | What |
|---|---|
| `skills/` | Core skills, one folder each |
| `rules/` | Stack packs, installed only by profile |
| `agents/` | The fresh-eyes review agent |
| `hooks/` | The guards, `hooks.json`, and a `.test.mjs` beside each guard |
| `templates/` | The `CLAUDE.md` block merged on install |
| `install.mjs` | The installer |
| `scripts/` | Lesson vault, self-audit, listing-cost report |

### Tests and audit

```
npm test               # every guard, the vault and the installer
npm run audit          # the harness checks itself
npm run listing-cost   # what the skill list costs per session
```

Guard tests are weighted toward false positives: a guard that over-blocks gets
switched off, and then it protects nothing. A new rule needs a case it catches
and a nearby case it must let through.

### Two rules that keep it readable

1. **Every rule names the mistake that bought it.** A rule that can't name a
   cost is a guess.
2. **A repeat sharpens the existing rule.** It never adds a near-duplicate.

### Local only

Plain Markdown on disk, no telemetry, no service. The one network call is
`guard-merge` asking `gh` about a PR you are merging.

MIT licensed. See [`LICENSE`](./LICENSE).
