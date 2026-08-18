#!/usr/bin/env node
/**
 * PreToolUse guard for mechanically-decidable risky operations.
 *
 * Contract (see ARCHITECTURE.md):
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
import { existsSync } from 'node:fs';

// ---------------------------------------------------------------- helpers

const norm = (p) => String(p ?? '').replace(/\\/g, '/');
const base = (p) => {
  const n = norm(p);
  return n.slice(n.lastIndexOf('/') + 1);
};

/** Strip one layer of surrounding quotes from a shell token. */
const unquote = (t) => t.replace(/^['"]|['"]$/g, '');

/** Split a compound shell command into independently-evaluated segments. */
function segments(command) {
  return String(command ?? '')
    .split(/&&|\|\||[;|\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
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

function checkBash(command) {
  for (const segment of segments(command)) {
    const t = tokens(segment);
    if (t.length === 0) continue;
    const hit =
      checkGitPush(t, segment) ??
      checkRm(t, segment) ??
      checkGitDiscard(t, segment) ??
      checkDeploy(t, segment);
    if (hit) return hit;
  }
  return null;
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
      const exists = tool !== 'Write' || (() => { try { return existsSync(target); } catch { return false; } })();
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

async function main() {
  let decision = null;
  try {
    const raw = await readStdin();
    decision = decide(JSON.parse(raw));
  } catch {
    process.exit(0); // unparseable payload -> allow
  }
  if (!decision) process.exit(0); // no decision -> say nothing

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
