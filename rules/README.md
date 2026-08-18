# Stack packs

Optional, profile-gated skills. Same format as `skills/` — each pack is
`rules/<stack>/<name>/SKILL.md` — but they are **not installed by default**.
`install.mjs --profile backend` copies `rules/backend/**` into the project
alongside the core skills; `--profile core` copies none of them.

## Why these are skills and not always-loaded rules

There is no loader for a `rules/` directory in Claude Code. Content here has two
possible destinations: appended into `CLAUDE.md`, or installed as skills.

Appending to `CLAUDE.md` costs N lines on every session **and again inside every
subagent**. Installing as skills costs one description line in the listing, and
the body loads only when it matches. For anything longer than a few lines, the
skill form is cheaper by an order of magnitude.

So `rules/` is the *source* directory for selectively-installed content. The
name is kept because that is what this content is: rules. The delivery mechanism
is a skill because that is what is cheap.

## The bar

Same as every other skill, plus one addition:

> Does the body tell Claude something a competent engineer wouldn't already do
> by default?

**A stack pack must not restate the framework's own documentation.** Anything
you could get by reading the official docs is dead weight that also rots at the
framework's release cadence. What belongs here is the part the docs cannot
contain: the local convention, the version-specific trap, the thing that is true
of *this* stack as used *here*.

## Layout

```
rules/
  backend/<name>/SKILL.md
  frontend/<name>/SKILL.md
```

Profiles: `core` (none), `backend`, `frontend`, `full` (all).
