/**
 * The guards may never be weaker than the release projects already run.
 *
 * `baseline/` holds the guard files exactly as harness commit 5b02f5e shipped
 * them, the version sual-cavab's staging ran during three review rounds of its
 * harness update (PR #16). `corpus.json` holds every command those rounds and
 * the fixes in between tried. Each command goes through the baseline and the
 * current guard; the current answer must be at least as strict.
 *
 * Three rounds passed hand-written tests and still failed review, because
 * "never weaker" was only claimed for the cases someone thought of. This file
 * makes it checked for every case anyone has thought of so far. A new bypass
 * goes into corpus.json, not into a one-off test.
 *
 * To move the baseline forward, copy the guards from a released commit and
 * say which in this comment. Never move it to make a failing case pass.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOOKS = path.resolve(HERE, '..', '..', 'hooks');
const corpus = JSON.parse(readFileSync(path.join(HERE, 'corpus.json'), 'utf8'));
const rank = { allow: 0, ask: 1, deny: 2 };
const decision = (d) => d?.decision ?? 'allow';
const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });


// Loaded once, up front: every guard as it is now and as the baseline shipped it.
const GUARDS = {};
for (const name of ['guard-risky-ops', 'guard-prod-ddl', 'guard-merge']) {
  GUARDS[name] = {
    now: (await import(pathToFileURL(path.join(HOOKS, `${name}.mjs`)).href)).decide,
    then: (await import(pathToFileURL(path.join(HERE, 'baseline', `${name}.mjs`)).href)).decide,
  };
}
const pair = (name) => GUARDS[name];

function weaker(name, nowDecide, thenDecide, extra) {
  const out = [];
  for (const command of corpus.commands) {
    const a = decision(thenDecide(bash(command), extra));
    const b = decision(nowDecide(bash(command), extra));
    if (rank[b] < rank[a]) out.push(`${name}: ${a} -> ${b}  ${JSON.stringify(command)}`);
  }
  return out;
}

describe('never weaker than the baseline release', () => {
  test('the corpus is real: the baseline blocks a good share of it', () => {
    const { then } = pair('guard-risky-ops');
    const blocked = corpus.commands.filter((c) => decision(then(bash(c))) !== 'allow').length;
    assert.ok(corpus.commands.length >= 90, 'corpus shrank');
    assert.ok(blocked >= 30, `only ${blocked} commands blocked by the baseline; the comparison would prove little`);
  });

  test('guard-risky-ops', () => {
    const { now, then } = pair('guard-risky-ops');
    assert.deepEqual(weaker('guard-risky-ops', now, then), []);
  });

  test('guard-prod-ddl, with and without a production DATABASE_URL', () => {
    const { now, then } = pair('guard-prod-ddl');
    for (const env of [{}, { DATABASE_URL: 'postgres://app@prod-db.acme.com:5432/app' }]) {
      assert.deepEqual(weaker('guard-prod-ddl', now, then, env), [], JSON.stringify(env));
    }
  });

  test('guard-merge, inside the loop, with gh failing outside the repo', () => {
    const { now, then } = pair('guard-merge');
    const repo = path.resolve('/work/sual-cavab');
    // Like the real gh: answers inside the repository, fails anywhere else.
    const lookup = (_args, cwd) => {
      const rel = path.relative(repo, cwd);
      if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('not a git repository');
      return { baseRefName: 'main', statusCheckRollup: [], number: 5 };
    };
    const deps = { config: { base: 'staging', protected: ['main'] }, lookup, cwd: repo, dir: repo };
    const out = [];
    for (const command of [...corpus.mergeCommands, ...corpus.commands]) {
      const a = decision(then(bash(command), deps));
      const b = decision(now(bash(command), deps));
      if (rank[b] < rank[a]) out.push(`guard-merge: ${a} -> ${b}  ${JSON.stringify(command)}`);
    }
    assert.deepEqual(out, []);
  });


});
