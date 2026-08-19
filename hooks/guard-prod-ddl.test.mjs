/**
 * Tests for the production-DDL guard.
 *
 * This guard resolves a target that mostly lives outside the command, so its
 * false-positive surface is larger than an argument-matching guard's: every
 * local migration, every read-only subcommand, and every mention of the word
 * "prod" in unrelated text is a chance to interrupt ordinary work.
 *
 * The allow block is therefore the bulk of this file, and it is the point.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { decide } from './guard-prod-ddl.mjs';

const HOOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'guard-prod-ddl.mjs');

const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });
const PROD_ENV = { DATABASE_URL: 'postgres://app:pw@prod-db.acme.com:5432/acme' };
const DEV_ENV = { DATABASE_URL: 'postgres://app:pw@localhost:5432/acme_dev' };
const STAGING_ENV = { DATABASE_URL: 'postgres://app:pw@staging-db.acme.com:5432/acme' };

function expect(command, want, env, label) {
  const got = decide(bash(command), env);
  const actual = got ? got.decision : 'allow';
  assert.equal(actual, want, `${label ?? command}\n  wanted: ${want}\n  got: ${actual}${got ? ` (${got.rule})` : ''}`);
  return got;
}

// ===========================================================================
describe('ask — migration aimed at production', () => {
  test('the incident that bought this hook: stale prod DATABASE_URL in the shell', () => {
    const got = expect('alembic upgrade head', 'ask', PROD_ENV);
    assert.equal(got.rule, 'migration-against-prod');
    assert.match(got.reason, /prod-db\.acme\.com/, 'names the host so the operator can judge');
    assert.match(got.reason, /\$DATABASE_URL/, 'names where the target came from');
  });

  test('inline assignment on the command itself', () => {
    expect('DATABASE_URL=postgres://u:p@prod-db.acme.com/acme alembic upgrade head', 'ask', {});
  });

  test('across the common migration tools', () => {
    for (const cmd of [
      'python manage.py migrate',
      'bundle exec rails db:migrate',
      'npx prisma migrate deploy',
      'npx prisma db push',
      'knex migrate:latest',
      'sequelize db:migrate',
      'dbmate up',
      'atlas migrate apply',
      'sqlx migrate run',
      'goose postgres up',
      'npm run db:migrate',
      'alembic downgrade -1',
    ]) {
      expect(cmd, 'ask', PROD_ENV);
    }
  });

  test('connection string passed as a flag rather than the environment', () => {
    expect('flyway -url=jdbc:postgresql://prod-db.acme.com/acme migrate', 'ask', {});
    expect('dbmate --url postgres://u:p@production.acme.com/app up', 'ask', {});
  });

  test('raw DDL through a database client', () => {
    const got = expect(`psql "$DATABASE_URL" -c "ALTER TABLE orders DROP COLUMN legacy_ref"`, 'ask', PROD_ENV);
    assert.equal(got.rule, 'raw-ddl-against-prod');
    expect('mysql -h prod-db.acme.com -e "DROP TABLE sessions"', 'ask', {});
  });

  test('a prod host beats a dev-looking database name', () => {
    expect('alembic upgrade head', 'ask', { DATABASE_URL: 'postgres://u@prod-db.acme.com/app_dev' });
  });
});

// ===========================================================================
// ===========================================================================
// Bought by xg-tracker. Each of these was probed and ALLOWED before the fix.
describe('ask — targets this guard used to be unable to see', () => {
  test('a hand-rolled migration runner, not a framework tool', () => {
    for (const cmd of [
      'node src/migrate.mjs',
      'node --experimental-sqlite src/migrate.mjs',
      'python scripts/migrate.py',
      'python3 db/migrate.py --yes',
      'bun run db/migrate.ts',
      'tsx db/migrate.ts',
      'ruby db/migrate.rb',
    ]) {
      const got = expect(cmd, 'ask', PROD_ENV);
      assert.equal(got.rule, 'migration-against-prod');
    }
  });

  test('a project-named database variable', () => {
    for (const [name, value] of [
      ['XG_DB_PATH', '/srv/prod/xg.db'],
      ['APP_DATABASE_URL', 'postgres://u@prod-db.acme.com/app'],
      ['SVC_DB_DSN', 'postgres://u@prod-db.acme.com/app'],
      ['ANALYTICS_DATABASE_URI', 'postgres://u@prod-db.acme.com/app'],
    ]) {
      const got = expect('npm run db:migrate', 'ask', { [name]: value }, `$${name}`);
      assert.ok(got.reason.includes('from $' + name), 'names the variable the operator has to check');
    }
  });

  test('a file-backed database named on the command line', () => {
    const got = expect('sqlite3 /srv/prod/xg.db "DROP TABLE shots_synthetic"', 'ask', {});
    assert.equal(got.rule, 'raw-ddl-against-prod');
    assert.match(got.reason, /srv\/prod\/xg\.db/, 'names the file, not a hostname parsed out of it');
    expect('sqlite3 /srv/production/app.sqlite3 "ALTER TABLE orders ADD COLUMN x INT"', 'ask', {});
    expect('duckdb /data/prod/warehouse.duckdb "DROP TABLE staging"', 'ask', {});
  });
});

// ===========================================================================
describe('allow — the false-positive suite', () => {
  test('the new patterns do not fire on local work', () => {
    expect('node src/migrate.mjs', 'allow', DEV_ENV);
    expect('node src/migrate.mjs', 'allow', {}, 'no resolvable target: the deliberate under-block still holds');
    expect('node src/migrate.mjs', 'allow', { XG_DB_PATH: './xg.db' });
    expect('sqlite3 xg.db "DROP TABLE shots_synthetic"', 'allow', {},
      'a relative path in the working directory is the local database');
    expect('sqlite3 ./data/dev.sqlite "DROP TABLE t"', 'allow', {});
    expect('sqlite3 /srv/prod/xg.db "SELECT count(*) FROM shots"', 'allow', {},
      'reading production is not DDL');
    expect('node src/premigration_check.mjs', 'allow', PROD_ENV,
      'the filename merely mentions migration');
    expect('node src/server.mjs', 'allow', PROD_ENV);
    expect('npm run migrate:status', 'ask', PROD_ENV, 'pre-existing npm behaviour is unchanged');
  });

  test('local and non-production targets', () => {
    expect('alembic upgrade head', 'allow', DEV_ENV);
    expect('alembic upgrade head', 'allow', STAGING_ENV);
    expect('npx prisma migrate dev', 'allow', DEV_ENV);
    expect('alembic upgrade head', 'allow', { DATABASE_URL: 'postgres://u@db.test.internal/app' });
    expect('alembic upgrade head', 'allow', { DATABASE_URL: 'postgres://u@127.0.0.1:5432/app' });
  });

  test('loopback stays local even when the database is a prod restore', () => {
    expect('alembic upgrade head', 'allow', { DATABASE_URL: 'postgres://u@localhost:5432/prod_mirror' },
      'a prod dump on your laptop is not production');
  });

  test('an undeterminable target does not interrupt — deliberate under-block', () => {
    expect('alembic upgrade head', 'allow', {},
      'no DATABASE_URL set: config-file default, overwhelmingly local. Asking here is how the guard gets disabled.');
    expect('python manage.py migrate', 'allow', {});
  });

  test('read-only and status subcommands', () => {
    for (const cmd of [
      'alembic current',
      'alembic history',
      'npx prisma migrate status',
      'flyway info',
      'atlas migrate status',
      'goose status',
      'dbmate status',
      'npx prisma migrate diff --from-schema-datamodel schema.prisma',
    ]) {
      expect(cmd, 'allow', PROD_ENV);
    }
  });

  test('offline SQL generation touches no database', () => {
    expect('alembic upgrade head --sql', 'allow', PROD_ENV);
    expect('npx prisma migrate deploy --dry-run', 'allow', PROD_ENV);
  });

  test('reads against production are not DDL', () => {
    expect(`psql "$DATABASE_URL" -c "SELECT count(*) FROM orders"`, 'allow', PROD_ENV);
    expect(`psql "$DATABASE_URL" -c "UPDATE orders SET x=1 WHERE id=2"`, 'allow', PROD_ENV,
      'DML is guard-risky-ops territory, not this hook');
    expect('psql "$DATABASE_URL"', 'allow', PROD_ENV);
  });

  test('the words prod and migrate inside unrelated commands', () => {
    for (const cmd of [
      'git commit -m "add migration to drop table legacy_orders on prod"',
      'echo "alembic upgrade head"',
      'cat migrations/007_alter_table_orders.sql',
      'grep -r "drop table" migrations/',
      'git log --grep="prisma migrate deploy"',
      'ls migrations/',
      'find . -name "*migrate*"',
    ]) {
      expect(cmd, 'allow', PROD_ENV);
    }
  });

  test('words that merely contain prod', () => {
    for (const url of [
      'postgres://u@reproduction-db.acme.com/app',
      'postgres://u@productivity.acme.com/app',
      'postgres://u@products-service.acme.com/app',
    ]) {
      expect('alembic upgrade head', 'allow', { DATABASE_URL: url });
    }
  });

  test('ordinary non-database commands', () => {
    for (const cmd of ['npm test', 'npm run build', 'ls -la', 'git status', 'docker compose up -d']) {
      expect(cmd, 'allow', PROD_ENV);
    }
  });

  test('tools other than Bash are not this guard concern', () => {
    assert.equal(decide({ tool_name: 'Write', tool_input: { file_path: 'migrations/1.sql' } }, PROD_ENV), null);
    assert.equal(decide({ tool_name: 'Read', tool_input: { file_path: '.env' } }, PROD_ENV), null);
  });
});

// ===========================================================================
describe('fail open', () => {
  test('malformed payloads yield no decision', () => {
    for (const p of [null, undefined, {}, 42, 'str', [],
      { tool_name: 'Bash' },
      { tool_name: 'Bash', tool_input: {} },
      { tool_name: 'Bash', tool_input: { command: '' } },
      { tool_name: 'Bash', tool_input: { command: null } },
      { tool_input: { command: 'alembic upgrade head' } },
    ]) {
      assert.equal(decide(p, PROD_ENV), null, `expected null for ${JSON.stringify(p)}`);
    }
  });
});

// ===========================================================================
describe('process contract', () => {
  function runHook(stdin, env) {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [HOOK], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env } });
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.on('close', (code) => resolve({ code, out }));
      child.stdin.end(stdin);
    });
  }

  test('the ask is recorded in the decision log', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'harness-log-ddl-'));
    mkdirSync(path.join(dir, '.claude'));
    try {
      await runHook(JSON.stringify(bash('node src/migrate.mjs')), { ...PROD_ENV, CLAUDE_PROJECT_DIR: dir });
      const entry = JSON.parse(
        readFileSync(path.join(dir, '.claude', 'harness-decisions.log'), 'utf8').trim().split('\n').at(-1),
      );
      assert.equal(entry.hook, 'guard-prod-ddl', 'names which guard fired');
      assert.equal(entry.decision, 'ask');
      assert.equal(entry.rule, 'migration-against-prod');
      assert.match(entry.target, /node src\/migrate\.mjs/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('an ask exits 0 and prints the PreToolUse envelope', async () => {
    const { code, out } = await runHook(JSON.stringify(bash('alembic upgrade head')), PROD_ENV);
    assert.equal(code, 0, 'hooks always exit 0');
    const parsed = JSON.parse(out);
    assert.equal(parsed.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.equal(parsed.hookSpecificOutput.permissionDecision, 'ask');
    assert.match(parsed.hookSpecificOutput.permissionDecisionReason, /^\[harness:migration-against-prod\]/);
  });

  test('never deny — this guard only ever asks', async () => {
    const { out } = await runHook(JSON.stringify(bash('DATABASE_URL=postgres://u@prod.acme.com/a alembic upgrade head')), {});
    assert.equal(JSON.parse(out).hookSpecificOutput.permissionDecision, 'ask');
  });

  test('no decision prints nothing', async () => {
    const { code, out } = await runHook(JSON.stringify(bash('alembic upgrade head')), DEV_ENV);
    assert.equal(code, 0);
    assert.equal(out.trim(), '');
  });

  test('unparseable stdin exits 0 silently', async () => {
    const { code, out } = await runHook('}{ not json', PROD_ENV);
    assert.equal(code, 0, 'a parse error must not wedge the session');
    assert.equal(out.trim(), '');
  });
});
