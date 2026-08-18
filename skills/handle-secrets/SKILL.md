---
name: handle-secrets
description: Respond to an exposed credential by rotating first, and keep secrets out of code, logs, and error messages. Use when a key is committed, printed, pasted, or sent anywhere it should not have been.
---

# Handle secrets

## If a secret was exposed, rotate it. First. Now.

Rewriting git history does **not** un-expose a credential. By the time you
notice, the value may have been fetched by CI, cached by a proxy, replicated to
a fork, indexed by a scanner, or read by a person. Treat any exposed value as
compromised permanently.

Order of operations, and the order matters:

1. **Rotate the credential.** Issue a new one, deploy it, revoke the old one.
   Until this is done, nothing else you do reduces risk at all.
2. **Check for use.** Read the access logs for the old credential over the whole
   exposure window. This is the step that turns "we had a scare" into "we know
   what happened", and it is the one that gets skipped.
3. **Then** clean the history, if you still want to — it is now hygiene, not
   remediation.

Cleaning history first, and rotating later or not at all, is the common and
wrong sequence. It feels like fixing the problem because the visible artifact
disappears.

## Where secrets leak that people forget

- **Error messages and stack traces** — a connection string in a
  `could not connect to <url>` message, reaching an error tracker and an inbox.
- **Logs** — a request logger that dumps headers, including `Authorization`.
- **URLs** — query parameters land in access logs, browser history, and
  `Referer` headers sent to third parties. Secrets go in headers or bodies.
- **Debug output** — `console.log(config)`, a `repr` of a client object.
- **Test fixtures and snapshots**, committed with a real token because it was
  easier than a fake one.
- **CI output** — masked in the provider's log view, not in an artifact you
  wrote yourself.
- **Screenshots and terminal recordings** in bug reports.

## Keeping them out

- Read from the environment or a secret manager at the point of use. Do not
  copy into a module-level constant that ends up in a bundle or a log line.
- Commit `.env.example` with **keys and no values**. The guard hook denies
  writes to `.env` for exactly this reason.
- Give the type or wrapper a redacting `toString`/`__repr__` so accidental
  printing is inert. This is the only defense that survives the code being
  changed by someone who has not read this file.
- Scope credentials narrowly and give them expiry. A key that cannot do much and
  dies on its own converts an incident into a note.

## Do not

- Do not commit a secret "temporarily".
- Do not paste one into a chat, an issue, or a prompt to check its format.
- Do not weaken a check to make a secret work — an expired certificate is not
  fixed by disabling verification, it is deferred at the cost of everyone.

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
