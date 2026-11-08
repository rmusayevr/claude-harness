# Changelog

## Unreleased

### Added
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
