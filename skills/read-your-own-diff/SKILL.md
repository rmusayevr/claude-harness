---
name: read-your-own-diff
description: Read your change as a diff before handing it to anyone, to catch the debris and the accidents that are invisible while editing files. Use immediately before committing, pushing, or opening a PR.
---

# Read your own diff

While editing you see files. A reviewer sees a diff. These show different
things, and the second one shows what you left behind.

This is not review — `fresh-eyes-review` is review, and you cannot do it on your
own work. This is proofreading, and it takes two minutes.

## Read the whole thing, as a diff

`git diff`, `git diff --staged`, or `git diff main...HEAD`. Read every hunk. Not
the summary, not the file list.

## The debris list

Almost every unreviewed diff contains at least one of these:

- **Debug statements.** `console.log`, `print`, `dd()`, `fmt.Println`, a
  logger left at debug level.
- **Commented-out code.** Delete it. Git remembers; a commented block does not
  say whether it is a plan, a fallback, or forgotten.
- **A `TODO` you added an hour ago** and will not do. Either do it, file it, or
  remove it.
- **Hardcoded values from testing** — your email, `localhost`, a fixed date, a
  test tenant id, a stubbed return that was meant to be temporary.
- **A temporarily loosened check** — a disabled test, a widened timeout, a
  skipped assertion, a commented-out validation.
- **Whitespace and formatter churn** unrelated to the change, burying the real
  edit. Separate it (see `split-a-big-change`).
- **A file you did not mean to include.** A local config, an editor setting, a
  lockfile churned by a different package manager, a `.env`.

## Then check the diff is what you think it is

- **Is it against the right base?** A diff that includes fifty files of someone
  else's work means you branched from the wrong place.
- **Does the change appear once?** Fixing the same thing in two places usually
  means one of them is now dead, or they will diverge.
- **Is anything missing?** The test you meant to write, the migration's down
  path, the doc line, a caller you meant to update. Absence is invisible while
  editing and obvious in a diff.
- **Does each hunk belong to the stated change?** Anything that does not is
  either a separate commit or a mistake.

## Read it as the reviewer

For each hunk ask: *could someone tell why this changed, from the diff and the
commit message alone?* Where the answer is no, that is where a comment belongs
in the code — or where the commit message needs the reason (`write-commit`).

Then check the things you cannot see in your editor: does it read consistently
with the surrounding code, and does anything you renamed still appear under the
old name in a string, a comment, or a doc?

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
