---
name: locate-a-behavior
description: Find the code responsible for something you can observe — a string on screen, a log line, an email, a database write — by working backwards from the output. Use when you know what happens but not where.
---

# Locate a behavior

You can see the effect. You need the cause. Searching for what you would have
*called* it is the slow path, because whoever wrote it called it something else.

Work backwards from the artifact instead. The artifact is a literal, and
literals do not get renamed the way identifiers do.

## Start with the most distinctive literal you can see

In order of how reliably they lead straight to the code:

1. **A user-visible string.** The button label, the error text, the email
   subject. Search the exact phrase; if it is not there, search a distinctive
   fragment — the string is probably built by concatenation or held in a
   translation file. In that case find the **translation key**, then search for
   the key.
2. **A log line.** Same technique, and it usually lands inside the exact
   function you want.
3. **A URL path, route name, or query parameter.**
4. **A column, table, or field name** that gets written.
5. **A magic number or a specific constant** — a limit, a fee, a version
   string, a hex color.
6. **An HTTP header, a metric name, a queue name, a cache key prefix.**

## When the literal is not findable

The string is assembled, generated, or comes from the database. Then:

- **Search for the surrounding punctuation or format string** — `"Welcome back,"`
  or the template with the placeholder in it.
- **Search the database or CMS**, not the code. Configurable content lives in a
  row, and the code you want is the generic renderer.
- **Follow the network.** Open devtools, take the request, search for its path
  and for the response's distinctive field names.
- **Use a stack trace deliberately.** Throw from the suspect area, or set a
  breakpoint at the render/write and read the call stack downward. A stack
  trace is a precise map from effect to cause; provoke one on purpose.
- **`git log -S` on a phrase** that used to exist finds the commit that removed
  or introduced it, which names the file.

## Confirm before you believe it

Search results are candidates, not answers. Codebases contain dead
implementations, a v1 and v2 of the same thing, and copies in a vendored
directory.

Prove you have the live one: change it trivially and observe the effect, add a
temporary log line, or check `git log` on the file — code nobody has touched in
three years while the feature evolved is probably not the code running.

## When you find it

Note what made it hard to find. If the string was assembled from four fragments,
or the file name contradicts its contents, that is worth a comment — you have
just paid a cost the next person will otherwise pay again.

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
