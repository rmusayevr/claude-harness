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
describe('allow — the false-positive suite', () => {
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
