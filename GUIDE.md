# The harness: a working guide

Everything you need to use this, decide when not to, and extend it without
making it worse. If you only read one section, read
[Can it take a project from scratch to deploy?](#can-it-take-a-project-from-scratch-to-deploy)

- [What this is, and what it is not](#what-this-is-and-what-it-is-not)
- [The one idea](#the-one-idea)
- [Installing](#installing)
- [Your first week](#your-first-week)
- [Can it take a project from scratch to deploy?](#can-it-take-a-project-from-scratch-to-deploy)
- [The skill catalogue, by situation](#the-skill-catalogue-by-situation)
- [The hooks](#the-hooks)
- [The learning loop](#the-learning-loop)
- [Keeping it healthy](#keeping-it-healthy)
- [Extending it without wrecking it](#extending-it-without-wrecking-it)
- [Pros and cons, honestly](#pros-and-cons-honestly)
- [How this degrades](#how-this-degrades)
- [Command reference](#command-reference)
- [Troubleshooting](#troubleshooting)

---

## What this is, and what it is not

**It is a discipline layer.** 50 skills, 2 enforcement hooks, 1 review subagent,
and a lesson vault, packaged as a Claude Code plugin you install into every
project. It changes *how* work gets done — what gets checked, what gets
verified, what gets refused — not *what* gets built.

**It is not a framework, a scaffolder, or a code generator.** There is no
"create a Next.js app" skill and there never will be. A skill that restates a
framework's own documentation is dead weight that also rots at that framework's
release cadence.

The bar every skill had to pass:

> **Does the body tell Claude something a competent engineer wouldn't already do
> by default?** If it could be replaced by "use good judgment", it was deleted.

So the harness is not a tutorial for Claude. It is the set of things that get
skipped under time pressure — reproduce before fixing, verify against the real
entry point, name the reversal before the destructive command, write down what
you ruled out — made routine instead of occasional.

### Use it when

- You work across multiple projects and want the same standards in each
- You care more about not shipping regressions than about shipping in the next
  ten minutes
- You want mistakes to become permanent guardrails rather than resolutions
- The project has users, data, or a deploy — anything with a cost of being wrong

### Don't bother when

- Throwaway scripts, notebooks, one-off analysis
- A repo you will not touch again next month
- Prototypes where being wrong costs nothing and speed is the entire point

The listing cost (~2,700 tokens per session) is real. On a five-file experiment
it buys nothing.

---

## The one idea

Everything here follows from a single rule, spelled out in
[`ARCHITECTURE.md`](./ARCHITECTURE.md):

> **Volume goes in the layer that loads lazily.**

| Layer | Load cost | What belongs there |
|---|---|---|
| `CLAUDE.md` | Every session, **and again inside every subagent** | Only rules that must hold in plain conversation. Under 80 lines. |
| Skill `description` | Every session, in the listing | One line each. **This is the real budget.** |
| Skill body | On invoke, then resident for the session | The procedure. Capped at 110 lines. |
| Bundled files | Only when Claude opens them | Genuinely lazy. Reference tables, long checklists. |
| Hooks | Outside context — until they speak | Anything decidable from a tool call's arguments. |
| Subagents | Separate window; only the summary returns | Fan-out search, fresh-context review. |

And its corollary, which is why the hooks exist:

> **If a rule is decidable from a tool call's arguments, prose is the wrong
> layer. Prose is a request; a hook is a guarantee.**

You do not need to think about this to *use* the harness. You need it the moment
you *add* to the harness.

---

## Installing

There are two delivery modes and they are not equivalent.

### Mode A — as a plugin (recommended default)

```
/plugin marketplace add rmusayevr/claude-harness
/plugin install harness@harness
```

Skills appear namespaced: `/harness:reproduce-first`.

- Updates arrive by bumping the version and running `/plugin marketplace update`
- Nothing is written into your project
- **Stack packs in `rules/` are not loaded** — a plugin has no profile
  mechanism, so you get the 50 stack-agnostic core skills only

### Mode B — copied into the project

```
git clone https://github.com/rmusayevr/claude-harness
node claude-harness/install.mjs install --profile backend --target /path/to/project
```

Skills appear unprefixed: `/reproduce-first`. Files land in the project's
`.claude/`, tracked by a manifest with a content hash per file.

- Profiles select stack packs: `core` · `backend` · `frontend` · `full`
- The project carries its own copy — good for teams, since it commits
- Updates require re-running `install.mjs update`

### Which to pick

| You want | Use |
|---|---|
| The same harness everywhere, updated centrally | **Plugin** |
| Stack-specific packs installed selectively | **Installer** |
| The harness committed to the repo for your team | **Installer** |
| To try it without touching the project | **Plugin** |

You can run both. The plugin's skills are namespaced, so they do not collide.

### What the installer touches

- `.claude/skills/`, `.claude/agents/`, `.claude/hooks/`, `.claude/harness/scripts/`
- `.claude/settings.json` — **merged**, your existing keys and hooks preserved
- `CLAUDE.md` — **never overwritten**. If one exists, a marked block is
  *appended*; your content is untouched and the block is removed cleanly on
  uninstall. `--claude-md sidecar` leaves the file completely alone.
- `.claude/harness-manifest.json` — the record of what was placed

Locally edited files are never overwritten or deleted without `--force`.
`.claude/lessons/` is never deleted, even on uninstall — that is your knowledge,
not the harness's files.

---

## Your first week

**Day 1 — install and leave it alone.** Work normally. Skills fire on their own
when a task matches; you do not need to invoke them. Notice which ones appear.

**Day 2 — try the deliberate ones.** These are slash-only or worth typing:

```
/harness:map-subsystem the checkout flow     # forked search, cheap on context
/harness:fresh-eyes-review                   # subagent review of your diff
/harness:harness-status                      # is the install healthy
```

**First real mistake — promote it.**

```
/harness:promote-lesson
```

Then say what it cost. Not "we should be careful about X" — the actual
occasion. It will refuse a hypothetical, and refusing is the feature.

**End of week 1 — audit.**

```
/harness:harness-audit
```

Expect it to report 52 skills with no incident recorded. That is correct: the
harness ships with reasoning, not with your history. Those fill as you use it.

---

## Can it take a project from scratch to deploy?

**Yes for the whole lifecycle from first commit onward, no for the first thirty
minutes, and it never writes your application for you.**

Being precise about that, because it determines whether this is the right tool:

### What it does not cover

There is **no scaffolding layer**. Nothing here says "run `create-next-app`",
"choose Postgres over Mongo", "set up GitHub Actions", or "structure your
directories". That was a deliberate exclusion — those are framework tutorials,
they rot, and Claude does them competently without help.

So for the first half hour of a greenfield project — picking a stack,
initialising the repo, getting a hello-world running — the harness contributes
almost nothing beyond `review-a-dependency` and `write-an-adr`.

### What it does cover

Everything after that. Here is the full arc with the skills that fire at each
stage.

#### 1. Decisions before code

| Moment | Skill |
|---|---|
| Choosing a library, framework, or base image | `review-a-dependency` |
| A choice that will be expensive to reverse | `write-an-adr` |
| Before writing a helper that may already exist | `find-prior-art` |

#### 2. Building

| Moment | Skill |
|---|---|
| Designing an endpoint, signature, or event schema | `review-an-interface` |
| Adding a call to anything that can be unavailable | `design-failure-behavior` |
| Anything that can be retried or redelivered | `make-it-idempotent` |
| Writing a lock, flag, or in-progress marker | `stateful-markers` *(backend pack)* |
| Building a view that fetches data | `loading-and-empty` *(frontend pack)* |
| Before a multi-file edit | `scope-change` |
| When the change is genuinely too big | `split-a-big-change` |
| Shipping code before releasing behavior | `add-a-feature-flag` |

#### 3. Testing

| Moment | Skill |
|---|---|
| Deciding what a test should assert | `design-a-test` |
| After the happy path works | `check-the-edges` |
| Anything with timers, concurrency, or awaits | `test-async-code` |
| Before claiming it works | `verify-for-real` |

#### 4. Review, before anyone else sees it

| Moment | Skill |
|---|---|
| Immediately before committing | `read-your-own-diff` |
| Before opening a PR | `fresh-eyes-review` *(subagent, no memory of writing it)* |
| Anything that writes, deletes, or expires records | `review-for-data-loss` |
| Anything returning records that belong to someone | `audit-permissions` |
| YAML, env vars, IaC, limits | `review-a-config-change` |
| Writing the commit or PR body | `write-commit` |

#### 5. Data changes

| Moment | Skill |
|---|---|
| Changing a column, index, or stored contract | `migrate-data` *(expand → dual-write → backfill → contract)* |
| After any bulk write | `verify-a-data-change` |
| Removing an endpoint, flag, or table | `deprecate` |

#### 6. Release

| Moment | Skill |
|---|---|
| Canary, percentage, or staged rollout | `manage-a-rollout` |
| The moment the deploy finishes | `smoke-test-a-deploy` |
| An irreversible or externally visible step | `risky-op` |

#### 7. Running it

| Moment | Skill |
|---|---|
| Adding a cron or background task | `schedule-a-job` |
| Documenting a recovery for on-call | `write-a-runbook` |
| Something is broken **right now** | `mitigate-first` |
| A third party is down | `survive-a-dependency-outage` |
| Investigating on a live system | `debug-in-production` |
| After it is over | `incident-writeup` |

#### 8. Debugging, throughout

The diagnosis set splits on **what evidence you have**, which is the axis that
actually determines technique:

| You have | Skill |
|---|---|
| An error or stack trace that names the wrong place | `trace-a-failure` |
| A wrong result and no useful error | `isolate-the-layer` |
| No result at all — a hang or a timeout | `diagnose-a-hang` |
| It worked before | `bisect-the-change` |
| It works on your machine but not CI | `environment-divergence` |
| Something you can see but cannot find in the code | `locate-a-behavior` |
| Something slow | `profile-before-optimizing` |
| A bug report to start from | `reproduce-first` |

### A worked greenfield walkthrough

What using it actually looks like, from empty directory to production:

```
1.  You scaffold the app.                      harness contributes little
2.  "Should we use Prisma or Drizzle?"         review-a-dependency → write-an-adr
3.  Design the API surface.                    review-an-interface
4.  Build the first endpoint.                  find-prior-art, design-failure-behavior
5.  Write tests.                               design-a-test, check-the-edges
6.  First schema change.                       migrate-data (four phases)
                                               → guard-prod-ddl asks if DATABASE_URL is prod
7.  Before committing.                         read-your-own-diff → write-commit
                                               → guard-risky-ops denies a .env write
8.  Before the PR.                             fresh-eyes-review (subagent)
9.  Auth on the endpoint.                      audit-permissions
10. Ship it dark.                              add-a-feature-flag
11. Deploy config review.                      review-a-config-change
12. Roll out at 1%.                            manage-a-rollout (abort criteria first)
13. Deploy lands.                              smoke-test-a-deploy
14. It breaks at 3am.                          mitigate-first → debug-in-production
15. Afterwards.                                incident-writeup → promote-lesson
16. The lesson fires next time.                recall-lessons, or a hook, or a skill body
```

Step 16 is the whole point. Everything before it is discipline; step 16 is the
system getting better.

### Honest gaps for greenfield

| Gap | Why | Workaround |
|---|---|---|
| Project scaffolding | Deliberate — framework tutorials rot | Claude does this fine unaided |
| CI/CD setup | Same | Ask directly |
| Observability setup | Not written yet | Genuine gap; a good first addition |
| Performance budgets | Only `profile-before-optimizing`, which is reactive | Genuine gap |
| Accessibility | Frontend-specific, belongs in the pack | Pack is nearly empty |
| Cost/infra sizing | Out of scope | — |

---

## The skill catalogue, by situation

All 50 core skills. `*` = slash-only, invisible to Claude, zero listing cost.

**Diagnosis (8)** — `reproduce-first` · `trace-a-failure` · `isolate-the-layer` ·
`diagnose-a-hang` · `bisect-the-change` · `environment-divergence` ·
`profile-before-optimizing` · `debug-in-production`

**Change discipline (8)** — `scope-change` · `split-a-big-change` ·
`refactor-safely` · `migrate-data` · `deprecate` · `make-it-idempotent` ·
`add-a-feature-flag` · `design-failure-behavior`

**Verification (7)** — `verify-for-real` · `design-a-test` · `check-the-edges` ·
`test-async-code` · `smoke-test-a-deploy` · `verify-a-data-change` ·
`read-your-own-diff`

**Review & audit (6)** — `fresh-eyes-review` · `review-a-dependency` ·
`review-an-interface` · `review-for-data-loss` · `audit-permissions` ·
`review-a-config-change`

**Navigation (5)** — `land-in-a-new-repo` · `map-subsystem`* · `find-prior-art` ·
`git-archaeology` · `locate-a-behavior`

**Written artifacts (6)** — `write-commit` · `write-an-adr` · `handoff` ·
`incident-writeup` · `write-a-runbook` · `write-a-bug-report`

**Operational risk (6)** — `risky-op` · `handle-secrets` · `mitigate-first` ·
`manage-a-rollout` · `schedule-a-job` · `survive-a-dependency-outage`

**Harness (4)** — `promote-lesson` · `recall-lessons` · `harness-audit`* ·
`harness-status`

**Stack packs (2, installer only)** — `stateful-markers` (backend) ·
`loading-and-empty` (frontend)

---

## The hooks

Two `PreToolUse` guards. They run outside the model's context and cannot be
talked out of a decision.

### `guard-risky-ops`

Matches `Bash`, `Write`, `Edit`, `MultiEdit`, `NotebookEdit`.

**Denies** — never by accident:
- Force-push to `main`/`master`/`develop`/`release/*`
- `rm -rf /`, `~`, `$HOME`
- Writing a real `.env` file or an SSH private key

**Asks** — you may approve:
- `git reset --hard`, `git clean -fdx`, `git checkout .`
- `rm -rf` on anything that is not a regenerable build artifact
- `terraform apply`, `npm publish`, `docker push`, `kubectl delete`
- Migrations, prod config, `.pem`/`credentials.json`
- `--force-with-lease` onto a protected branch
- Bare `git push --force` with no branch named *(undecidable → ask, never deny)*

### `guard-prod-ddl`

Matches `Bash`. **Asks** when a migration or raw DDL targets a database that
looks like production — resolved from an inline `DATABASE_URL=`, a `--url` flag,
or the ambient environment.

Never denies: migrating production is legitimate during a deploy. The failure
mode it prevents is doing it *unintentionally*.

### Working with them

- **A `deny` is not an obstacle to route around.** Deleting the remote branch to
  defeat a force-push denial, or writing to a temp file and moving it, converts
  a guard you trust into one that silently does not work. The `CLAUDE.md` block
  tells Claude this explicitly, and it holds in practice.
- **Both fail open.** A parse error, a timeout, an unexpected payload — exit 0,
  allow. A wedged session is worse than a missed check.
- **Both under-block deliberately.** `rm -rf node_modules` never prompts. A
  migration with no resolvable target never prompts. A guard that interrupts
  ordinary work gets switched off within a week, and then it protects nothing.

If a guard annoys you, **that is a bug** — say so and it gets narrowed. Do not
disable it.

---

## The learning loop

The part that makes this a harness rather than a documentation set.

### Recording a lesson

```
/harness:promote-lesson
```

It will:

1. **Refuse a hypothetical.** You must name the occasion that cost work — a
   ticket, an incident, an hour lost. "Be careful with X" is refused.
2. **Check whether it is already recorded**, and if so **sharpen the existing
   rule** rather than adding a near-duplicate. A rule that has failed twice must
   *read* as having failed twice.
3. **Route it** by asking *"at what moment would this have had to be in front of
   me?"* — preferring the narrowest layer that still fires in time:

   | The moment | Goes to |
   |---|---|
   | At a specific tool call, decidable from arguments | **a hook** |
   | While already doing a known procedure | that **skill's body** |
   | In plain conversation, before any skill loaded | **`CLAUDE.md`** |
   | Only when someone asks "have we hit this?" | **the vault** |

4. **Propose, not write, when it is a hook.** You get the rule, the `deny`/`ask`
   call with reasoning, the false-positive case it must let through, and the
   test cases — then it waits for your approval.
5. **Treat "promote nothing" as a valid outcome.** Most mistakes do not
   generalize.

### Cross-project promotion

Lessons live per project in `<project>/.claude/lessons/`. A lesson recorded in
**2 or more distinct projects** graduates automatically to the global vault at
`~/.claude/harness/lessons/`, carrying every project's occurrences with it.

**Repetition within one project never graduates it.** Three occurrences in one
codebase is a project-specific problem, and copying it everywhere is how a
shared vault fills with other people's context.

Everything is plain Markdown, including the index — a table you can read in a
diff. Local only, no telemetry, no network.

### Reading the vault

```
/harness:recall-lessons
```

Or directly:

```
node scripts/vault.mjs list --project-dir .
node scripts/vault.mjs show --slug markers-need-ttl --project-dir .
```

**A vault that is only written to is a diary.** The return comes from reading it
before the work, not after the repeat.

---

## Keeping it healthy

### Monthly-ish

```
/harness:harness-audit
```

Mechanical pass (a script, because it is decidable): description overlap,
untested hooks and scripts, oversized bodies, `CLAUDE.md` budget, dead manifest
entries. Judgment pass (the skill body): does each skill still earn its listing
cost, do any two overlap in *intent*, does anything in `CLAUDE.md` belong in a
skill body.

### Watch the listing cost

```
npm run listing-cost
```

```
10684 chars across 50 billed skills (52 on disk)
~2671 tokens, every session and every subagent
```

This is the number you pay whether or not you use a single skill — and it is
multiplied by fan-out, because a subagent's fresh window includes `CLAUDE.md`
too. If it climbs past ~3,500 tokens, start deleting rather than adding.

**The lever:** `disable-model-invocation: true` makes a skill slash-only and
drops its listing cost to zero. Right for anything you would only ever type
yourself. Wrong for anything Claude should *notice* — a skill Claude cannot see
is a skill that never fires on its own.

### Check the install

```
/harness:harness-status
```

Distinguishes **clean** / **locally edited** / **missing**, and catches the
state that matters most: files present but the hook entry gone from
`settings.json`. Installed-but-unwired looks fine and enforces nothing.

---

## Extending it without wrecking it

Adding a skill is easy and that is the danger. Every addition costs its
description on every session forever.

### The checklist

1. **Apply the bar.** Does the body tell Claude something a competent engineer
   wouldn't already do by default? If it could be replaced by "use good
   judgment", stop.
2. **Check the layer** against the routing table. If it is decidable from a tool
   call's arguments, it is a hook, not a skill.
3. **Write a discriminating description.** It must name the *moment* it applies,
   and ideally what it is *not*. Compare `trace-a-failure` ("you HAVE an error")
   against `isolate-the-layer` ("NO useful error to follow") — same subject,
   disjoint triggers.
4. **Keep the body under 110 lines.** It stays resident once loaded. Reference
   material goes in a sibling file the body names.
5. **Run the checks:**
   ```
   npm run listing-cost      # collisions and budget
   npm run audit             # everything mechanical
   npm test                  # 93 tests
   ```
6. **Test the routing empirically.** Write 5–10 realistic prompts and ask a
   fresh session which skill it picks. Word-overlap scoring misses intent
   collisions; this does not. The current library scores 42/42.
7. **Never fabricate an incident.** An `## Incidents` section reading "None
   recorded yet" is honest. A made-up ticket number is indistinguishable from a
   real one later, and the whole provenance discipline rests on that difference.

### Adding a hook

Same routing check, plus:

- `deny` only for what should never happen by accident. `ask` for everything you
  might legitimately want. **When in doubt, `ask`.**
- **Do not let the rule's correctness depend on the `ask` being answered.**
  Unattended, it either hard-blocks or is resolved by a permission mode — see
  *`ask` is not a guarantee that anyone is asked* in `ARCHITECTURE.md`. If the
  operation must not proceed without a human, it is a `deny`.
- **Decide from the file, not from the tool that touches it.** Any rule keyed on
  a path has to be reachable from `Bash` too, or `sed -i` and `cat >` walk
  straight past it. `guard-risky-ops` routes shell writes back through the same
  `checkWrite`; a new path rule should do the same rather than trusting that the
  write arrives as `Write`.
- **Fail open.** Any throw exits 0.
- **Ship a `.test.mjs` beside it**, and weight it toward false positives — a
  guard that over-blocks gets disabled, and a disabled guard enforces nothing.
- Register it in `hooks/hooks.json`. That file is the single source of truth;
  the installer translates it and discovers hook files by walking the directory,
  so you do not need to touch `install.mjs`.

---

## Pros and cons, honestly

### What it genuinely gives you

- **Mechanical enforcement.** The hooks are not suggestions. A `.env` write is
  denied whether or not Claude "remembers" the rule.
- **Cheap coverage.** 50 procedures cost ~2,700 tokens per session; the bodies
  cost nothing until used.
- **Compounding.** Lessons route to the layer that fires in time, and graduate
  across projects on evidence rather than a hunch.
- **Portability.** One `marketplace add` per machine, one `plugin install` per
  project.
- **It audits itself.** `/harness-audit` found two real defects in its own
  authoring, including a skill over its own body limit.
- **Provenance discipline.** Every rule is supposed to name what it cost. Rules
  that cannot are visible as such.

### What it costs, and where it is weak

- **~2,700 tokens every session**, multiplied inside every subagent. Not free.
- **No skill has an incident recorded yet.** All 52 ship as *reasoning*, not
  as earned history. That is honest, but it means the provenance discipline is
  currently aspirational — it becomes real as you use it.
- **Stack packs are nearly empty.** `--profile backend` installs one extra
  skill. Packs should grow from real friction, not speculation, but today that
  means the profile mechanism is more designed than exercised.
- **Only two hooks.** Enforcement covers destructive git/filesystem operations
  and prod migrations. Everything else is prose, which is a request.
- **No scaffolding.** See the gaps table above.
- **Routing is good, not guaranteed.** 42/42 on tests, but Claude chooses; a
  weirdly-worded prompt can miss. Type the skill name when it matters.
- **Tested on Windows / Node 22 only.** Paths use `path.resolve` and forward
  slashes throughout and nothing is shell-dependent, but the POSIX path has not
  actually been exercised. Run `npm test` first on macOS or Linux.
- **The installer copies.** Mode B projects drift until you run `update`.
- **The vault needs you.** Nothing forces `/promote-lesson`. Skip it for a month
  and the loop is inert.

---

## How this degrades

Named so you can recognise it early. Each of these is what turned other large
harnesses into unreadable ones:

1. **Skill sprawl.** Adding a skill because it sounds useful. Symptom: listing
   cost climbing while routing accuracy falls. Fix: `/harness-audit`, delete.
2. **Prose where a hook belongs.** A rule written into `CLAUDE.md` that a script
   could enforce. Symptom: the same mistake recurring despite being "documented".
3. **Guard fatigue.** A hook that fires on legitimate work. Symptom: you start
   wanting to disable it. Fix: narrow the rule, add the false-positive test —
   never disable.
4. **Unearned rules.** Confident-sounding rules with no incident behind them.
   Symptom: nobody can tell which rules matter. Fix: the audit flags them.
5. **A write-only vault.** Lessons recorded and never recalled. Fix:
   `recall-lessons` before starting on an area with history.
6. **`CLAUDE.md` creep.** It grows because it is the easiest place to put
   things. Symptom: over 80 lines. Remember it is paid again in every subagent.

---

## Command reference

### Skills you type

| Command | When |
|---|---|
| `/harness:map-subsystem <area>` | Map unfamiliar code in a forked context |
| `/harness:fresh-eyes-review` | Subagent review of the current diff |
| `/harness:promote-lesson` | Something just cost you work |
| `/harness:recall-lessons` | Check for prior lessons before starting |
| `/harness:harness-status` | Is the install healthy |
| `/harness:harness-audit` | Turn the harness on itself |

Everything else fires on its own when the task matches.

### Installer

```
node install.mjs install   --profile core|backend|frontend|full --target <dir>
node install.mjs status    --target <dir>
node install.mjs repair    --target <dir>     # restore missing, keep your edits
node install.mjs update    --target <dir>     # re-read checkout, no download
node install.mjs uninstall --target <dir>     # no orphans, keeps lessons
```

Flags: `--dry-run` · `--force` · `--claude-md block|sidecar|skip`

### Maintenance

```
npm test                  # 93 tests: hooks, vault, installer
npm run audit             # mechanical self-audit
npm run listing-cost      # budget and collisions
node scripts/vault.mjs list --project-dir .
```

### Repo layout

| Path | What |
|---|---|
| `.claude-plugin/plugin.json` | Plugin manifest — the only file in that directory |
| `.claude-plugin/marketplace.json` | Catalog, so the repo works as a marketplace |
| `skills/<name>/SKILL.md` | The 50 core skills |
| `rules/<stack>/<name>/SKILL.md` | Stack packs, installed selectively |
| `agents/fresh-eyes-reviewer.md` | The review subagent |
| `hooks/hooks.json` | **Single source of truth** for hook wiring |
| `hooks/guard-*.mjs` + `.test.mjs` | Guards, each with its tests beside it |
| `templates/CLAUDE.md.template` | The 47-line block merged on install |
| `install.mjs` + `install.test.mjs` | Installer and its 32 tests |
| `scripts/vault.mjs` | Lesson vault CLI |
| `scripts/audit.mjs` | Mechanical self-audit |
| `ARCHITECTURE.md` | The routing rule. Read before extending. |

---

## Troubleshooting

**Skills are not appearing.**
Run `/harness:harness-status`. If installed as a plugin, check the install
summary said `Run /reload-plugins to activate` and run it. Note that
`map-subsystem` and `harness-audit` are slash-only by design and will never show
in Claude's list.

**A hook is blocking something legitimate.**
That is a bug in the guard, not in you. Report the exact command; the fix is a
narrowed rule plus a false-positive test. Do not disable the hook and do not
work around it — routing around a guard makes it silently ineffective, which is
worse than not having it.

**`node --test hooks` fails on Windows.**
Node resolves the bare directory as a module. Use the globbed form:
`node --test "hooks/*.test.mjs"`, which is what `npm test` runs.

**`install.mjs` refuses with "settings.json is not valid JSON".**
Nothing was written — it pre-flights before touching anything. Usually a real
syntax error. A UTF-8 BOM is handled and is not the cause.

**Everything reads as "locally edited" after a fresh clone.**
Line endings. `.gitattributes` pins `eol=lf`; if it was bypassed, the content
hashes will not match. Re-clone or run `install --force`.

**A skill's body says `${CLAUDE_PLUGIN_ROOT}` literally.**
That token only substitutes for plugin installs. The installer rewrites it to
`${CLAUDE_PROJECT_DIR}/.claude/harness` for copied installs — if you see the raw
token in a copied install, the file was placed by hand rather than by
`install.mjs`.

**The vault is empty after months.**
Nothing forces `/promote-lesson`. The loop is opt-in by design — a harness that
auto-recorded every mistake would fill with noise — but it does mean the
compounding only happens if you run it.
