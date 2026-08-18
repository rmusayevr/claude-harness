---
name: deprecate
description: Remove an endpoint, flag, function, or table on evidence of non-use rather than on belief, using a shim and an observation period. Use when deleting anything that other code or other people might still call.
---

# Deprecate before deleting

Deletion is the only irreversible refactor. Everything else can be reverted from
the diff; a deletion that was wrong is discovered by someone else, later, as an
outage.

## Find real usage, not imagined usage

Grep is necessary and not sufficient. It misses:

- Dynamic dispatch — `handlers[name]`, reflection, `getattr`, string-keyed
  registries
- Other repositories, mobile clients that shipped months ago, scheduled jobs
- Config files, infrastructure templates, dashboards, alert queries
- Documentation and runbooks people follow by hand
- Anything constructed by concatenation: `"user_" + suffix`

**Instrument instead of guessing.** Log every call with enough identity to know
*who* called — service, version, user agent. Then wait. The observation period
must cover the longest natural cycle: monthly invoicing, quarterly reports, the
annual audit export. A week of silence proves nothing about a monthly job.

## The sequence

1. **Mark deprecated.** Annotation, doc comment, changelog. Say what to use
   instead — a deprecation without a replacement is a complaint, and callers
   will keep calling.
2. **Instrument.** Count and identify callers. This is the step that gets
   skipped, and it is the only one that produces evidence.
3. **Warn at the call site.** A log line, a response header, a console warning
   during development. Aim it at the person who can act, not at a dashboard
   nobody reads.
4. **Reach out**, if callers are people. Named owners, a date.
5. **Break it reversibly.** Turn it off behind a flag, or fail for a short
   window, and watch. This surfaces the callers your instrumentation missed
   while restoring is still one toggle.
6. **Delete**, in its own commit, referencing the evidence.

## The shim

Where callers cannot be migrated in time, keep a thin forwarding shim rather
than the old implementation. The shim is trivial, obviously temporary, and
delegates to the new path — so there is exactly one implementation, and the old
one cannot drift into being subtly different from the new one.

Give the shim a removal date in a comment, and log when it is hit.

## Evidence, then delete

The commit that deletes should be able to state: instrumented since `<date>`,
`<n>` calls observed, from `<callers>`, all migrated. If you cannot write that
sentence, you are deleting on belief.

"Nobody uses this" is a hypothesis. It is testable, and testing it is cheap
compared to the alternative.

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
