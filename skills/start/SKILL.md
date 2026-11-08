---
name: start
description: First stop for someone new to the harness. Ask what they are doing right now, then show what to say and what will happen, in plain words. Use when someone types /harness:start or asks how to use the harness.
disable-model-invocation: true
---

# Start here

The person typing this does not want a tour of 54 skills. They want to get
their current task done with the harness helping. Speak in plain words: say
"checklist" for skill, "safety guard" for hook, "lesson" for vault entry.

## 1. One question

Ask, with these options (recommend none; let them pick):

> What are you doing right now?
> 1. Fixing a bug
> 2. Building a feature or a change
> 3. Getting a change ready to merge
> 4. Something is broken in production
> 5. Learning code I didn't write
> 6. Working through GitHub issues
> 7. Just looking around

## 2. Answer for that one situation only

Give three things, nothing more:

- **What to say:** one sentence they can type now.
- **What will happen:** two or three lines, in order.
- **One thing it will refuse:** so the first block doesn't surprise them.

| Situation | What to say | What happens | What it refuses |
|---|---|---|---|
| Bug | "This bug happens when …" | It reproduces the bug first, fixes it, then proves the fix with a test that failed before | Calling it fixed without that test passing |
| Feature | "Add … to …" | It states what it won't touch, keeps the change small, tests it, then reads its own diff | Unplanned changes to other areas mixed in |
| Ready to merge | "Is this ready?" | A second Claude with no memory of the work reviews it; findings are sorted into must-fix and can-wait | Merging with failing checks without asking you |
| Production | "… is broken in production" | It stops the damage first, then investigates on the live system read-only | Destructive commands without your yes |
| New code | "Help me understand …" | It maps how the area fits together before suggesting any change | Changes before the map |
| GitHub issues | `/harness:work-the-queue` | It sets up a small config with you, then plans, builds, reviews and merges issue by issue, stopping for questions | Merging into `main` |
| Looking around | — | Show the three commands below and the six "you say" lines from the README | — |

Then do the task if they gave one. Don't explain further unless asked.

## 3. Close with the three commands, once

- `/harness:promote-lesson`: "remember this mistake"
- `/harness:work-the-queue`: work through GitHub issues
- `/harness:harness-status`: check the install works

If a safety guard blocks something that looked normal, tell them that's a bug
worth reporting, and give the issue link from the README.

## Incidents

- **Public release prep (2026-11).** The owner's verdict on the full catalogue
  and guide: "in the real practice people can't use it because it's too much
  and don't know how to use it." 54 skills and a 700-line guide answered the
  builder's questions, not the user's.
