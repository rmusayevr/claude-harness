# work-the-queue — reference

Lookup material for the loop. The procedure is in `SKILL.md`.

## `.claude/harness-loop.json`

Commit it. The `guard-merge` hook reads it too, and its presence is what
switches that hook from "ask" to "deny".

```json
{
  "base": "staging",
  "protected": ["main"],
  "queue": { "label": "ready", "parent": null },
  "parkedLabel": "waiting",
  "autoMerge": true,
  "mergeMethod": "merge",
  "checks": [
    "cd backend && python manage.py test --noinput",
    "cd frontend && npm run typecheck && npm test"
  ],
  "risky": ["backend/payments/", "backend/auth/", "migrations/"],
  "stopFor": ["pricing rules", "data retention"]
}
```

| Key | Meaning | Default |
|---|---|---|
| `base` | The only branch the loop merges into. Required. | — |
| `protected` | Extra branches nothing in the loop may merge or push into. `main`, `master`, `develop`, `prod`, `production`, `release/*`, `hotfix/*` are always protected. | `[]` |
| `queue.label` | Open issues with this label form the queue. | `ready` |
| `queue.parent` | A tracking issue whose task list (`- [ ] #12`) fixes the order. Overrides label order. | `null` |
| `parkedLabel` | Label for issues waiting on a human. Skipped when picking. | `waiting` |
| `autoMerge` | Merge when ready. `false`: stop at "ready" for a human. Forced to `false` when `base` is protected. | `false` |
| `mergeMethod` | `merge`, `squash` or `rebase`. Keep `merge` when commits are meant to survive. | `merge` |
| `checks` | Commands that must pass before a PR is opened. Same as CI, plus anything CI skips. | `[]` |
| `risky` | Path prefixes that make a change Risky. | `[]` |
| `stopFor` | Project business rules to ask about, on top of money, permissions, reservations and identity. | `[]` |

## Picking order

1. With `queue.parent`: `gh issue view <parent> --json body`, take the task-list
   lines top to bottom, first one that is an open issue without `parkedLabel`.
2. Otherwise: `gh issue list --state open --label <label> --json number,title,labels,milestone --limit 100`,
   drop parked ones, order by milestone due date, then issue number.
3. Read the pick: `gh issue view <n> --comments`.

## New issue (empty queue)

```bash
gh issue create --label <label> --title "<what is wrong, in user terms>" --body-file <file>
```

Body:

```markdown
## Problem
<what happens, where, for whom; the evidence: command output, link, finding>

## Expected
<what should happen instead>

## Out of scope
<what this issue will not change>

## Source
<the user's request in this session, or the run/PR that surfaced it>
```

## Plan comment (Medium, Risky)

```markdown
**Size: <Small|Medium|Risky>**: <the rule that matched, e.g. "touches backend/payments/">

**Plan**
1. <step> (<files>)
2. ...

**Tests**: <what proves it, including the failing-first test for a fix>
**Docs**: <the doc that changes, or "none, because ...">
**Open questions**: <business questions, or "none">
```

## PR description

```markdown
Closes #<issue>

## What changed
## How it was verified
<commands run, with their result>
## What was not verified
<and why>
## How to accept
<3 to 5 concrete steps on the test environment, each with the expected result,
or "Nothing to check by hand" and why>
```

## Branch

```bash
git fetch origin
git switch --no-track -c feat/<topic>-$(date +%Y%m%d) origin/<base>
git push -u origin HEAD
```

For parallel sessions, give each its own worktree; never share one checkout
between two agents.

## Reviewer brief

> Use the fresh-eyes-reviewer subagent to review this diff. It is read-only:
> do not run git checkout, switch, stash, reset or commit, and do not run the
> test suite. Diff: `<output of gh pr diff <n>>`

## Merged branches

`--delete-branch` removes the PR branch on GitHub and locally. The repo can do
the GitHub half on its own (Settings → "Automatically delete head branches",
or `gh repo edit --delete-branch-on-merge`); suggest it once, it is the
owner's setting. Never delete a branch whose PR is not merged.

## CI

```bash
gh pr checks <n> --watch --fail-fast
gh run rerun <run-id> --failed                 # once, for an unrelated flaky test
gh pr merge <n> --merge --delete-branch        # or --squash / --rebase per config
git switch <base> && git pull                  # --delete-branch left you on base
sha=$(gh pr view <n> --json mergeCommit --jq .mergeCommit.oid)
gh run list --branch <base> --commit "$sha" --json databaseId,status,conclusion,name
gh run watch <run-id> --exit-status
```

`gh run list` can be empty for a few seconds after the merge. List again
before deciding the base has no CI.

## Closing

Find the default branch with
`gh repo view --json defaultBranchRef --jq .defaultBranchRef.name`. If `base`
is not it:

```bash
gh issue close <n> --comment "Merged into <base> in #<pr>."
```

Then tick `- [x] #<n>` in the parent with `gh issue edit <parent> --body-file <file>`.
Read the parent body first and change only that line.

## Exit codes

Never let the command you are checking be followed by anything that sets
`$?`. Wrong: `npm test; echo done`. Right: `npm test` on its own, or
`npm test; echo "exit=$?"`.
