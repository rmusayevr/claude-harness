#!/usr/bin/env node
/**
 * Records which skills are used, so the harness can be pruned on evidence.
 *
 * The listing costs every session whether or not a skill ever loads, and
 * there was no way to tell which of the 50-odd checklists earn that cost.
 * This hook answers it with one JSON line per use in
 * `.claude/harness-usage.log`; `npm run usage` (scripts/usage.mjs) reads it.
 *
 * Two routes in, because skills arrive two ways:
 *   PreToolUse, tool `Skill`   Claude loaded a skill itself      via: "auto"
 *   UserPromptSubmit `/name`   a person typed the slash command  via: "typed"
 *   PreToolUse, `Agent`/`Task` a subagent ran, as agent:<type>   via: "auto"
 *
 * Subagents count because a skill can delegate its core step to one: the
 * fresh-eyes review in sual-cavab's loop ran as a subagent and the log never
 * showed it.
 *
 * It never decides and never speaks: no stdout at all. On UserPromptSubmit,
 * stdout would be added to Claude's context, which is exactly the per-event
 * tax the harness's ARCHITECTURE.md forbids. Only the skill or command name
 * is written, never the prompt text. Local file, no network.
 *
 * FAIL OPEN and silent, like every hook here.
 */
import { pathToFileURL } from 'node:url';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

const NAME = /^[a-z0-9][a-z0-9-]*$/;

/** The skill a payload used, or null. Exported for tests. */
export function usage(payload) {
  try {
    const event = payload?.hook_event_name;
    if (event === 'PreToolUse' || (!event && payload?.tool_name)) {
      if (payload?.tool_name === 'Agent' || payload?.tool_name === 'Task') {
        const type = String(payload?.tool_input?.subagent_type ?? '').trim();
        if (!NAME.test(type)) return null;
        // Only a model the call names itself is visible here. A pin in the
        // agent's own file is resolved later, and no hook sees the result.
        const model = String(payload?.tool_input?.model ?? '').trim();
        return NAME.test(model) ? { skill: `agent:${type}`, via: 'auto', model } : { skill: `agent:${type}`, via: 'auto' };
      }
      if (payload?.tool_name !== 'Skill') return null;
      const raw = String(payload?.tool_input?.skill ?? payload?.tool_input?.command ?? '').trim();
      const skill = raw.replace(/^\//, '').replace(/^harness:/, '').split(/\s/)[0];
      return NAME.test(skill) ? { skill, via: 'auto' } : null;
    }
    if (event === 'UserPromptSubmit') {
      const m = String(payload?.prompt ?? '').trimStart().match(/^\/(harness:)?([a-z0-9][a-z0-9-]*)(?=\s|$)/);
      return m ? { skill: m[2], via: 'typed' } : null;
    }
    return null;
  } catch {
    return null;
  }
}

async function main() {
  try {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const hit = usage(payload);
    if (hit) {
      appendFileSync(
        join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), '.claude', 'harness-usage.log'),
        JSON.stringify({ ts: new Date().toISOString(), ...hit, session: payload?.session_id }) + '\n',
      );
    }
  } catch { /* silent */ }
  process.exit(0);
}

const invokedDirectly = (() => {
  try {
    return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();
if (invokedDirectly) main();
