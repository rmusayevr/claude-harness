# Design

> Owner-approved direction for this project's UI. Every UI issue follows it.
> Changing it takes an issue. Delete these quoted lines once it is filled in.

## Direction

**Name.** One sentence on the idea, and who it is for.

**Why this one.** The line from "ground it" that decided it, and the risk the
owner accepted.

## Tokens

```css
:root {
  --bg: ;
  --surface: ;
  --ink: ;
  --muted: ;
  --line: ;
  --accent: ;
  /* one text and background pair for each status the product has: */
  --status-open-ink: ;     --status-open-bg: ;
  --status-done-ink: ;     --status-done-bg: ;
  --status-error-ink: ;    --status-error-bg: ;
}
@media (prefers-color-scheme: dark) {
  :root { /* the same names, dark values */ }
}
```

**Type.** The faces (a system stack is fine) and the reason for each, with fallback
stacks. Scale: sizes and line heights. Digits that line up use tabular figures.

**Space and shape.** The spacing scale, the radius, the borders, the shadows
(or the decision to have none).

## Layout

Grid, maximum widths, density, what stays on screen while the rest scrolls,
and what the layout does at 400 px.

## Components and their states

For each component the project has: default, hover, focus, disabled, loading,
empty, error. Buttons, inputs, tables or lists, badges, dialogs.

## Voice

How errors, empty states and confirmations speak. Two examples of each, in the
words of the field.

## Don't

The habits of the directions that were not chosen, and any generic look this
project refuses.
