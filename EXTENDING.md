# Extending the harness

For people maintaining or adding to the harness. To use it, read the
[README](./README.md) and [`GUIDE.md`](./GUIDE.md). Before adding anything,
read [`ARCHITECTURE.md`](./ARCHITECTURE.md): it decides which layer a rule
belongs in. [`CONTRIBUTING.md`](./CONTRIBUTING.md) has the short version.

## Keeping it healthy

### Monthly-ish

```
/harness:harness-audit
```

Mechanical pass (a script, because it is decidable): description overlap,
untested hooks and scripts, oversized bodies, `CLAUDE.md` budget, dead manifest
entries. Judgment pass (the skill body): does each skill still earn its listing
cost, do any two overlap in *intent*, does anything in `CLAUDE.md` belong in a
skill body.

### Watch the listing cost

```
npm run listing-cost
```

```
9678 chars across 46 billed skills (55 on disk)
~2420 tokens, every session and every subagent
```

This is the number you pay whether or not you use a single skill — and it is
multiplied by fan-out, because a subagent's fresh window includes `CLAUDE.md`
too. If it climbs past ~3,500 tokens, start deleting rather than adding.

**The lever:** `disable-model-invocation: true` makes a skill slash-only and
drops its listing cost to zero. Right for anything you would only ever type
yourself. Wrong for anything Claude should *notice* — a skill Claude cannot see
is a skill that never fires on its own.

### Check the install

```
/harness:harness-status
```

Distinguishes **clean** / **locally edited** / **missing**, and catches the
state that matters most: files present but the hook entry gone from
`settings.json`. Installed-but-unwired looks fine and enforces nothing.

---

## Extending it without wrecking it

Adding a skill is easy and that is the danger. Every addition costs its
description on every session forever.

### The checklist

1. **Apply the bar.** Does the body tell Claude something a competent engineer
   wouldn't already do by default? If it could be replaced by "use good
   judgment", stop.
2. **Check the layer** against the routing table. If it is decidable from a tool
   call's arguments, it is a hook, not a skill.
3. **Write a discriminating description.** It must name the *moment* it applies,
   and ideally what it is *not*. Compare `trace-a-failure` ("you HAVE an error")
   against `isolate-the-layer` ("NO useful error to follow") — same subject,
   disjoint triggers.
4. **Keep the body under 110 lines.** It stays resident once loaded. Reference
   material goes in a sibling file the body names.
5. **Run the checks:**
   ```
   npm run listing-cost      # collisions and budget
   npm run audit             # everything mechanical
   npm test                  # 93 tests
   ```
6. **Test the routing empirically.** Write 5–10 realistic prompts and ask a
   fresh session which skill it picks. Word-overlap scoring misses intent
   collisions; this does not. The current library scores 42/42.
7. **Never fabricate an incident.** An `## Incidents` section reading "None
   recorded yet" is honest. A made-up ticket number is indistinguishable from a
   real one later, and the whole provenance discipline rests on that difference.

### Adding a hook

Same routing check, plus:

- `deny` only for what should never happen by accident. `ask` for everything you
  might legitimately want. **When in doubt, `ask`.**
- **Do not let the rule's correctness depend on the `ask` being answered.**
  Unattended, it either hard-blocks or is resolved by a permission mode — see
  *`ask` is not a guarantee that anyone is asked* in `ARCHITECTURE.md`. If the
  operation must not proceed without a human, it is a `deny`.
- **Decide from the file, not from the tool that touches it.** Any rule keyed on
  a path has to be reachable from `Bash` too, or `sed -i` and `cat >` walk
  straight past it. `guard-risky-ops` routes shell writes back through the same
  `checkWrite`; a new path rule should do the same rather than trusting that the
  write arrives as `Write`.
- **Fail open.** Any throw exits 0.
- **Ship a `.test.mjs` beside it**, and weight it toward false positives — a
  guard that over-blocks gets disabled, and a disabled guard enforces nothing.
- Name it `guard-<what>.mjs` if it decides, `harness-<what>.mjs` if it only
  records. The installer recognises its own hooks by those prefixes, so any
  other name is duplicated on reinstall and left behind on uninstall.
- Register it in `hooks/hooks.json`. That file is the single source of truth;
  the installer translates it and discovers hook files by walking the directory,
  so you do not need to touch `install.mjs`.
