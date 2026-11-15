# Changelog

## Unreleased

### Changed
- **The first-project write-up covers the whole project, and is renamed** "One Project With the Harness" (`blog/one-project-with-the-harness.html`; the old address redirects). The header, the per-day table, the review, stops, harness and logs sections now describe all 53 issues and 72 pull requests, audited from GitHub, the project's logs and its last CI run, with no durations. Numbers from the first version that came from logs counted twice by the double-registered hooks were corrected (86 decisions were 66, 94 reviewer runs were 67), and the reviewer count is marked as a minimum.

### Added
- **`guard-review-before-merge`**: in a `/work-the-queue` project (one with `.claude/harness-loop.json`), denies `gh pr merge` when the PR has no "Review triage" comment or its latest triage says "not ready". Promoted from sual-cavab, where PR #59 merged without its review and the review then found two regressions (lesson `merged-without-review`); the project had written it as a local hook. It asks `gh`, so it fails open. It is a `deny`, not an `ask`: it only runs in a loop project where nobody can answer, and sual-cavab's 23 asks (all in `auto` mode) did not stop the merges that followed. A chained `gh pr comment ... && gh pr merge` is denied, because the triage is not posted when the hook runs: post it as its own command. To merge a PR without review the owner merges it by hand. A triage is the `Round N: ... → ready | not ready` line that `triage-review` prescribes; the first version looked for the words "Review triage", which that skill never asks for, and would have denied every merge. `GH_REPO=` on the command line is honoured, and chained merges stop looking PRs up before the hook's timeout.
- **`design-direction`**: a skill for the look of a UI. It reads the project and decides which case it is in: a `DESIGN.md` at the repo root (follow it), a look that already exists (write it down and ask the owner to confirm; no new directions), or nothing (ground the design in who uses it and the worst day, offer three directions that differ in kind, and let the owner pick). The choice is recorded in `DESIGN.md` from a skeleton the skill ships, and every later UI issue follows that file. It ends by building one screen and looking at it (400 px and 1280 px, light and dark, empty, loading and error states, contrast, focus). It works without Figma and reads a Figma file the owner names when a tool is connected. `work-the-queue` sends UI work through it, but parks a UI issue that waits on the owner's pick instead of stopping the loop, and a copy fix, a bug or a one-element tweak is not UI work. The CLAUDE.md block names it. Judge it after one real UI issue: did the owner pick without asking for a redo, and did it fire.
- `guard-risky-ops` asks before a command that wipes a local data store: `docker volume rm`/`prune`, `docker compose down -v`, `docker system prune --volumes`, `docker rm -v`, `manage.py flush`, `FLUSHALL`/`FLUSHDB`, `dropDatabase()`, `dropdb`, `DROP DATABASE`. Bought by sual-cavab, where the agent deleted Docker volumes without looking inside them. It sees global options before the verb (`docker compose -f x.yml down -v`), a path or `.exe`, `env`/`nohup`/`xargs` prefixes, a container or cluster exec, and a statement piped or heredoc'd to a database client, read in one linear pass that skips quoted text and ends a heredoc at its terminator, so a commit message or `grep` pattern that mentions the idiom does not ask; `--remove-orphans` is not `-v`, and a key named `FLUSHALL` is not a flush. Replayed against 11,630 real commands from our sessions, it changed 5: four genuine volume deletions and one script that held the commands as test data. Text that merely mentions a wipe can still ask when the plain split cuts it, the same price the guards already pay.
- An ask now ends by naming the skill with the procedure (`risky-op`, `handle-secrets`, `review-a-config-change`, `migrate-data`), so the model is pointed at it at the moment of action.
- The CLAUDE.md block has a **Skills** section: five situations (deleting data, adding a package, starting in an area, handing over, writing a bug report) and the skill to load for each. Skills fired reliably only where the loop named them; in ad hoc work the model did the job by hand. A test checks that every skill the block names exists, that its markers carry the release version, and that it stays under 80 lines. To judge it, read `npm run usage` after a week in a real project: those skills should show `auto` uses outside the loop. If they do not, the section comes out.

### Fixed
- **Every harness hook ran twice where the plugin and a project install were both present**, and the logs counted both. sual-cavab had both from 9 November: its decisions log held 86 entries that were 66 distinct decisions (62 once four test fixtures are removed), and its usage log 94 reviewer runs that were 67. The plugin's copy of a hook now stands down when the project has its own copy in `.claude/hooks/`, for all five hooks, so a decision happens and is logged once. Numbers quoted from those logs before this fix (including in the first-project write-up) were too high; the write-up is corrected.
- **A hook launched through a symlinked path did nothing at all.** Each hook ran `main()` only if `import.meta.url` equalled the URL of `argv[1]`; Node resolves symlinks for the first and not the second, so behind a symlink (macOS keeps temp dirs under `/var -> /private/var`) the hook exited silently with no decision and no log. Found by the macOS CI jobs. Both sides are now resolved, and a test launches a hook through a symlink.
- `harness-usage` logged no subagent called by its plugin-qualified name (`harness:fresh-eyes-reviewer`), so the reviewer disappeared from the log whenever a project called it that way. The `harness:` prefix is stripped, as the skill path already did.
- `triage-review` says the `Round N: ... → ready | not ready` line is required exactly, because the merge guard looks for it and 15 of the first project's 65 triage comments used another format.
- The hook tests no longer write to a real project's `.claude/harness-decisions.log`. The hook child fell back to the working directory when `CLAUDE_PROJECT_DIR` was unset, so test fixtures (`docker volume rm somevol`) landed in sual-cavab's log and skewed its counts. Found by auditing that log.
- `guard-risky-ops` no longer asks for `rm -rf` on scratch space it can prove: a path in the OS temp directory, `$TMPDIR`, and a variable the same command set from `mktemp` or a temp path (`D=$(mktemp -d) && rm -rf "$D"`). A redirection (`2>/dev/null`) is no longer read as a delete target. sual-cavab logged 17 of these asks (34 lines: the hook ran twice, see below), almost all scratch; a variable set in an earlier command, a `..` that climbs out, a variable reassigned or set after the `rm`, a name written any way the guard does not read (`export "D=..."`, `eval`, `S+=`, `-m"S=/tmp/x"`; the guard now trusts a variable only when every write to it is a plain top-level assignment), a bare `"$D/"*` (an unset variable makes it `/*`), and a root or home delete still prompt or deny.
- `sudo` with options no longer hides a command from every `guard-risky-ops` rule. Only a bare `sudo` was skipped, so `sudo -u deploy rm -rf /` and `sudo -E git reset --hard` were not seen at all.

## 0.3.0 (2026-11-09)

### Added
- **A write-up of the first full project run**: "One day with the harness", at https://rmusayevr.github.io/claude-harness/blog/one-day-with-the-harness.html. Thirteen issues, sixteen PRs, 25 reviewer runs, what went wrong and what it changed here.
- The usage log records a subagent's model when the call names one, and the guide says what the log cannot see.
- **Usage tracking**: the `harness-usage` hook records each skill that loads
  (skill name only, never the prompt) in `.claude/harness-usage.log`, and
  `npm run usage` reports what was used and what never was. Subagents are
  recorded too, as `agent:<name>`.
- **How it works diagram**: an interactive walkthrough at
  https://rmusayevr.github.io/claude-harness/ (from `docs/index.html`), and a
  static light/dark copy at the top of the README. `npm run diagram`
  regenerates the copy; CI fails if it is out of date.
- **`/harness:start`**: asks what you're doing and shows what to say, what will
  happen, and what it will refuse. Slash-only, so it costs nothing per session.
- `CONTRIBUTING.md`, and issue forms for "a guard blocked normal work" and
  other bugs.

### Changed
- Wording from the first full project run: `review-for-data-loss` asks for one lock order tested with threads; `verify-for-real` runs through the proxy and migrates the dev database first; the CLAUDE.md block says a project's rules outrank a skill's defaults; `work-the-queue` says a Small issue needs no plan comment. The model-pin check ignores case.
- **Model pins**: `fresh-eyes-reviewer` runs on Opus, and so do `risky-op`,
  `review-for-data-loss`, `audit-permissions`, `migrate-data` and
  `handle-secrets`. The rest inherit your session's model, so you can run the
  loop on Sonnet and still get Opus where a miss is expensive. Pins only go up;
  `npm run audit` flags a downgrade. See ARCHITECTURE.md, "Model pins only go up".
- `work-the-queue` runs the matching Opus-pinned review before building a
  Risky issue.
- `review-a-dependency` checks release age first: pin the newest release at
  least two weeks old.
- `work-the-queue` confirms what the checks need (a database) is running
  before the first issue.
- `npm run audit` folds a repeated finding into one line; `--verbose` lists
  them all.
- `promote-lesson` and `work-the-queue` are under 100 body lines.
- CI uses `actions/checkout@v5` and `actions/setup-node@v5`, which run on
  Node 24; v4 ran on the retired Node 20.
- `TUTORIAL.md` notes that it was recorded on 0.1.0.

### Fixed
- An update no longer skips a skill just because `/promote-lesson` added an incident to it. Upstream wording is applied, upstream's own incidents follow upstream (reworded or retracted), and the ones a person added stay. It merges only when that provably loses nothing: both files have an `## Incidents` section holding only the exact placeholder and bullets, and nothing else differs from what was installed. Anything else is "locally edited", skipped as before; `--force` still replaces the file. A person who deleted or reworded one of upstream's own bullets has made an edit, and the file is skipped. An install from before the manifest recorded this cannot tell an incident from an edit: the update says so, and `--merge-incidents` states that incidents are your only edit, for the files it lists. A merged skill is named in the output.
- A file that is skipped and has no manifest entry (after an uninstall, or a profile switch that kept it) now stays skipped. Before, the next update treated it as untouched and overwrote it.
- `vault.mjs record` takes `--rule` (or `--rule-file`) and writes it into the lesson's head, so a lesson no longer graduates to the global vault with a placeholder instead of a rule. The first record of a slug requires it; a later project starts from the existing rule, and a rewrite in any project reaches the global copy. Global copies built before this change keep their placeholder until the slug is next recorded.
- The plain split's fragments are now read exactly as the released guard read
  them, so the guards cannot be weaker than the release by construction. A
  fuzz test (8,000 generated commands) compares every guard with the release
  on each run; it fails on each of the four earlier attempts. guard-merge
  asks GitHub once per check and has a 20 s timeout.
- "Never weaker" is now checked, not claimed: a test runs every command from
  the review rounds through the released guards and the current ones, and the
  current answer must be at least as strict. The plain split is now exactly
  the released one, and guard-merge follows each split's cd commands
  separately.
- The guards are never weaker than the plain command split they started
  with: they check both splits and the stricter answer wins. Review found the
  shell-aware splitter alone could miss commands the plain split caught. The
  price is the plain split's old false positives on quoted text, documented
  in the tests.
- The guards' command splitter was hardened after review found the
  quote-aware version could hide commands. Comments, nested shells, subshells,
  control flow and shell-fed heredocs are now inspected; see the guard tests.
- The guards split commands with a regex that ignored quotes and heredocs,
  and missed a lone `&`. A `.env` path that was only quoted text was denied,
  and `rm -rf x & cp a .env` was not checked. Commands are now split only
  outside quotes, heredoc bodies are skipped, and `&` separates commands.
- One write to several files (`tee config/production.json .env`) asked about
  the first and never checked `.env`. The most severe target now wins.
- `guard-risky-ops` returned the first match in a compound command, so an
  `ask` early in it hid a `deny` later. It now checks every part and the most
  severe decision wins. Found when `rm -rf … && cp .env.example .env` wrote
  `.env` after the ask was auto-approved.
- Uninstall removed harness hooks only from `PreToolUse`; it now cleans every
  event. The installer recognises `harness-*` hooks as its own, not only
  `guard-*`.

## 0.2.0 (2026-11-08)

### Added
- **`/harness:work-the-queue`**: works through GitHub issues on its own. It
  picks an issue (or writes one from a problem you named), plans, builds, opens
  a PR, has it reviewed fresh, fixes blockers, merges into your configured
  branch on green CI, and moves to the next one. Opt-in per project through
  `.claude/harness-loop.json`.
- **`triage-review`**: labels each review finding blocker, decision, settled or
  nit. A PR is ready at zero open blockers and decisions, not zero findings.
- **`guard-merge` hook**: asks before merging a PR with failing or pending
  checks, or with `--admin`. Inside the loop it denies any merge that isn't a
  green PR into the configured branch, and never merges into `main`.
- CI on Linux, macOS and Windows, Node 22 and 24.
- `LICENSE` (MIT).

### Changed
- README rewritten for people using the harness, with the builder detail
  below it.
- `write-an-adr`, `write-a-runbook`, `incident-writeup`, `manage-a-rollout` and
  `harness-status` are now slash-only. Five long descriptions were trimmed. The
  skill list costs about 2,420 tokens per session, down from about 2,735.
- The review agent is read-only on git: it never checks out, stashes or resets.
- The installer reads its version from `plugin.json`.

### Fixed
- The installer no longer copies the harness's own hook tests into projects.

## 0.1.0

First release: 50 core skills, two stack packs, `guard-risky-ops` and
`guard-prod-ddl`, the fresh-eyes review agent, the lesson vault and the
installer.
