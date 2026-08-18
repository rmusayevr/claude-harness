---
name: schedule-a-job
description: Add a cron, timer, or recurring background task with overlap, missed runs, and non-execution accounted for, since the common failure is silence rather than an error. Use when adding anything that runs on a schedule.
---

# Schedule a job

A scheduled job fails differently from a request. Nobody is waiting for it, so
when it stops running, nothing complains — and the usual way you find out is a
customer noticing the consequence weeks later.

## Alert on *non-execution*, not just on errors

This is the one that gets missed. Error alerting tells you a run failed; it says
nothing about a run that never started.

Have the job record a heartbeat on successful completion, and alert when the
last heartbeat is older than the interval plus a margin. A dead-man's switch
service, a table row with a timestamp, or a gauge — any of them, but have one.

Causes of silent non-execution: the scheduler was redeployed and lost the
entry, the container has no scheduler at all in the new environment, the cron
expression is valid but wrong, the previous run is still going, the node it ran
on was removed.

## Overlap: decide, do not discover

What happens when a run takes longer than the interval?

- **Skip** — if a run is already in progress, exit immediately. Right for most
  periodic sync work.
- **Queue** — run again immediately after. Right when every tick must happen.
- **Overlap** — only if the job is genuinely concurrent-safe. It usually is not.

The default in most schedulers is to start anyway, which for a job doing bulk
writes means two runs racing over the same rows. Take a lock, and give the lock
a TTL so a crashed run does not block every future one — see `stateful-markers`.

## Missed runs

If the job does not run for six hours, what should happen when it comes back?

- Should it process the whole backlog, or only the current period?
- Will processing the backlog produce a thundering herd — six hours of emails
  at once?
- Is "catch up" even correct? A daily report for a day that has passed may be
  worth skipping rather than sending late.

Make the job **query for what needs doing** rather than assuming it runs at a
specific moment: `WHERE processed_at IS NULL` recovers from any gap; "process
yesterday's rows" silently loses a day.

## Time is the usual bug

- **Which timezone?** Servers are UTC; business days are not. "Midnight" is
  ambiguous and the ambiguity costs a day's data.
- **DST**: an hourly job runs twice or zero times at the transition. A job at
  02:30 local may not run at all on one day a year.
- **Month ends.** The 31st does not exist in February, and `now() - 1 month`
  does surprising things on the 31st.

## Make it observable and safe to rerun

- **Idempotent**, always. It will be re-run manually, and it will double-fire.
  See `make-it-idempotent`.
- **Log start, end, duration, and how many items it processed.** A run that
  processed zero items is either fine or a total failure, and only the count
  distinguishes them.
- **Bound the work.** A job that processes "everything pending" is fine until a
  backlog makes it run for nine hours and overlap itself.
- **Runnable by hand**, with a dry-run mode. You will need it at 3am
  (`write-a-runbook`).

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
