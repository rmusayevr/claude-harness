---
name: audit-permissions
description: Verify that authorization is enforced where the data is reached rather than where the route is declared, and that the default is denial. Use when adding endpoints, queries, or anything that returns records belonging to someone.
---

# Audit permissions

Authentication asks who you are. Authorization asks what you may touch. Almost
all real breaches are failures of the second, in code that authenticated
perfectly.

## Enforce at the data boundary

A check in the route decorator, the middleware, or the UI is a check that one
path performs. The query is reached by many paths — a background job, an admin
tool, a GraphQL resolver, a new endpoint added next month by someone who did not
know the rule lived upstream.

**Scope the query itself.** `WHERE org_id = :caller_org` in the data access
layer is enforced for every caller that will ever exist. A check that can be
bypassed by calling a different function is a convention, not a control.

## The object-level check is the one that gets skipped

Route-level checks answer "may this user use this feature". They do not answer
"may this user touch *this record*".

For every handler taking an id, ask: what happens if I pass someone else's? Test
it directly — this is fast, and it is the single most common real vulnerability
in application code. Sequential integer ids make it trivial to find valid
targets; UUIDs make it harder to guess, which is not the same as preventing it.

Also check: nested resources (`/orgs/1/docs/99` where doc 99 belongs to org 2),
bulk endpoints that check the first id and trust the rest, and any id arriving
in a body or filter rather than the path.

## Default deny

- New endpoints must require an explicit grant, not inherit access by being
  unlisted. Enumerate routes and diff against the set with declared checks; the
  ones with none are the finding.
- Deny on error. A permission lookup that throws must not fall through to
  allowed. Read the `catch`.
- Unknown role, expired token, missing claim, empty permission list — each must
  fail closed. An empty list of allowed actions that is treated as "no
  restrictions" is a classic and total bypass.

## Check the edges of identity

- **Ownership transferred or revoked** — a share that was deleted, membership
  removed. Is access re-evaluated, or cached in a session or a token that
  outlives the change?
- **Soft-deleted records** still returned by a query that forgot the filter.
- **The check that runs after the work.** Authorizing after the expensive query
  or the side effect leaks existence and sometimes the effect itself.
- **Different answers for "not found" and "not allowed"** — that difference
  enumerates records for an attacker. Return the same.

## Verify by trying it

Two accounts, real requests, other account's ids. Assert the failure in a test
that lives with the endpoint. Reasoning about authorization has a poor record;
attempting the access has a perfect one.

## Incidents

_None recorded yet. `/promote-lesson` appends real occurrences here._
