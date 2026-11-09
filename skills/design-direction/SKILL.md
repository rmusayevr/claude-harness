---
name: design-direction
description: Choose the look of a UI from who uses it and what it must do: three directions for the owner to pick, or, if a look already exists, write it down as DESIGN.md. Use for a new UI or a redesign, not for a copy fix or a one-element tweak.
---

# Design direction

Asked for "a nice UI", a model returns the same look every time: warm cream
with a serif and a terracotta accent, near-black with one neon colour, a
purple-to-blue gradient, a serif display over a sans body over a mono for data,
emoji as icons, everything centred in identical rounded cards. None of it comes
from the project. This skill makes the look come from the project, and makes
the owner choose it. It is for screens and styled output (web, app, email); not
for CLI text or API responses. The owner's own choice outranks the list above:
if they pick one of those looks, record it and say nothing more.

## 1. Read, then decide which case you are in

Read the README and issues (what it does, for whom), the screens or routes, and
what styling exists: tokens, a Tailwind config, a component library,
screenshots, a handoff folder, a brand, a Figma file the owner names.

- **`DESIGN.md` at the repo root:** follow it and stop. A `DESIGN.md` anywhere
  else (a handoff folder) is source material, not this file.
- **A look already exists** (tokens, components, or a design the owner
  supplied): do not offer new directions. Write what exists into `DESIGN.md`
  (step 5), and ask the owner to confirm it. Then stop; nothing is redesigned.
- **Nothing exists:** steps 2 to 6.

## 2. Ground it, in four lines taken from the project

- **Who:** the role, how often they come, how long a visit lasts, on what device.
- **The job** of the main screen, in one sentence. With several candidates,
  the screen the product exists for.
- **The worst day:** the state the UI must still work in (200 open items, an
  empty project, a refused request, a slow connection).
- **Tone, and the field's own words:** the objects, units and document
  conventions people in this field already use. Use them in the design.

A line the project does not answer is a question for the owner. Collect all of
them and ask them with the pick in step 4, so there is one stop, not two.

## 3. Three directions that differ in kind

Not three palettes. Three different answers to "what is this screen?" (a dense
table, a board, a timeline, a ledger, a feed). For each:

- the idea in one sentence, drawn from step 2, and a name;
- the main screen's layout, as a sketch or a small static HTML file;
- type, with real fallbacks and the reason: a system stack is a valid answer,
  and the serif-sans-mono trio needs a reason like any other;
- colour tokens for light and dark: neutrals, an accent, and one text and
  background pair for each status the product has, with the reason;
- what it does badly: one honest risk.

One of the three is the plainest thing that does the job. Each says which
generic look above it avoids or uses, and why.

## 4. The owner picks

Post the three, the questions from step 2 and, for a Medium or Risky issue, the
plan, in **one** comment, with sketches the owner can open (files on an
unmerged `design-options-YYYYMMDD` branch, linked; writing options is not
building). Ask one question: which, with your recommendation and its reason.

In the loop the UI issue is **parked** until the owner answers (see
`work-the-queue`); the rest of the queue goes on. "You choose" means the
direction that best fits step 2, not the safest one, and say why.

## 5. Record it in DESIGN.md

At the **repo root**, from `design.template.md` next to this file. Tokens go in
as a CSS block that code can paste. Keep it under about 120 lines. Add one line
to the project's `CLAUDE.md`, above the harness block and not inside it (an
update overwrites the block): "UI follows DESIGN.md. Changing the direction
takes an issue."

## 6. Build one screen and look at it

The first PR carries `DESIGN.md`, the `CLAUDE.md` line and the one screen from
step 2. Render it: 400 px and 1280 px, light and dark, and the worst day from
step 2 plus the empty, loading and error states (the `loading-and-empty` skill,
if installed). With a browser tool, take screenshots and name the files.
Without one, say so and give the owner the one command that opens it, as
`verify-for-real` asks.

Check and report what you saw: text contrast of at least 4.5:1 (say how you
measured it), a visible keyboard focus, no sideways scroll at 400 px,
`prefers-reduced-motion` respected, and a real font fallback.

## Later UI issues

Follow `DESIGN.md`. A token it lacks is added to `DESIGN.md` in the same PR,
with a line saying why; that is not a change of direction. A component that
fights the file is a finding for `triage-review`, not a local override.

## With Figma

If a Figma tool is connected, read the file the owner names as the source of
truth for steps 1 and 3. Never write to a file the owner did not name.

## Incidents

- **sual-cavab (2026-11-08).** The UI was planned and a library chosen by
  hand, and nothing shaped the look. The owner noticed that the harness gave
  no design guidance at all. They then brought an external design, which the
  skill's first version would have overridden with three new directions.
