/**
 * Tests for the risky-ops PreToolUse guard.
 *
 * The ALLOW blocks are the point of this file. A guard that blocks the right
 * things but also blocks ordinary work gets disabled within a week, and a
 * disabled guard enforces nothing. False-positive coverage is not optional here.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { decide } from './guard-risky-ops.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.resolve(HERE, 'guard-risky-ops.mjs');

const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });
const write = (file_path) => ({ tool_name: 'Write', tool_input: { file_path } });
const edit = (file_path) => ({ tool_name: 'Edit', tool_input: { file_path } });

/** Assert a payload yields a given decision, reporting the rule that fired. */
function expect(payload, want, label) {
  const got = decide(payload);
  const actual = got ? got.decision : 'allow';
  assert.equal(actual, want, `${label}\n  wanted: ${want}\n  got:    ${actual}${got ? ` (${got.rule})` : ''}`);
  return got;
}

// ===========================================================================
// DENY - never by accident
// ===========================================================================

describe('deny', () => {
  test('force-push to protected branches', () => {
    for (const cmd of [
      'git push --force origin main',
      'git push -f origin master',
      'git push --force origin develop',
      'git push --force origin release/2.1',
      'git push --force upstream HEAD:main',
      'git push -f origin feature/x:main',
    ]) {
      expect(bash(cmd), 'deny', cmd);
    }
  });

  test('filesystem and home-root deletion', () => {
    for (const cmd of ['rm -rf /', 'rm -rf ~', 'rm -rf $HOME', 'sudo rm -rf /', 'rm -fr /*']) {
      expect(bash(cmd), 'deny', cmd);
    }
  });

  test('writing real dotenv files', () => {
    for (const p of ['.env', '.env.local', '.env.production', 'apps/api/.env', 'C:\\proj\\.env.staging']) {
      expect(write(p), 'deny', p);
    }
  });

  test('writing private keys', () => {
    for (const p of ['~/.ssh/id_rsa', 'keys/id_ed25519', 'id_ecdsa_deploy']) {
      expect(write(p), 'deny', p);
    }
  });
});

// ===========================================================================
// ASK - Claude should not self-authorize, operator may approve
// ===========================================================================

describe('ask', () => {
  test('force-push with no branch named is undecidable, so it asks rather than denies', () => {
    const got = expect(bash('git push --force'), 'ask', 'bare force push');
    assert.equal(got.rule, 'git-push-force-unknown-branch');
  });

  test('--force-with-lease onto main asks instead of denying', () => {
    const got = expect(bash('git push --force-with-lease origin main'), 'ask', 'lease onto main');
    assert.equal(got.rule, 'git-push-force-with-lease-protected');
  });

  test('discarding worktree state', () => {
    for (const cmd of [
      'git reset --hard',
      'git reset --hard HEAD~3',
      'git clean -fdx',
      'git clean -fd',
      'git checkout -- .',
      'git checkout .',
      'git restore .',
    ]) {
      expect(bash(cmd), 'ask', cmd);
    }
  });

  test('rm -rf on non-regenerable paths', () => {
    for (const cmd of ['rm -rf src', 'rm -rf ./migrations', 'rm -rf uploads/']) {
      expect(bash(cmd), 'ask', cmd);
    }
  });

  test('deploy and publish commands', () => {
    for (const cmd of [
      'terraform apply',
      'terraform destroy -auto-approve',
      'npm publish',
      'pnpm publish --access public',
      'docker push registry.io/app:latest',
      'kubectl delete pod api-7f9',
      'vercel deploy --prod',
    ]) {
      expect(bash(cmd), 'ask', cmd);
    }
  });

  test('migrations, prod config, and credential files', () => {
    expect(write('db/migrations/0007_add_index.sql'), 'ask', 'migration');
    expect(write('prisma/migrations/20240101_init/migration.sql'), 'ask', 'prisma migration');
    expect(write('config/production.yml'), 'ask', 'prod config');
    expect(write('deploy/prod.tfvars'), 'ask', 'prod tfvars');
    expect(write('certs/server.pem'), 'ask', 'pem');
    expect(write('credentials.json'), 'ask', 'credentials');
    expect(write('secrets.yaml'), 'ask', 'secrets yaml');
  });
});

// ===========================================================================
// ALLOW - the false-positive suite. These are ordinary work.
// ===========================================================================

describe('allow (false-positive guard)', () => {
  test('force-pushing a feature branch is normal work', () => {
    for (const cmd of [
      'git push --force origin feature/new-parser',
      'git push -f origin fix/CS-102',
      'git push --force-with-lease origin feature/x',
      'git push origin main',
      'git push --set-upstream origin feature/y',
    ]) {
      expect(bash(cmd), 'allow', cmd);
    }
  });

  test('rm -rf on regenerable build output does not prompt', () => {
    for (const cmd of [
      'rm -rf node_modules',
      'rm -rf dist && npm run build',
      'rm -rf .next',
      'rm -rf coverage/',
      'rm -rf apps/web/node_modules',
      'rm -rf __pycache__',
      'rm file.txt',
      'rm -r somedir',
    ]) {
      expect(bash(cmd), 'allow', cmd);
    }
  });

  test('risky strings quoted inside an unrelated command are not commands', () => {
    for (const cmd of [
      'grep -r "reset --hard" .',
      'echo "rm -rf /"',
      'git commit -m "fix: guard against rm -rf regression"',
      'git log --grep="force push"',
      'cat docs/git-push---force.md',
    ]) {
      expect(bash(cmd), 'allow', cmd);
    }
  });

  test('read-only and plan-only commands', () => {
    for (const cmd of [
      'terraform plan',
      'kubectl get pods',
      'kubectl describe deployment api',
      'npm run build',
      'docker build -t app .',
      'git status',
      'git fetch --all',
    ]) {
      expect(bash(cmd), 'allow', cmd);
    }
  });

  test('files that merely look like secrets', () => {
    for (const p of [
      '.env.example',
      '.env.template',
      '.env.local.example',
      '.env.sample',
      'src/environment.ts',
      'src/env.d.ts',
      'docs/environments.md',
      'app/config/env-loader.ts',
      'keys/id_rsa.pub',
      'test/fixtures/envelope.json',
    ]) {
      expect(write(p), 'allow', p);
    }
  });

  test('source files that merely contain the word prod', () => {
    for (const p of [
      'src/products/product-list.ts',
      'app/production-planner.tsx',
      'src/reproduce.ts',
      'lib/productivity.js',
      'components/ProductCard.tsx',
    ]) {
      expect(edit(p), 'allow', p);
    }
  });

  test('ordinary source and config edits', () => {
    for (const p of [
      'src/index.ts',
      'package.json',
      'tsconfig.json',
      'config/development.yml',
      'README.md',
      'db/models/user.ts',
    ]) {
      expect(edit(p), 'allow', p);
    }
  });

  test('tools the guard has no opinion about', () => {
    expect({ tool_name: 'Read', tool_input: { file_path: '.env' } }, 'allow', 'reading .env is not writing it');
    expect({ tool_name: 'Grep', tool_input: { pattern: 'rm -rf' } }, 'allow', 'grep');
  });
});

// ===========================================================================
// FAIL OPEN
// ===========================================================================

describe('fail open', () => {
  test('malformed and hostile payloads yield no decision', () => {
    for (const p of [
      null, undefined, {}, 42, 'string', [],
      { tool_name: 'Bash' },
      { tool_name: 'Bash', tool_input: null },
      { tool_name: 'Bash', tool_input: 'not-an-object' },
      { tool_name: 'Bash', tool_input: {} },
      { tool_name: 'Write', tool_input: { file_path: '' } },
      { tool_name: 'Write', tool_input: { file_path: null } },
      { tool_input: { command: 'rm -rf /' } }, // no tool_name
    ]) {
      assert.equal(decide(p), null, `expected null for ${JSON.stringify(p)}`);
    }
  });
});

// ===========================================================================
// PROCESS CONTRACT - exit codes and stdout shape
// ===========================================================================

function runHook(stdin) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [HOOK], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => resolve({ code, out, err }));
    child.stdin.end(stdin);
  });
}

describe('process contract', () => {
  test('a deny exits 0 and prints the PreToolUse decision envelope', async () => {
    const { code, out } = await runHook(JSON.stringify(bash('git push --force origin main')));
    assert.equal(code, 0, 'hooks always exit 0');
    const parsed = JSON.parse(out);
    assert.equal(parsed.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.equal(parsed.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(parsed.hookSpecificOutput.permissionDecisionReason, /^\[harness:git-push-force-protected\]/);
  });

  test('an ask exits 0 with permissionDecision ask', async () => {
    const { code, out } = await runHook(JSON.stringify(bash('terraform apply')));
    assert.equal(code, 0);
    assert.equal(JSON.parse(out).hookSpecificOutput.permissionDecision, 'ask');
  });

  test('no decision exits 0 and prints nothing', async () => {
    const { code, out } = await runHook(JSON.stringify(bash('npm test')));
    assert.equal(code, 0);
    assert.equal(out.trim(), '');
  });

  test('unparseable stdin exits 0 and prints nothing', async () => {
    const { code, out } = await runHook('}{ not json');
    assert.equal(code, 0, 'a parse error must not wedge the session');
    assert.equal(out.trim(), '');
  });

  test('empty stdin exits 0', async () => {
    const { code, out } = await runHook('');
    assert.equal(code, 0);
    assert.equal(out.trim(), '');
  });
});
