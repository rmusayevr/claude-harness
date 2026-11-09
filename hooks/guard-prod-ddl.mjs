#!/usr/bin/env node
/**
 * PreToolUse guard: migrations and DDL aimed at a production database.
 *
 * Bought by a real incident — a migration run against prod because DATABASE_URL
 * was still pointing there from an earlier shell, dropping a column and costing
 * a restore from a six-hour-old snapshot.
 *
 * This guard has a different shape to guard-risky-ops. That one decides from the
 * command's own arguments. This one has to resolve a TARGET that mostly lives
 * outside the command: an inline assignment, a flag, or the ambient environment.
 *
 * Decision: `ask`, never `deny`. Running a migration against production is
 * legitimate and routine during a deploy. The failure mode was doing it
 * *unintentionally*, and one confirmation naming the host prevents that without
 * blocking the legitimate case.
 *
 * DELIBERATE UNDER-BLOCK: when the target cannot be determined, this allows
 * silently. The proposal that produced this hook said "unset -> ask", which
 * would fire on every local `alembic upgrade head` run against a config-file
 * default — and a guard that interrupts ordinary local work gets switched off
 * within a week, at which point it protects nothing. The incident case had
 * DATABASE_URL *set* to prod, which is exactly what this still catches.
 *
 * FAIL OPEN, like every hook here: any throw exits 0 and allows.
 */
import { pathToFileURL } from 'node:url';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------- targets

/** Env vars that, in practice, carry the database a migration tool will use. */
const DB_ENV_VARS = [
  'DATABASE_URL', 'DATABASE_URI', 'DB_URL', 'DB_URI',
  'POSTGRES_URL', 'POSTGRESQL_URL', 'MYSQL_URL', 'MONGO_URL', 'MONGODB_URI',
  'PGHOST', 'MYSQL_HOST', 'DB_HOST',
  'DATABASE_PATH', 'DB_PATH', 'SQLITE_PATH', 'DATABASE_FILE', 'DB_FILE',
];

/**
 * Projects name their own: XG_DB_PATH, APP_DATABASE_URL, SVC_DB_DSN. A fixed
 * list only ever covers the tools someone already thought of, and the variable
 * a project actually uses is the one the guard most needs to read.
 *
 * Bought by xg-tracker: XG_DB_PATH was the only variable selecting that
 * project's database, and the guard could not see it.
 */
const DB_ENV_SHAPE = /(^|_)(DB|DATABASE)_(URL|URI|PATH|FILE|DSN|HOST|NAME)$/;

const isDbEnvVar = (name) => DB_ENV_VARS.includes(name) || DB_ENV_SHAPE.test(name);

const LOOPBACK = /^(localhost|127(\.\d+){3}|0\.0\.0\.0|\[?::1\]?|host\.docker\.internal)$/i;

// Word-boundaried so "reproduction" and "productivity" do not match.
const PROD = /(^|[^a-z0-9])(prod|prd|production|live)([^a-z0-9]|$)/i;

const NONPROD =
  /(^|[^a-z0-9])(dev|devel|development|local|staging|stage|test|testing|qa|uat|sandbox|preview|demo|ci|scratch)([^a-z0-9]|$)/i;

/** Pull the host out of a connection string, if there is one. */
function hostOf(target) {
  const s = String(target);
  // scheme://[user[:pass]@]host[:port][/db]  — also jdbc:postgresql://host/db
  const m = s.match(/(?:^|:)\/\/(?:[^@/\s]*@)?\[?([^\]:/?\s]+)\]?/);
  if (m) return m[1];
  // bare host from -h / --host
  if (/^[\w.-]+$/.test(s)) return s;
  return null;
}

/** A file-backed database (SQLite and friends) has a path, not a host. */
const DB_FILE = /\.(db|db3|sqlite|sqlite3|duckdb)$/i;

// ---------------------------------------------------------------- commands

/**
 * Commands that APPLY a schema change. Read-only and offline subcommands
 * (status, current, info, diff, --sql) are deliberately absent.
 */
const MIGRATION_CMDS = [
  /(^|\s)alembic\b[^|]*\s(upgrade|downgrade|stamp)\b/,
  /manage\.py\s+migrate\b/,
  /(^|\s)(bundle\s+exec\s+)?rails?\s+db:(migrate|rollback|schema:load|structure:load)\b/,
  /(^|\s)(npx\s+|pnpm\s+|yarn\s+)?prisma\s+migrate\s+(deploy|dev|reset)\b/,
  /(^|\s)(npx\s+|pnpm\s+|yarn\s+)?prisma\s+db\s+push\b/,
  /(^|\s)flyway\b[^|]*\s(migrate|clean|undo|baseline|repair)\b/,
  /(^|\s)liquibase\b[^|]*\s(update|rollback|dropAll)\b/,
  /(^|\s)(npx\s+)?knex\b[^|]*\smigrate:(latest|up|down|rollback)\b/,
  /(^|\s)(npx\s+)?sequelize(-cli)?\b[^|]*\sdb:migrate(:undo)?\b/,
  /(^|\s)goose\s+[^|]*\b(up|down|reset|redo)\b/,
  /(^|\s)dbmate\b[^|]*\s(up|down|migrate|rollback)\b/,
  /(^|\s)atlas\s+migrate\b[^|]*\sapply\b/,
  /(^|\s)sqlx\s+migrate\b[^|]*\s(run|revert)\b/,
  /(^|\s)(npx\s+)?drizzle-kit\s+(push|migrate)\b/,
  /(^|\s)(npm|pnpm|yarn)\s+run\s+[\w:-]*migrat/i,
  /(^|\s)tern\s+migrate\b/,
  // A hand-rolled runner: `node src/migrate.mjs`, `python scripts/migrate.py`,
  // `bun run db/migrate.ts`. Every project that outgrows a framework's tool
  // writes one, and it applies exactly the same schema change.
  //
  // Bought by xg-tracker: `npm run db:migrate` matched and prompted, while
  // `node src/migrate.mjs` — the same migration, and the form that project was
  // actually using because `npm run` was blocked — did not.
  //
  // The script's own FILENAME must start with `migrat` — `src/migrate.mjs`, not
  // `src/premigration_check.py`, which merely mentions it.
  //
  // ACCEPTED FALSE POSITIVE: a read-only subcommand of such a script
  // (`node src/migrate.mjs status`) prompts, because nothing in the arguments
  // distinguishes it from an apply. One confirmation is cheaper than the miss,
  // and `--dry-run` / `--check` still leave through OFFLINE below.
  /(^|\s)(node|nodejs|python3?|deno|bun|tsx|ts-node|ruby|php)\s+(?:(?:run|exec)\s+)?(?:-{1,2}[\w-]+(?:=\S+)?\s+)*(?:\S*[\\/])?migrat\S*/i,
];

/** Raw DDL, but only when handed to a database client. */
const DDL = /\b(alter\s+table|drop\s+(table|column|database|schema|index|constraint)|truncate\s+table|rename\s+table|create\s+(unique\s+)?index)\b/i;
const DB_CLIENT = /(^|\s)(psql|mysql|mariadb|mongosh|sqlcmd|clickhouse-client|cockroach\s+sql|sqlite3?|litecli|duckdb)\b/;

/** Offline / read-only escape hatches that must never prompt. */
const OFFLINE = /(--sql\b|--dry-run\b|--check\b|--plan\b|-n\b(?!\S))/;

// ---------------------------------------------------------------- parsing

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
    if (seg[at] === '"' || seg[at] === "'") { out.push(quoted(at)); continue; }
    // An unquoted eval runs the rest of the segment. Any later eval is inside
    // that rest and is found when it is split, so stop here: pushing every
    // suffix made `eval eval eval ...` grow as n^depth (sual-cavab PR #16,
    // round 5: 400 evals took 22 s against a 10 s hook timeout).
    out.push(seg.slice(at).replace(/^(?:eval\s+)+/, ''));
    break;
  }
  return out;
}

// Most segments the shell-aware split may produce. Past it, nested strings are
// not expanded further. That is never weaker than the release: the plain split
// is checked as well and does not expand them at all.
const MAX_SEGMENTS = 2000;

function segments(command, depth = 0, budget = { left: MAX_SEGMENTS }) {
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
    if (--budget.left <= 0 || depth >= 3) return;
    for (const inner of nestedCommands(seg)) {
      if (budget.left <= 0) break;
      for (const x of segments(inner, depth + 1, budget)) out.push(x);
    }
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


function tokens(segment) {
  return (segment.match(/(?:[^\s'"]+|'[^']*'|"[^"]*")+/g) ?? []).map(unquote);
}

/**
 * Resolve the database this segment will talk to.
 * Priority: inline assignment > explicit flag > ambient environment.
 * Returns {value, source} or null when undeterminable.
 */
function resolveTarget(segment, env) {
  const raw = segment.match(/(?:[^\s'"]+|'[^']*'|"[^"]*")+/g) ?? [];

  // 1. Inline: DATABASE_URL=... command
  for (const tok of raw) {
    const m = tok.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && isDbEnvVar(m[1]) && m[2]) return { value: unquote(m[2]), source: `inline ${m[1]}` };
  }

  // 2. Explicit flag or positional connection string.
  const joined = raw.map(unquote).join(' ');
  const flag = joined.match(/(?:--(?:database-)?url|--dsn|--conn(?:ection)?(?:-string)?)[= ]([^\s]+)/i);
  if (flag) return { value: flag[1], source: 'command flag' };
  const jdbc = joined.match(/(jdbc:[\w:]+:\/\/[^\s]+)/i);
  if (jdbc) return { value: jdbc[1], source: 'command flag' };
  const bare = joined.match(/((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|mariadb):\/\/[^\s]+)/i);
  if (bare) return { value: bare[1], source: 'command argument' };
  const hostFlag = joined.match(/(?:^|\s)(?:-h|--host)[= ]([\w.-]+)/);
  if (hostFlag) return { value: hostFlag[1], source: '--host' };

  // 2b. A database FILE given positionally: `sqlite3 /srv/prod/app.db "..."`.
  //     Flags and the command word itself are skipped.
  for (const tok of raw.map(unquote).slice(1)) {
    if (!tok.startsWith('-') && DB_FILE.test(tok)) return { value: tok, source: 'database file' };
  }

  // 3. Ambient environment. The named list first, so its `source` label is the
  //    familiar one, then anything else shaped like a database variable.
  for (const name of DB_ENV_VARS) {
    const v = env?.[name];
    if (v) return { value: v, source: `$${name}` };
  }
  for (const [name, v] of Object.entries(env ?? {})) {
    if (v && DB_ENV_SHAPE.test(name)) return { value: v, source: `$${name}` };
  }
  return null;
}

/** Classify a resolved target. */
function classify(value) {
  const host = hostOf(value);
  if (host && LOOPBACK.test(host)) return 'local';
  // A prod marker anywhere in the connection string wins: a host named
  // prod-db with database "app_dev" is still production.
  if (PROD.test(value)) return 'prod';
  if (NONPROD.test(value)) return 'nonprod';
  return 'unknown';
}

// ---------------------------------------------------------------- decide

/** Pure. Exported for tests. Returns a decision object or null. */
export function decide(payload, env = process.env) {
  try {
    if (payload?.tool_name !== 'Bash') return null;
    const command = payload?.tool_input?.command;
    if (typeof command !== 'string' || !command.trim()) return null;

    for (const segment of allSegments(command)) {
      const t = tokens(segment);
      if (t.length === 0) continue;

      // A quoted mention inside an unrelated command is not an invocation.
      const head = t.find((x) => !/^[A-Z_][A-Z0-9_]*=/.test(x)) ?? '';
      if (/^(echo|printf|cat|grep|rg|git|less|head|tail|awk|sed|find)$/.test(head)) continue;

      const isMigration = MIGRATION_CMDS.some((re) => re.test(segment));
      const isRawDdl = DB_CLIENT.test(segment) && DDL.test(segment);
      if (!isMigration && !isRawDdl) continue;
      if (OFFLINE.test(segment)) continue; // generates SQL, touches nothing

      const target = resolveTarget(segment, env);
      if (!target) continue; // undeterminable -> allow, deliberately (see header)

      if (classify(target.value) !== 'prod') continue;

      const host = (DB_FILE.test(target.value) ? null : hostOf(target.value)) ?? target.value;
      return {
        decision: 'ask',
        rule: isRawDdl ? 'raw-ddl-against-prod' : 'migration-against-prod',
        reason:
          `This ${isRawDdl ? 'DDL statement' : 'migration'} targets what looks like production ` +
          `(${host}, from ${target.source}). Migrations are one-way and the down path is often ` +
          `untested. Confirm the target is intended before it runs.`,
      };
    }
    return null;
  } catch {
    return null; // fail open
  }
}

// ---------------------------------------------------------------- entry

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Append every non-allow decision to `.claude/harness-decisions.log`.
 * Same contract as the copy in guard-risky-ops, and deliberately a copy: the
 * hooks are installed as independent files, so a shared module would be one
 * more thing that can be missing. See that file for the reasoning.
 */
function record(decision, payload) {
  try {
    appendFileSync(
      join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), '.claude', 'harness-decisions.log'),
      JSON.stringify({
        ts: new Date().toISOString(),
        hook: 'guard-prod-ddl',
        decision: decision.decision,
        rule: decision.rule,
        tool: payload?.tool_name,
        target: String(payload?.tool_input?.command ?? '').slice(0, 300),
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
    payload = JSON.parse(await readStdin());
    decision = decide(payload);
  } catch {
    process.exit(0);
  }
  if (!decision) process.exit(0);
  record(decision, payload);

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: decision.decision,
        // An ask names the skill with the procedure, at the moment it matters.
        permissionDecisionReason: `[harness:${decision.rule}] ${decision.reason}${decision.decision === 'ask' ? ' Load the `migrate-data` skill before going on.' : ''}`,
      },
    }),
  );
  process.exit(0);
}

const invokedDirectly = (() => {
  try {
    return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();
if (invokedDirectly) main().catch(() => process.exit(0));
