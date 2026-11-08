# Changelog

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
