---
name: git-archaeology
description: Recover why code is the way it is from history — the commit, the discussion, the incident — before changing something that looks wrong. Use when code seems pointless, redundant, or obviously improvable.
---

# Git archaeology

Code that looks wrong usually is not arbitrary. It is a constraint you have not
met yet, written by someone who had met it. Find out what it was before removing
it — the phrase "why is this here?" has a factual answer, and it takes about two
minutes to get.

## Getting to the commit

```
git log -L <start>,<end>:<file>     # every change to these lines, with diffs
git log -S '<exact string>'         # commits that added or removed this text
git log -G '<regex>'                # commits whose diff matches
git blame -w -C -C -M <file>        # ignore whitespace, follow moves and copies
```

Plain `git blame` is misleading: it credits the last reformat, rename, or file
move rather than the change that introduced the logic. **`-w -C -C -M` is the
form worth memorizing** — without it, archaeology on any repo that has been
reformatted returns the person who ran the formatter.

When blame lands on a bulk commit, blame the *parent* of that commit at the same
line and repeat until you reach a change with intent.

## Getting to the reasoning

The commit is a pointer to the discussion, which is where the reason actually
lives:

- Commit message body, and the ticket or PR number in it.
- `git log --merges --ancestry-path <sha>..HEAD | tail -1` finds the merge that
  brought it in, and the PR that merge references.
- The PR review comments — the objection someone raised and how it was answered
  is often the entire explanation.
- Tests added in the same commit. A test named after a specific edge case *is*
  the reason, stated precisely.

## What the findings mean

| What you find | What to do |
|---|---|
| A commit fixing a named bug or incident | The constraint is real. Preserve the behavior; improve the clarity, and keep the test. |
| A test added alongside it | Do not delete it to make your change pass. That test is the incident's memory. |
| "Temporary workaround for <upstream bug>" | Check whether upstream fixed it. Often removable now, and that is a genuine improvement. |
| No explanation anywhere | Now you may change it — and leave the explanation you wished you had found. |

## Leave the trail better

When you discover a non-obvious reason, write it into the code as a comment
citing the commit or issue. You have just spent ten minutes on something the
next reader will otherwise spend ten minutes on again, indefinitely.

Comment the constraint, not the mechanism: "orders can arrive out of sequence
from the payment provider (INC-2214)" rather than "sort the array".

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
