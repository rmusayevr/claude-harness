---
name: review-a-config-change
description: Scrutinize a change to config, environment, infrastructure, or limits, which ships without type checking or tests and takes effect immediately. Use when reviewing YAML, env vars, IaC, or a dashboard setting.
---

# Review a config change

Config causes outages at a rate wildly out of proportion to how carefully it is
reviewed. It has no compiler, usually no tests, often no staging, and it takes
effect the moment it is applied.

A one-character change to a timeout is a production incident with a two-line
diff, and it will be approved in eleven seconds.

## Read the value, not the key

The key is what the author was thinking about. The value is what will happen.

- **Units.** Is `timeout: 30` seconds or milliseconds? Is `memory: 512` MB or
  MiB? Getting this wrong by 1000x is common and looks completely normal.
- **Magnitude, sanity-checked out loud.** "30,000ms is 30 seconds — is that
  what we want a user to wait?" Say the number in human terms and the wrong
  ones become obvious.
- **Zero, empty, and unset are three different things**, and many parsers treat
  them differently. `replicas: 0` is a deliberate shutdown; an empty value may
  silently mean the default.
- **Booleans as strings.** `"false"` is truthy in most languages. So is `"0"`
  in several.

## Ask what else this number has to agree with

Config values are rarely independent, and the relationship is never expressed
in the file:

- A **client timeout shorter than the server's** turns success into a retry
  storm. Longer, and you hold connections for nothing.
- **Connection pool size × instance count** must fit the database's max
  connections. Scaling replicas is what silently breaks this.
- **Retry count × timeout** must fit inside the caller's budget.
- **Memory limit vs. heap setting** — a JVM or Node heap larger than the
  container limit is an OOM kill with no stack trace.
- **A rate limit** below a legitimate burst is an outage for your biggest
  customer only.

## Then ask the questions specific to config

- **Where does this apply?** One environment or all of them? A change intended
  for staging that lands in the shared default is the classic.
- **When does it take effect?** Immediately, on restart, or on next deploy? A
  value that only applies on restart will surprise everyone weeks later when an
  unrelated deploy finally applies it.
- **How is it rolled back?** Reverting the file is not enough if it was also
  applied by hand somewhere.
- **Does it contain a secret?** Config files are the most common place they get
  committed; see `handle-secrets`.
- **Is anything now unset that was set?** A removed key falls back to a default
  nobody has looked at in two years.

## Require evidence, not intent

Ask what the author observed, not what they expect. "I applied it to staging and
p99 dropped from 4s to 900ms" is a review-able claim. "This should improve
throughput" is a guess with a deploy attached.

Where the change is risky, ask for it to go out on its own — never bundled with
a code deploy, because you will not be able to tell which one broke things.

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
