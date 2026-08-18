# Using the harness on a real project

This is a recording, not a walkthrough. I installed the harness into a fresh
football-analytics project and drove it with real tasks, and this is what
actually happened — including the part where the harness got in its own way and
had to be changed.

If you want the reference instead, read [`GUIDE.md`](./GUIDE.md).

---

## Method

Reproducible, and worth stating because it is what makes the rest of this
credible:

- A fresh `claude -p` session per step, run **inside** the project.
- Harness installed with `install.mjs install --profile full`, so all 52 skills,
  both guards, the subagent and the `CLAUDE.md` block were live.
- Nothing prompted about which skill to use. Every skill named below fired
  because the task matched its description, not because it was asked for.
- Everything quoted is copied from the session output.

**The project:** an xG tracker — ingest shot events for football matches,
compute expected goals, expose them. Chosen because the domain forces the
interesting cases: ingest that must be idempotent, a schema that must change, a
backfill over existing rows, an authorization boundary, and a third-party API
that will be down sometimes.

---

## Step 0 — what the harness does not do

```
mkdir xg-tracker && cd xg-tracker && git init
# package.json, src/, migrations/, .gitignore — all by hand
```

The harness contributed **nothing** here, exactly as designed. There is no
scaffolding skill and there never will be. Budget thirty minutes of ordinary
setup before any of this starts paying.

```
node ../claude-harness/install.mjs install --profile full --target .
  60 files tracked, 60 written
  hook wired into .claude/settings.json (created)
  created CLAUDE.md
```

---

## Step 1 — shots table and ingest

> **Prompt:** Add a migration creating a `shots` table and an ingest function
> that fetches match events from the football-data API. Use `node:sqlite`.

### What fired without being asked

**`migrate-data`** treated it as expand-phase-only — additive table, nothing to
backfill — and wrote an explicit down path. I expected this to be the first
thing to go wrong: the skill describes a four-phase expand/dual-write/backfill/
contract rollout, and applying that ceremony to a greenfield table with zero
rows would have been textbook over-application. It didn't. It read the
situation.

**`design-failure-behavior`** classified football-data as a *required*
dependency and produced, unprompted:

- a bounded 5s `AbortSignal.timeout`
- `{ cause }` preserved through the wrapper
- a `retryable` flag separating 5xx/429/timeout from permanent 4xx

That last one is the tell. "Distinguish retryable from permanent" is a line in
the skill body, and it appeared in code without being mentioned.

### What fired but wasn't credited

The table got `UNIQUE (match_id, player_id, minute, x, y)` with the comment
"makes re-ingest idempotent". That is `make-it-idempotent` behaviour, and the
session did **not** list it when asked which skills it used.

> **Worth knowing:** self-reported skill lists undercount. Judge from the
> artifact, not from what the session says it did.

### The `CLAUDE.md` block held, twice

The migration write was blocked (see below). The session's response:

> *"Per this project's working agreement I did not route around it (no writing
> the DDL under another name or via shell)."*

And on verification, having written a test script it could not execute:

> *"that's a 'should work,' not a 'works.'"*

Both of those are four-line rules in a 47-line `CLAUDE.md`. They are the
cheapest thing in the whole harness and they did the most visible work.

### FINDING 1 — the migration never got written

`guard-risky-ops` returned `ask` on `migrations/001_create_shots.sql`.

In `-p` mode there is nobody to approve, so **`ask` is a silent hard block**.
The session built five files around a migration it could not create.

---

## Step 2 — add an `xg` column and backfill 168 rows

I seeded 168 real shots across 12 matches first, so the backfill would be a
genuine data change rather than a hypothetical one.

> **Prompt:** The shots table has 168 rows. Add an `xg` column and backfill it
> for every existing shot. Then confirm the backfill did what you intended.

**It timed out after 10 minutes.** Files on disk afterwards:

```
src/xg_model.mjs      ✓ written
src/backfill_xg.mjs   ✓ written
src/verify_xg.mjs     ✓ written
migrations/002_*.sql  ✗ ABSENT
shots.xg column       ✗ ABSENT
```

Same block, second time. The session wrote the model, the backfill and the
verification — everything *except* the one file that had to exist first — and
then burned ten minutes.

I confirmed the cause rather than assuming it:

```
$ echo '{"tool_name":"Write","tool_input":{"file_path":"migrations/002_add_xg.sql"}}' \
    | node .claude/hooks/guard-risky-ops.mjs

{"permissionDecision":"ask","permissionDecisionReason":
 "[harness:write-migration] ... confirm the up *and* down path."}
```

**Two steps burned by one over-eager rule.** This is the failure mode the
harness warns about in its own documentation — *a guard that interrupts ordinary
work gets switched off within a week* — happening to the harness itself.

---

## Step 3 — the learning loop, on a real incident

This is the part worth reading.

> **Prompt:** `/promote-lesson` Twice today the write-migration rule returned
> ask on a new migration during non-interactive runs. There is no operator to
> approve in `-p` mode, so ask is a hard block. Cost: two wasted steps plus a
> 10-minute timeout. Propose only, do not write.

It did five things, in order:

1. **Checked the vault first.** *"Confirmed: not recorded."*
2. **Accepted the occasion.** A named cost, so not a hypothetical.
3. **Routed it correctly** — mechanically decidable from a tool call, therefore
   a hook, not prose.
4. **Diagnosed past the surface.** Quote:

   > *"The real defect isn't `deny`-vs-`ask` — migrations are the textbook
   > `ask` case. It's that `ask` degrades to a hard deny under `-p`, and does
   > so invisibly."*

5. **Named the assumption that decided the design, and refused to guess it:**

   > *"Unchecked — this decides the design: whether the PreToolUse payload or an
   > env var exposes non-interactive mode. I didn't find such a signal in the
   > hook. If none exists, the fix must live elsewhere."*

Then it stopped and waited for approval, having written nothing.

### Checking the assumption

I registered a throwaway hook that dumps the payload and triggered a write:

```
session_id       5d25ada8-...
transcript_path  C:\Users\ADMIN\.claude\projects\...
cwd              C:\Users\ADMIN\Desktop\Projects\xg-tracker
permission_mode  acceptEdits
effort           {"level":"high"}
tool_name        Write
```

**There is no non-interactive signal.** `permission_mode` reports the flag
passed on the command line — it says nothing about whether a human is present.
The hook genuinely cannot tell, so the fix had to be the rule.

### The fix

The rule was guarding the wrong moment.

> **Writing a migration file is not destructive.** `git rm` undoes it. What is
> destructive is *running* it — and `guard-prod-ddl` already asks for that.

What *is* worth a prompt is editing a migration that already exists: if it has
been applied anywhere, changing it diverges environments silently, because the
new file never runs where the old one already did.

| Before | After |
|---|---|
| any migration path → `ask` | **new** migration → allow |
| — | **existing** migration → `ask` (`edit-applied-migration`) |

Decidable from `existsSync`, plus the fact that `Edit`/`MultiEdit` always imply
an existing file. Three new tests, all 96 green.

### Closing the loop

The exact write that failed twice:

```
$ echo '{"tool_name":"Write","tool_input":{"file_path":".../002_add_xg.sql"}}' \
    | node .claude/hooks/guard-risky-ops.mjs
exit=0            # no output, allowed
```

Re-running the blocked step for real:

```
Created migrations/002_add_xg.sql with an -- up that runs
ALTER TABLE shots ADD COLUMN xg REAL; and the down path as a comment.

$ npm run db:migrate
Applied: 002_add_xg.sql
columns now: id, match_id, player_id, minute, x, y, outcome, xg
```

And the case it protects instead:

```
[harness:edit-applied-migration] migrations/001_create_shots.sql already exists.
If it has been applied anywhere, editing it makes environments diverge silently
— the new file never runs where the old one already did.
```

### The vault is no longer empty

```
$ node scripts/vault.mjs list

  local   ask-blocks-noninteractive-runs  [hook:guard-risky-ops]
          1 project(s), 1 occurrence(s)
```

**First rule in this harness with a real incident behind it.** Every other rule
still reads "None recorded yet", which is correct — they were designed, not
earned. This one cost two build steps and a ten-minute timeout, and the entry
says so.

---

## What the run actually taught

### Three findings

1. **`ask` is a hard block wherever no operator exists.** Not a prompt — a
   silent denial. Any harness with `ask` rules is unusable in `-p`, CI, or any
   automated context, and it fails invisibly. Audit your `ask` rules for whether
   the guarded action is genuinely irreversible.
2. **Guard the destructive moment, not the moment nearby.** Writing a file is
   not running it. The rule that cost two steps was protecting something that
   `git rm` undoes, while the actual hazard — executing against prod — was
   already covered by a different guard.
3. **Self-reported skill usage undercounts.** Idempotency arrived in the schema
   without the skill being named. Judge from what got built.

### What earned its place

- The `CLAUDE.md` block, three times: it refused to route around a guard, and
  twice refused to claim unverified code worked. Forty-seven lines.
- `design-failure-behavior` produced timeout, `cause`, and retryable
  classification with no prompting.
- `migrate-data` correctly *declined* to apply its own four-phase ceremony to a
  greenfield table.
- `/promote-lesson` refused to guess the one fact that decided the design, and
  said so rather than inventing an answer.

### What did not

- The `write-migration` rule, now narrowed.
- Workspace trust: `permissions.allow` in project settings is ignored until the
  workspace is trusted interactively once, so `npm run` stayed blocked all run.
  Not a harness problem, but it will bite anyone doing this in `-p`.

---

## If you want to write this up

The material that is actually rare is not "here are 50 skills". It is the
mechanism findings, and there are about six posts in them:

| Post | Core claim | Evidence you have |
|---|---|---|
| **Volume goes in the layer that loads lazily** | A skill body is paid once then *forever* in a session; the lazy layer is bundled files | The routing table, the 110-line cap, `listing-cost` output |
| **Prose is a request; a hook is a guarantee** | If a rule is decidable from a tool call's arguments, prose is the wrong layer | The `.env` deny firing, the CLAUDE.md rule holding |
| **Your guard's false positives matter more than its blocks** | Over-blocking gets guards disabled; a disabled guard enforces nothing | This whole run — a rule that cost two steps and got narrowed |
| **`ask` is a hard block wherever no operator exists** | The `-p` finding, with the payload probe showing why hooks can't detect it | Finding 1, verbatim payload dump |
| **A rule that can't name its cost is a guess** | Provenance discipline, and 52 sections honestly reading "None recorded yet" | The vault entry vs. the 51 empty ones |
| **Lessons that graduate on evidence** | 2+ distinct projects, never repetition count | `vault.mjs` and its tests |

**Two things to keep, if you publish:**

Lead with the failure. *"I built a guard, it blocked me twice, here's what I
changed"* is more persuasive than anything that worked, and it is the part
nobody else writes.

Do not claim the provenance discipline is proven. One entry is one entry. The
honest line is that the mechanism works and the history is one incident old —
and saying that is what makes the rest believable.
