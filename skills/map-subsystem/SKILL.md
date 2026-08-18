---
name: map-subsystem
description: Map an unfamiliar subsystem in a forked context — entry points, data flow, ownership boundaries, and where the surprises are — without spending main-context tokens on the search itself.
context: fork
agent: Explore
disable-model-invocation: true
---

Map the subsystem described as: **$ARGUMENTS**

Search the repository and produce a map. You are read-only. Do not edit files.

## What to find

1. **Entry points.** Every way execution enters this subsystem from outside:
   HTTP routes, CLI commands, queue consumers, cron entries, event handlers,
   exported functions other modules import. Name the file and symbol for each.
2. **The real path, not the intended one.** Follow one representative request
   or call end to end and list the files it actually passes through, in order.
   The directory layout describes the intended structure; the call path
   describes what runs.
3. **State and side effects.** What does this subsystem read and write —
   tables, caches, files, external services, in-memory state that outlives a
   request. Note anything written but never read, or set but never cleared.
4. **Boundaries.** What it depends on, what depends on it. Grep for imports of
   its exports to find the callers it does not know about.
5. **Where the surprises are.** Prioritize these — they are what the map is
   for:
   - Files that contradict their own name or directory
   - Comments explaining why an obvious approach was not taken
   - Special cases keyed on a specific id, tenant, or environment
   - Two implementations of the same thing where only one is reachable
   - `TODO`/`HACK`/`XXX` near control flow rather than near formatting

## How to search

Start broad with Glob on directory names, then Grep for the concrete symbols you
find. Read excerpts, not whole files. Follow the imports; do not assume a file
does what its name suggests until you have seen its exports.

## Output

Return a single map, under 60 lines:

- **Entry points** — file:line, one per line, with what triggers each
- **Call path** — the ordered file list for one representative flow
- **State touched** — reads and writes, marked as which
- **Callers** — who depends on this from outside
- **Surprises** — the things that would have cost someone an hour, each with a
  file:line and one sentence on why it is surprising

Cite `file:line` for every claim. A claim you cannot cite does not go in the
map — say what you could not determine instead. An uncertain map is useful; a
confident wrong one sends the reader into the wrong file for an hour.
