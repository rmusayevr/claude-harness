---
name: design-direction
description: Choose a visual direction for a project's UI from who uses it and what it must do, offer three directions that differ in kind for the owner to pick, and record the choice in DESIGN.md. Use before the first screens, a redesign, or any UI work in a project with no DESIGN.md.
---

# Design direction

Asked for "a nice UI", a model returns the same look every time: warm cream
with a serif and a terracotta accent, near-black with one neon colour, a
purple-to-blue gradient, one UI font, emoji as icons, everything centred in
identical rounded cards. None of it comes from the project. This skill makes
the look come from the project, and makes the owner choose it.

## 1. Read before designing

The README and issues (what it does, for whom), the list of screens or routes,
and what styling already exists (tokens, a Tailwind config, a component
library, screenshots, a brand or an old site the owner points to).

If `DESIGN.md` exists, follow it and stop here: this skill is for when there is
none, or when the owner asks to change direction.

## 2. Ground it, in four lines taken from the project

- **Who:** the role, how often they come, how long a visit lasts, on what device.
- **The job** of the main screen, in one sentence.
- **The worst day:** the state the UI must still work in (200 open items, an
  empty project, a refused request, a slow connection).
- **Tone, and the field's own words:** the objects, units and document
  conventions people in this field already use. Use them in the design.

A line you cannot fill from the project is a question for the owner, not a gap
to fill with taste.

## 3. Three directions that differ in kind

Not three palettes. Three different answers to "what is this screen?" (a dense
table, a board, a timeline, a ledger, a feed). For each, give:

- the idea in one sentence, drawn from step 2, and a name;
- the main screen's layout: a sketch, or a 40-line static HTML file;
- type: a display face, a body face and a face for data, from a free source,
  with real fallbacks, and the reason for each;
- 5 or 6 named colour tokens for light and for dark, with the reason;
- what it does badly: one honest risk.

One of the three is the plainest thing that does the job. Each says which of
the generic looks above it avoids and why, or uses and why.

## 4. The owner picks: stop

Post the three as an issue comment and ask one question: which one, with your
recommendation and its reason. Do not build before the answer. "You choose"
means the plainest that serves the job from step 2, and say why.

## 5. Record it in DESIGN.md

At the repo root, from `design.template.md` next to this file. Tokens go in as
a CSS block code can paste. Keep it under about 120 lines. Add one line to the
project's `CLAUDE.md`: "UI follows DESIGN.md; changing it takes an issue."

## 6. Build one screen and look at it

Build the main screen from `DESIGN.md`, then render it: 400 px and 1280 px,
light and dark, and the empty, loading, error and 200-item states. With a
browser tool, take screenshots and name the files. Without one, say so and
give the owner the one command that opens it, as `verify-for-real` asks.

Check and report what you saw: text contrast of at least 4.5:1 (say how you
measured it), a visible keyboard focus, no sideways scroll at 400 px,
`prefers-reduced-motion` respected, and a real font fallback.

## Later UI issues

Follow `DESIGN.md`. A token it lacks is added to `DESIGN.md` in the same PR,
with a line saying why. A component that fights the file is a finding for
`triage-review`, not a local override.

## With Figma

If a Figma tool is connected, read the file the owner names as the source of
truth for steps 1 and 3. Never write to a file the owner did not name.

## Incidents

- **sual-cavab (2026-11-08).** The UI was planned and a library chosen by
  hand, and nothing shaped the look. The owner noticed that the harness gave
  no design guidance at all.
