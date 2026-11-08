#!/usr/bin/env node
/**
 * PreToolUse guard for mechanically-decidable risky operations.
 *
 * Contract (see ARCHITECTURE.md in the harness repo):
 *   deny  - things that should never happen by accident. Requires CERTAINTY.
 *   ask   - things Claude should not self-authorize, but the operator may approve.
 *   null  - no decision; exit 0 silently and say nothing.
 *
 * FAIL OPEN. Any throw, any unparseable payload, any surprise -> exit 0, allow.
 * A wedged session is worse than a missed check.
 *
 * Deny requires certainty. When a rule *might* apply but the arguments do not
 * settle it (e.g. `git push --force` with no branch named), the answer is `ask`,
 * never `deny`. Over-blocking is how a guard gets switched off within a week.
 */

import { pathToFileURL } from 'node:url';
import { existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------- helpers

const norm = (p) => String(p ?? '').replace(/\\/g, '/');
const base = (p) => {
  const n = norm(p);
  return n.slice(n.lastIndexOf('/') + 1);
};

/** Strip one layer of surrounding quotes from a shell token. */
const unquote = (t) => t.replace(/^['"]|['"]$/g, '');

/**
 * Split a shell command into the segments that run independently: on `&&`,
 * `||`, `;`, `|`, a lone `&` and newlines, outside quotes.
 *
 * What it understands, and why each one is here:
 * - Quotes. Text inside quotes is not a command, so a `.env` path in a quoted
 *   loop list is not judged as a write (sual-cavab PR #13).
 * - Comments. `#` at the start of a word runs to the end of the line, so the
 *   apostrophe in `# don't` does not open a quote that swallows every later
 *   line (sual-cavab PR #16).
 * - Heredocs. A body fed to `cat` or `node` is data and is skipped; a body
 *   fed to a shell (`bash <<EOF`) is commands and is checked.
 * - Arithmetic. `<<` inside `$(( ))` is a shift, not a heredoc.
 * - Nested commands. The string after `bash -c`, `sh -c`, `su -c`, `eval` or
 *   `ssh host` is a command too, so it is split and returned as well. So is
 *   the inside of `( )`, `{ }` and `$( )`.
 * - Keywords. `then`, `do`, `else`, `!`, `time` and friends are dropped from
 *   the front of a segment, so `then rm -rf ~` is seen as `rm -rf ~`.
 *
 * Not understood, so not checked: backtick substitutions, commands
 * assembled from variables, and scripts that do the work themselves. That
 * under-blocks, like every other undecidable case here.
 */
const SHELL = /^\s*(?:sudo\s+)?(?:[\w./-]*\/)?(?:bash|sh|zsh|dash|ksh)\b/;
const KEYWORDS = /^(?:(?:then|do|else|elif|if|while|until|time|!|\{)\s+)+/;

/**
 * Command strings handed to `bash -c`, `sh -c` or `eval` anywhere in a
 * segment, so wrappers (`wsl -d Ubuntu -- bash -lc '...'`, `docker exec web
 * sh -c "..."`) are seen. A shell word inside quotes is only text.
 */
function nestedCommands(seg) {
  let masked = ''; // quoted content blanked, quote marks kept, same length
  let q = null;
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (q) {
      if (c === '\\' && q === '"') { masked += '  '; i++; continue; }
      if (c === q) q = null;
      masked += c === q || q === null ? c : ' ';
      continue;
    }
    if (c === '\\') { masked += c + (seg[i + 1] ?? ''); i++; continue; }
    if (c === "'" || c === '"') q = c;
    masked += c;
  }
  const quoted = (at) => {
    const open = seg[at];
    let body = '';
    for (let i = at + 1; i < seg.length; i++) {
      if (seg[i] === '\\' && open === '"') { body += seg[i + 1] ?? ''; i++; continue; }
      if (seg[i] === open) break;
      body += seg[i];
    }
    return body;
  };
  const out = [];
  // Options may take a value (`-o pipefail`) before `-c`.
  const shell = /(?:^|[\s;&|(])(?:[\w./-]*\/)?(?:bash|sh|zsh|dash|ksh)\s+(?:(?:[-+]o\s+\w+|-[a-zA-Z]+)\s+)*?-[a-zA-Z]*c[a-zA-Z]*\s+(['"])/g;
  // `su [user] -c '...'` runs it as another user; `ssh host '...'` runs it remotely.
  const su = /(?:^|[\s;&|(])su\b[^'"\n]*?\s-c\s+(['"])/g;
  const ssh = /(?:^|[\s;&|(])ssh\s[^'"\n]*?(['"])/g;
  for (const re of [shell, su, ssh]) for (const m of masked.matchAll(re)) out.push(quoted(m.index + m[0].length - 1));
  for (const m of masked.matchAll(/(?:^|[\s;&|(])eval\s+/g)) {
    const at = m.index + m[0].length;
    out.push(seg[at] === '"' || seg[at] === "'" ? quoted(at) : seg.slice(at));
  }
  return out;
}

function segments(command, depth = 0) {
  const s = String(command ?? '');
  const out = [];
  let cur = '';
  let quote = null;
  let arith = 0; // open `$((` count
  let heredoc = null; // set by `<<TAG`; its body starts at the next newline
  const push = () => {
    const seg = cur.trim().replace(KEYWORDS, '');
    cur = '';
    if (!seg || seg === '}') return;
    out.push(seg);
    if (depth < 3) for (const inner of nestedCommands(seg)) out.push(...segments(inner, depth + 1));
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      // In "..." and in bash's $'...', a backslash escapes the next character.
      if (c === '\\' && (quote === '"' || quote === '$')) { cur += c + (s[i + 1] ?? ''); i++; continue; }
      if (c === (quote === '$' ? "'" : quote)) quote = null;
      cur += c;
      continue;
    }
    if (c === '\\') { cur += c + (s[i + 1] ?? ''); i++; continue; }
    if (c === "'" || c === '"') { quote = c === "'" && cur.endsWith('$') ? '$' : c; cur += c; continue; }
    if (c === '#' && (cur === '' || /[\s;&|(]$/.test(cur))) {
      while (i + 1 < s.length && s[i + 1] !== '\n') i++; // comment: skip to end of line
      continue;
    }
    if (c === '$' && s[i + 1] === '(' && s[i + 2] === '(') { arith++; cur += '$(('; i += 2; continue; }
    if (arith > 0) {
      if (c === ')' && s[i + 1] === ')') { arith--; cur += '))'; i++; continue; }
      cur += c;
      continue;
    }
    if (c === '<' && s[i + 1] === '<' && s[i + 2] !== '<') {
      const m = s.slice(i).match(/^<<(-?)\s*(['"]?)([A-Za-z_][\w-]*)\2/);
      if (m) {
        // A shell reading the heredoc runs it: leave the body to be split.
        if (!SHELL.test(cur)) heredoc = { tag: m[3], strip: m[1] === '-' };
        cur += m[0];
        i += m[0].length - 1;
        continue;
      }
    }
    if (c === '\n') {
      push();
      if (heredoc) {
        // Skip the body, up to and including the line that is exactly the tag.
        let j = i + 1;
        for (;;) {
          const end = s.indexOf('\n', j);
          const line = s.slice(j, end === -1 ? s.length : end);
          const bare = heredoc.strip ? line.replace(/^\t+/, '') : line;
          if (bare.trim() === heredoc.tag || end === -1) { i = end === -1 ? s.length : end; break; }
          j = end + 1;
        }
        heredoc = null;
      }
      continue;
    }
    if (c === ';') { push(); continue; }
    if (c === '(' || c === ')') {
      // Subshells, `$( )` and case patterns: what is inside runs on its own.
      if (c === '(' && cur.endsWith('$')) cur = cur.slice(0, -1);
      push();
      continue;
    }
    if (c === '|') {
      push();
      if (s[i + 1] === '|' || s[i + 1] === '&') i++;
      continue;
    }
    if (c === '&') {
      if (s[i + 1] === '&') { push(); i++; continue; }
      // `2>&1`, `<&3` and `&>file` redirect; they do not separate commands.
      if (cur.endsWith('>') || cur.endsWith('<') || s[i + 1] === '>') { cur += c; continue; }
      push();
      continue;
    }
    cur += c;
  }
  push();
  return out;
}
/**
 * Every segment either splitter finds: the guards are never weaker than the
 * plain split they started with.
 *
 * Two review rounds in sual-cavab (PRs #13 and #16) showed that each rule the
 * shell-aware splitter added to remove a false positive also removed blocks
 * the plain split caught by accident: heredocs piped to a shell, commands
 * passed to `ssh` or `su -c`, quotes inside `$( )`. Patching case by case kept
 * missing cases, so the guards check both and the most severe answer wins.
 * The price is the plain split's old false positives, such as a `.env` path
 * mentioned inside quotes; they were there before the shell-aware splitter.
 */
function plainSegments(command) {
  return String(command ?? '')
    .split(/&&|\|\||[;|\n]/) // exactly the baseline split: no lone &
    .map((s) => s.trim())
    .filter(Boolean);
}

function allSegments(command) {
  return [...new Set([...segments(command), ...plainSegments(command)])];
}


/** Tokenize a segment, dropping a leading `sudo` / env-var prefix. */
function tokens(segment) {
  const raw = segment.match(/(?:[^\s'"]+|'[^']*'|"[^"]*")+/g) ?? [];
  const out = raw.map(unquote);
  while (out.length && (out[0] === 'sudo' || /^[A-Z_][A-Z0-9_]*=/.test(out[0]))) out.shift();
  return out;
}

// ---------------------------------------------------------------- rule data

const PROTECTED_BRANCH = /^(main|master|develop|prod|production|release\/.+|hotfix\/.+)$/i;

// `rm -rf` targets that are regenerable and therefore not worth a prompt.
const DISPOSABLE = new Set([
  'node_modules', 'dist', 'build', 'out', 'coverage', 'target', 'vendor',
  '.next', '.nuxt', '.svelte-kit', '.turbo', '.cache', '.parcel-cache',
  '__pycache__', '.pytest_cache', '.mypy_cache', '.gradle', 'bin', 'obj',
  'tmp', 'temp', '.venv', 'venv',
]);

const NUKE_TARGET = /^(\/|\/\*|~|~\/|\$HOME|\$\{HOME\}|\/\*.*|[A-Za-z]:\/?)$/;

const DOTENV_SAFE_SUFFIX = /\.(example|sample|template|dist|defaults?|schema)$/i;
const SSH_PRIVATE_KEY = /^id_(rsa|dsa|ecdsa|ed25519|xmss)(_[\w.-]+)?$/i;

const SENSITIVE_EXT = /\.(pem|p12|pfx|keystore|jks|key)$/i;
const SENSITIVE_NAME = /^(credentials\.json|service-account.*\.json|secrets?\.ya?ml|\.netrc|\.pgpass)$/i;

const CONFIG_EXT = /\.(ya?ml|json|toml|tf|tfvars|ini|conf|cfg|properties|env|plist)$/i;
const PROD_TOKEN = /(^|[/._-])(prod|production|live)([/._-]|$)/i;

const MIGRATION_DIR = /(^|\/)(migrations?|migrate|alembic\/versions|db\/migrate|prisma\/migrations)(\/|$)/i;

// ---------------------------------------------------------------- predicates

function isDotenvSecret(b) {
  if (!/^\.env($|\.)/i.test(b)) return false;   // `environment.ts`, `env.d.ts` are not dotenv
  if (DOTENV_SAFE_SUFFIX.test(b)) return false; // `.env.example` is meant to be edited
  return true;
}

function isPrivateKeyFile(b) {
  if (b.endsWith('.pub')) return false;
  return SSH_PRIVATE_KEY.test(b);
}

function isProdConfig(path) {
  const b = base(path);
  if (!CONFIG_EXT.test(b)) return false;        // `production-planner.tsx` is source, not config
  return PROD_TOKEN.test(norm(path));
}

// ---------------------------------------------------------------- bash rules

function checkGitPush(t, segment) {
  if (t[0] !== 'git' || !t.includes('push')) return null;

  const lease = t.some((x) => x.startsWith('--force-with-lease'));
  const hardForce = t.some((x) => x === '--force' || x === '-f');
  if (!lease && !hardForce) return null;

  // Everything after `push` that isn't a flag: remote, then refspec(s).
  const after = t.slice(t.indexOf('push') + 1).filter((x) => !x.startsWith('-'));
  const refs = after.slice(1); // first positional is the remote
  const named = refs.flatMap((r) => r.split(':')).filter(Boolean);
  const hitsProtected = named.some((n) => PROTECTED_BRANCH.test(n.replace(/^refs\/heads\//, '')));

  if (named.length === 0) {
    return {
      decision: 'ask',
      rule: 'git-push-force-unknown-branch',
      reason:
        `No branch named in \`${segment}\`, so this force-pushes the *current* branch — ` +
        `which this guard cannot read from the arguments. Confirm the branch before proceeding.`,
    };
  }
  if (!hitsProtected) return null; // force-pushing a feature branch is normal work

  if (lease) {
    return {
      decision: 'ask',
      rule: 'git-push-force-with-lease-protected',
      reason:
        `\`--force-with-lease\` onto a protected branch (${named.join(', ')}). The lease ` +
        `prevents clobbering unseen commits, but this still rewrites shared history.`,
    };
  }
  return {
    decision: 'deny',
    rule: 'git-push-force-protected',
    reason:
      `Force-push to protected branch (${named.join(', ')}). This discards commits for ` +
      `everyone who has pulled. If the history really must be rewritten, a human runs it.`,
  };
}

function checkRm(t, segment) {
  if (t[0] !== 'rm') return null;
  const flags = t.filter((x) => x.startsWith('-')).join('');
  if (!(flags.includes('r') || flags.includes('R'))) return null;
  if (!flags.includes('f')) return null;

  const targets = t.slice(1).filter((x) => !x.startsWith('-'));
  if (targets.length === 0) return null;

  for (const target of targets) {
    if (NUKE_TARGET.test(norm(target))) {
      return {
        decision: 'deny',
        rule: 'rm-rf-root',
        reason: `\`rm -rf ${target}\` targets a filesystem or home root. There is no version of this that is intended.`,
      };
    }
  }

  const risky = targets.filter((x) => {
    const parts = norm(x).replace(/\/+$/, '').split('/');
    return !DISPOSABLE.has(parts[parts.length - 1]);
  });
  if (risky.length === 0) return null; // rm -rf node_modules / dist — regenerable, no prompt

  return {
    decision: 'ask',
    rule: 'rm-rf-nondisposable',
    reason: `\`rm -rf\` on ${risky.join(', ')}, which is not a regenerable build artifact.`,
  };
}

function checkGitDiscard(t, segment) {
  if (t[0] !== 'git') return null;
  const s = t.join(' ');
  const patterns = [
    [/\breset\s+(--\S+\s+)*--hard\b/, 'git reset --hard discards uncommitted work in the worktree'],
    [/\bclean\s+-\S*[dx]/, 'git clean -fd/-fdx deletes untracked files, including ones never committed'],
    [/\bcheckout\s+(--\s+)?\.\s*$/, 'git checkout . reverts every unstaged change'],
    [/\brestore\s+(--\S+\s+)*\.\s*$/, 'git restore . reverts every unstaged change'],
  ];
  for (const [re, why] of patterns) {
    if (re.test(s)) {
      return { decision: 'ask', rule: 'git-discard-worktree', reason: `${why}. Unrecoverable if it was never committed.` };
    }
  }
  return null;
}

function checkDeploy(t, segment) {
  const s = t.join(' ');
  const rules = [
    [/^terraform\s+(apply|destroy)\b/, 'terraform apply/destroy mutates real infrastructure'],
    [/^(npm|pnpm|yarn)\s+publish\b/, 'publishing to a registry is externally visible and hard to unpublish'],
    [/^docker\s+push\b/, 'pushing an image makes it externally available'],
    [/^kubectl\b.*\b(delete|apply|drain|scale)\b/, 'kubectl mutates a live cluster'],
    [/^(gh|git)\s+release\s+create\b/, 'creating a release is externally visible'],
    [/^(flyctl|fly|vercel|netlify|railway|heroku)\s+.*\b(deploy|release)\b/, 'this deploys to a hosted environment'],
  ];
  for (const [re, why] of rules) {
    if (re.test(s)) {
      return { decision: 'ask', rule: 'deploy-command', reason: `${why}: \`${segment}\`` };
    }
  }
  return null;
}

/**
 * Files a shell segment writes to.
 *
 * The write rules below decide from a path, and until now they could only be
 * reached from Write/Edit/MultiEdit. `cat > .env` and `sed -i migrations/003.sql`
 * hit exactly the same files and were not seen at all — so every rule in the
 * write section was advisory the moment work went through a shell.
 *
 * Bought by xg-tracker: two already-applied migrations were edited and the
 * `edit-applied-migration` prompt never appeared. It was read as `ask`
 * degrading to a silent allow; the hook had simply never been handed the call.
 *
 * Quoting is tracked properly, so `git commit -m "redirect output > .env"`
 * mentions a path and does not write one. Backslash escapes count too: a
 * `\"` inside double quotes does not close them, or a `=>` in quoted
 * JavaScript reads as a redirect (replaying real commands, 2026-11-08).
 */
function redirectTargets(segment) {
  const s = String(segment);
  const out = [];
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === '\\' && quote === '"') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '\\') { i++; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c !== '>') continue;

    let j = i + 1;
    if (s[j] === '>') j++;
    while (s[j] === ' ' || s[j] === '\t') j++;
    if (s[j] === '&') continue; // `>&2` duplicates a descriptor, writes no file

    let tok = '';
    let tq = null;
    for (; j < s.length; j++) {
      const d = s[j];
      if (tq) { if (d === tq) tq = null; else tok += d; continue; }
      if (d === '"' || d === "'") { tq = d; continue; }
      if (/[\s|&;<>]/.test(d)) break;
      tok += d;
    }
    if (tok) out.push(tok);
    i = j - 1;
  }
  return out;
}

/** `-i`, `-i.bak`, `-pi`, `--in-place` — an editor rewriting the file in place. */
const IN_PLACE = (x) => x === '--in-place' || /^-{1,2}[a-zA-Z]*i[\w.]*$/.test(x);

function writeTargets(t, segment) {
  const out = redirectTargets(segment);
  const cmd = base(t[0] ?? '');
  const rest = t.slice(1);
  const positional = rest.filter((x) => !x.startsWith('-'));

  if (/^(sed|perl|ruby|gawk)$/.test(cmd) && rest.some(IN_PLACE)) out.push(...positional);
  if (cmd === 'tee') out.push(...positional);
  if (/^(cp|mv|install|rsync)$/.test(cmd) && positional.length >= 2) out.push(positional[positional.length - 1]);
  if (/^(truncate|shred)$/.test(cmd)) out.push(...positional);
  if (cmd === 'dd') {
    for (const x of rest) {
      const m = x.match(/^of=(.+)$/);
      if (m) out.push(m[1]);
    }
  }
  return out.filter(Boolean);
}

function fileExists(p) {
  try { return existsSync(p); } catch { return false; }
}

/**
 * Same rules, same reasons, arrived at through Bash. The rule name carries
 * `-via-bash` so the decision log distinguishes the two routes: if this is the
 * only form that ever fires, the tool-level guard is not being reached.
 *
 * Existence is resolved against the hook's working directory. When that is
 * wrong the answer is "does not exist", which under-asks rather than
 * interrupting — the same direction every other undecidable case takes here.
 */
function checkBashWrite(t, segment) {
  // Every target, deny first: `tee config/production.json .env` asked about
  // the config file and never looked at `.env` (sual-cavab PR #13 review).
  let found = null;
  for (const target of writeTargets(t, segment)) {
    const hit = checkWrite(target, fileExists(target));
    if (!hit) continue;
    if (!found || (hit.decision === 'deny' && found.decision !== 'deny')) found = hit;
    if (found.decision === 'deny') break;
  }
  if (!found) return null;
  return {
    ...found,
    rule: `${found.rule}-via-bash`,
    reason: `${found.reason} Reached through a shell command, but it is the same file the Write guard covers.`,
  };
}

/**
 * Every segment, every rule; the most severe decision wins.
 *
 * Returning the first match let an `ask` hide a `deny` later in the same
 * command. Bought by sual-cavab: `rm -rf core/models.py ... && cp .env.example
 * .env` matched `rm-rf-nondisposable` (ask), the `.env` write was never
 * checked, the permission mode auto-approved the ask, and `.env` was written.
 */
const RULES = [checkGitPush, checkRm, checkGitDiscard, checkDeploy, checkBashWrite];

function checkBash(command) {
  let ask = null;
  for (const segment of allSegments(command)) {
    const t = tokens(segment);
    if (t.length === 0) continue;
    for (const rule of RULES) {
      const hit = rule(t, segment);
      if (!hit) continue;
      if (hit.decision === 'deny') return hit;
      ask ??= hit;
    }
  }
  return ask;
}

// ---------------------------------------------------------------- write rules

function checkWrite(filePath, alreadyExists) {
  const p = norm(filePath);
  const b = base(p);
  if (!b) return null;

  if (isDotenvSecret(b)) {
    return {
      decision: 'deny',
      rule: 'write-dotenv',
      reason:
        `\`${b}\` holds real credentials and is not tracked. Put the *key* in ` +
        `\`.env.example\` and let the operator fill in the value.`,
    };
  }
  if (isPrivateKeyFile(b)) {
    return { decision: 'deny', rule: 'write-private-key', reason: `\`${b}\` is a private key. Never machine-generated into place.` };
  }
  if (SENSITIVE_EXT.test(b) || SENSITIVE_NAME.test(b)) {
    return { decision: 'ask', rule: 'write-credential-file', reason: `\`${b}\` is a credential or certificate file.` };
  }
  // Creating a NEW migration file is not a destructive act — it is a file, and
  // `git rm` undoes it. What is destructive is *running* it, which is
  // guard-prod-ddl's job. Asking here guarded the wrong moment, and because
  // `ask` is a hard block with no operator present, it made every
  // non-interactive run build around a migration it could not create.
  //
  // CHANGING an already-written migration is different: it may already have
  // been applied somewhere, so editing it silently diverges environments.
  // That is the case worth a prompt.
  if (MIGRATION_DIR.test(p) && alreadyExists) {
    return {
      decision: 'ask',
      rule: 'edit-applied-migration',
      reason:
        `\`${p}\` already exists. If it has been applied anywhere, editing it makes environments ` +
        `diverge silently — the new file never runs where the old one already did. Add a follow-up ` +
        `migration instead, unless this one is certainly unapplied.`,
    };
  }
  if (isProdConfig(p)) {
    return { decision: 'ask', rule: 'write-prod-config', reason: `\`${p}\` looks like production configuration.` };
  }
  return null;
}

// ---------------------------------------------------------------- entry

/** Pure, exported for tests. Returns a decision object or null. */
export function decide(payload) {
  try {
    const tool = payload?.tool_name;
    const input = payload?.tool_input;
    if (!tool || !input || typeof input !== 'object') return null;

    if (tool === 'Bash') return checkBash(input.command);
    if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
      // Edit/MultiEdit always target an existing file; Write may or may not.
      const target = input.file_path ?? input.notebook_path;
      const exists = tool !== 'Write' || (typeof target === 'string' && target !== '' && fileExists(target));
      return checkWrite(target, exists);
    }
    return null;
  } catch {
    return null; // fail open
  }
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Append every non-allow decision to `.claude/harness-decisions.log`.
 *
 * `ask` has no single meaning. With an operator present it prompts; in a
 * `claude -p` run there is nobody to answer, so it is a hard block; and a
 * permission mode can resolve it before anyone sees it. Afterwards the three
 * are indistinguishable — a fired guard and a guard that never ran look the
 * same, which is how xg-tracker spent a session arguing about which had
 * happened.
 *
 * One JSON line per decision makes it checkable instead of arguable. It also
 * answers the question `harness-status` could not: is this hook live?
 *
 * Best-effort and silent. A guard that cannot write its log is still a guard,
 * so every failure here is swallowed.
 */
function record(decision, payload) {
  try {
    const input = payload?.tool_input ?? {};
    appendFileSync(
      join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), '.claude', 'harness-decisions.log'),
      JSON.stringify({
        ts: new Date().toISOString(),
        hook: 'guard-risky-ops',
        decision: decision.decision,
        rule: decision.rule,
        tool: payload?.tool_name,
        target: String(input.command ?? input.file_path ?? input.notebook_path ?? '').slice(0, 300),
        session: payload?.session_id,
        mode: payload?.permission_mode,
      }) + '\n',
    );
  } catch { /* never let logging change the decision */ }
}

async function main() {
  let decision = null;
  let payload = null;
  try {
    const raw = await readStdin();
    payload = JSON.parse(raw);
    decision = decide(payload);
  } catch {
    process.exit(0); // unparseable payload -> allow
  }
  if (!decision) process.exit(0); // no decision -> say nothing
  record(decision, payload);

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: decision.decision,
        permissionDecisionReason: `[harness:${decision.rule}] ${decision.reason}`,
      },
    }),
  );
  process.exit(0);
}

// Run main() only when executed directly, so the test file can import decide().
const invokedDirectly = (() => {
  try {
    return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();
if (invokedDirectly) main().catch(() => process.exit(0));
