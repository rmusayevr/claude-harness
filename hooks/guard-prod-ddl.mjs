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

// ---------------------------------------------------------------- targets

/** Env vars that, in practice, carry the database a migration tool will use. */
const DB_ENV_VARS = [
  'DATABASE_URL', 'DATABASE_URI', 'DB_URL', 'DB_URI',
  'POSTGRES_URL', 'POSTGRESQL_URL', 'MYSQL_URL', 'MONGO_URL', 'MONGODB_URI',
  'PGHOST', 'MYSQL_HOST', 'DB_HOST',
];

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
];

/** Raw DDL, but only when handed to a database client. */
const DDL = /\b(alter\s+table|drop\s+(table|column|database|schema|index|constraint)|truncate\s+table|rename\s+table|create\s+(unique\s+)?index)\b/i;
const DB_CLIENT = /(^|\s)(psql|mysql|mariadb|mongosh|sqlcmd|clickhouse-client|cockroach\s+sql)\b/;

/** Offline / read-only escape hatches that must never prompt. */
const OFFLINE = /(--sql\b|--dry-run\b|--check\b|--plan\b|-n\b(?!\S))/;

// ---------------------------------------------------------------- parsing

const unquote = (t) => t.replace(/^['"]|['"]$/g, '');

function segments(command) {
  return String(command ?? '')
    .split(/&&|\|\||[;|\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
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
    if (m && DB_ENV_VARS.includes(m[1]) && m[2]) return { value: unquote(m[2]), source: `inline ${m[1]}` };
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

  // 3. Ambient environment.
  for (const name of DB_ENV_VARS) {
    const v = env?.[name];
    if (v) return { value: v, source: `$${name}` };
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

    for (const segment of segments(command)) {
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

      const host = hostOf(target.value) ?? target.value;
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

async function main() {
  let decision = null;
  try {
    decision = decide(JSON.parse(await readStdin()));
  } catch {
    process.exit(0);
  }
  if (!decision) process.exit(0);

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

const invokedDirectly = (() => {
  try {
    return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();
if (invokedDirectly) main().catch(() => process.exit(0));
