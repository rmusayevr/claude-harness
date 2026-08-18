---
name: review-a-dependency
description: Decide whether to add a third-party package by weighing what removing it later would cost, not just what adding it saves today. Use before introducing any new library, action, or base image.
---

# Review a dependency

Adding a dependency is fast and reversible for about a week. After that it is
load-bearing, and the cost you are choosing is the cost of *removing* it.

## First: is it needed at all

- Does the standard library or an existing dependency already cover this? Check
  before searching a registry — `find-prior-art` applies to vendored code too.
- Is the part you need small and stable? Copying thirty lines with attribution
  is often better than a dependency with a transitive tree and a release
  cadence. Copying three thousand is not.
- Would you be able to write it if the package vanished? If not, that is an
  argument *for* the dependency, not against — but know that is the position.

## Signals worth checking, in order of predictive value

1. **Transitive count.** `npm ls --all | wc -l` or equivalent. One package with
   forty dependencies is forty supply-chain surfaces and forty things that can
   break your build independently.
2. **Install-time execution.** Postinstall scripts, native builds, binary
   downloads. These run with your credentials on every machine and in CI.
3. **Maintenance reality.** Not stars — the ratio of open issues to recent
   commits, whether the last release predates the runtime version you are on,
   and whether one person merges everything.
4. **Release discipline.** Does it follow semver in practice? Read the changelog
   for a major bump and see whether breaking changes were flagged or discovered.
5. **License**, against your distribution model. Copyleft in a shipped binary is
   a decision for someone else to make, and it must be made before adoption.
6. **Size, where it ships to a client.** Check the bundled cost, not the
   published tarball.

## Contain it at the boundary

Do not scatter a library's types and idioms through the codebase. Wrap it behind
an interface you own, in one place, exposing only what you use.

This is the difference between "swap the date library" being a one-file change
and a six-month project. The wrapper costs an hour now and is the entire reason
removal stays possible later.

The exception is a dependency so foundational that the wrapper is a fiction —
the framework itself, the language runtime. Wrapping those is cargo cult; be
honest about which kind you have.

## Record the decision

In the commit or an ADR: what it replaced, what you rejected, and what would
make you remove it. Six months later nobody remembers whether the choice was
considered or accidental, and that determines whether anyone dares change it.

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
