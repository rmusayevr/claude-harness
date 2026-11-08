# Contributing

Thanks for helping. The harness stays useful only if it stays small, so most of
this page is about what *not* to add.

## The fastest useful contribution

**Tell us when a guard blocked something it shouldn't have.** A guard that
over-blocks gets switched off, and then it protects nothing. Use the
"A guard blocked normal work" issue form and paste the command it stopped.

## Before you add anything

Read [`ARCHITECTURE.md`](./ARCHITECTURE.md). It decides where a rule goes:

- **Can a script decide it from the command or the file path?** Then it's a
  guard (a hook), not prose.
- **Is it a procedure for a kind of task?** Then it's a skill.
- **Must it hold in every conversation?** Only then does it go in the
  `CLAUDE.md` block, which is capped at 80 lines.

## The rules every change follows

1. **Every rule names the mistake that bought it.** Add it under the skill's
   `## Incidents`, or in the hook's comment: what happened, where, and what it
   cost. "Be careful with X" without an incident is a guess, and gets declined.
2. **A repeat sharpens the existing rule.** Don't add a second bullet that says
   nearly the same thing.
3. **Every guard rule ships two tests:** a case it catches, and a nearby case it
   must let through. Hooks fail open: any error means "allow".
4. **Skill bodies stay under about 100 lines.** Move checklists and examples
   into a sibling file that the body points to.
5. **Descriptions route, they don't explain.** Keep them near 200 characters.
   `npm run listing-cost` must show no pair at or above 0.4.
6. **No new dependencies.** Everything runs on Node's standard library.

## Check before you open a PR

```
npm test
npm run audit
npm run listing-cost
```

CI runs the tests on Linux, macOS and Windows with Node 22 and 24.

Changed the diagram in `docs/index.html`? Run `npm run diagram` to regenerate
the README's static copy. CI fails if you forget.

In the PR, say what changed, which incident it comes from, and how you
verified it.
