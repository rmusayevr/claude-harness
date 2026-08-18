---
name: environment-divergence
description: Enumerate the specific axes on which two machines differ when code behaves differently on each. Use for "works on my machine", CI-only failures, and bugs that vanish locally.
---

# Environment divergence

"Works on my machine" is not a dismissal, it is a measurement: you now have one
environment where the code is correct and one where it is not, and the defect is
in the difference. The difference is almost always on this list.

## The axes

Check in this order — roughly by how often each one is the answer:

1. **Dependency versions.** Not the manifest — the *resolved* tree. `npm ls`,
   `pip freeze`, `go list -m all` on both. A lockfile that is not committed, or
   is committed but bypassed by a fresh `install` on CI, is the single most
   common cause.
2. **Environment variables.** Including absent ones. Compare the full set, not
   the ones you remember. A variable that is empty-string on one side and unset
   on the other is a difference, and most code treats them the same by accident.
3. **Data.** Your local database has three rows you created by hand; theirs has
   four million including nulls in a column you assume is populated. Bugs that
   only appear with real data are usually about scale, nulls, or duplicates.
4. **Filesystem.** Case sensitivity is the classic — `import './Button'` resolves
   on macOS/Windows and fails on Linux CI. Also line endings, path separators,
   permitted filename characters, and symlink handling.
5. **Time and locale.** Timezone (UTC on CI, local on your laptop), DST, locale
   affecting number and date formatting, and sort collation.
6. **Concurrency and resources.** CI is slower and more parallel. Races that
   never lose locally lose there routinely, and a container memory limit turns a
   working process into an OOM kill with no error.
7. **Network.** Egress blocked, DNS differs, a service reachable from one and
   not the other, a proxy injecting headers.
8. **Runtime and OS.** Node/Python/JDK minor version, libc, architecture
   (arm64 vs x86_64), container base image.

## Procedure

1. **Do not guess the axis.** Capture the same evidence on both sides — full env
   dump, resolved dependency list, runtime version, `pwd`, user, timezone — and
   diff them. The list of differences is usually short and contains the answer.
2. **Change one axis at a time**, toward the broken environment. Reproduce
   locally by adopting the broken side's value, not by trying to fix the broken
   side blind. A local reproduction is worth far more than a remote fix.
3. **When you find it, ask why the divergence existed.** Pinning the version
   fixes today; a lockfile that CI actually honors fixes the class.

## Do not "fix" it by retrying

Re-running CI until it passes converts a real defect into an intermittent one
that everyone learns to ignore. If you re-run, record that you did and why —
an unexplained green after a red is not evidence.

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
