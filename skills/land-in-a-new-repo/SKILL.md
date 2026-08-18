---
name: land-in-a-new-repo
description: Orient in an unfamiliar codebase by reading the artifacts that state intent — tests, CI config, recent commits — before reading the source. Use in the first hour on a repository you have not worked in.
---

# Land in a new repo

Reading source files top-down is the slowest way to understand a codebase,
because source says *what* without saying *what matters*. Read the artifacts
that encode intent first.

## Read in this order

1. **The CI config.** This is the project's own definition of "correct":
   the commands that must pass, the versions supported, the checks that gate a
   merge. Ten lines that tell you what the team actually enforces, as opposed to
   what the README aspires to.
2. **How it is run.** `Makefile`, `package.json` scripts, `docker-compose`,
   the dev setup section. Get it running before understanding it — a codebase
   you can execute is a codebase you can experiment on, and everything after
   this step is faster.
3. **The tests.** Test names are a specification written by people who knew the
   requirements. Skim names before bodies; they describe the domain rules in
   plain language and reveal the vocabulary the team uses.
4. **The last ~30 commits.** `git log --oneline -30`, then read three or four
   in full. This tells you what is under active change, what the commit
   conventions are, and where the current work is concentrated — which is
   almost certainly where your work will be.
5. **The dependency manifest.** The frameworks decide the architecture. Knowing
   it uses a specific ORM, queue, or DI container tells you the shape of half
   the code before you open it.
6. **Only now, source** — and start from a *specific question*, not from `src/`.

## Build the map from the outside in

Pick one real user-visible behavior and trace it end to end (see
`map-subsystem`, or `isolate-the-layer` for the probing technique). One complete
path teaches more than skimming ten files, because it shows you which of the
directories are actually on the critical path and which are vestigial.

## Signals worth noting early

- **Where the churn is.** `git log --format= --name-only | sort | uniq -c |
  sort -rn | head -20` — the most-changed files are either the core domain or
  the part nobody got right. Either way you will end up there.
- **Where the comments are apologetic.** "Don't change this without…",
  "temporary", a link to an issue. These mark the real constraints.
- **What is duplicated.** Two implementations of the same concept usually means
  a migration nobody finished, and you need to know which one is live.
- **Conventions actually followed**, not documented. Read three files in the
  same directory and match what they do.

## Do not

Do not read the whole thing before starting. Do not reorganize anything in the
first week — what looks like disorder is usually a constraint you have not met
yet. Write down what confuses you instead; that list is worth more than the
tidying, and it expires within days as you acclimatize.

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
