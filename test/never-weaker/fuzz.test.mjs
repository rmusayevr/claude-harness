/**
 * Generated commands, compared against the released guards.
 *
 * Four review rounds of sual-cavab PR #16 each found a command shape the
 * corpus did not have: an apostrophe in a comment, a quoted `&`, a `cd` in a
 * subshell, an escaped quote in a heredoc. A hand-written corpus only holds
 * what someone thought of. This test builds thousands of commands from the
 * pieces those bypasses were made of (quotes, escapes, heredocs, arithmetic,
 * separators, nested shells) around a write or command a guard must catch,
 * and requires every answer to be at least as strict as the release's.
 *
 * Deterministic: a fixed seed, so a failure reproduces. When it finds one,
 * add the printed command to corpus.json and fix the guard, never the seed.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOOKS = path.resolve(HERE, '..', '..', 'hooks');
const load = async (dir, name) => (await import(pathToFileURL(path.join(dir, `${name}.mjs`)).href)).decide;
const G = {};
for (const name of ['guard-risky-ops', 'guard-prod-ddl', 'guard-merge']) {
  G[name] = { now: await load(HOOKS, name), then: await load(path.join(HERE, 'baseline'), name) };
}

const rank = { allow: 0, ask: 1, deny: 2 };
const decision = (d) => d?.decision ?? 'allow';
const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });
const BS = '\\';

// mulberry32: small, fixed, reproducible.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOISE = [
  'a;b', 'a|b', 'a&b', 'a&&b', "it's", 'x' + BS + '"y', 'p' + BS + BS, '$(x)', '${#a}', '#c', 'A=1&B=2',
  '1<<2', "'", '"', '(', ')', '$((1<<2))', BS + '>', 'k=' + BS + "'v", '',
];
const PREFIX = [
  '', "cat <<'EOF' | bash\n", 'cat <<EOF | sh\n', 'ssh host <<EOF\n', 'bash <<EOF\n', 'sudo bash <<EOF\n',
  '(( n = 1 << k ))\n', 'echo $((a<<b))\n', "# it's a note\n", 'x=1; ', 'if true; then ', '( ',
  'echo "$(true)"; ', 'cd sub && ', "echo $'it" + BS + "'s'; ", 'for f in "a;b" c; do ',
];
const SUFFIX = ['', '\nEOF', '\nEOF\n', ' && echo ok', '; fi', ' )', '; done', ' & wait', ' # done'];
const TARGET = ['.env', 'id_rsa', 'config/production.json', '.env.local'];

function riskyCommand(r) {
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  const noise = () => pick(NOISE) + pick(NOISE);
  const body = pick([
    () => `echo "${noise()}" > ${pick(TARGET)}`,
    () => `printf '${noise()}' > ${pick(TARGET)}`,
    () => `echo ${noise()} >> ${pick(TARGET)}`,
    () => `cp .env.example ${pick(TARGET)}`,
    () => `tee ${pick(TARGET)} < /dev/null`,
    () => `rm -rf ~`,
    () => `git push --force origin main`,
    () => `echo "${noise()}" ; rm -rf ~`,
    () => `bash -c "echo ${noise()}; cp a ${pick(TARGET)}"`,
  ])();
  return pick(PREFIX) + (r() < 0.5 ? `echo "${noise()}"${pick(['; ', ' && ', '\n', ' | '])}` : '') + body + pick(SUFFIX);
}

function weaker(name, commands, extra) {
  const out = [];
  for (const command of commands) {
    const a = decision(G[name].then(bash(command), extra));
    const b = decision(G[name].now(bash(command), extra));
    if (rank[b] < rank[a]) out.push(`${a} -> ${b}  ${JSON.stringify(command)}`);
  }
  return out;
}

const N = 4000;

describe('fuzz: never weaker than the baseline release', () => {
  test(`guard-risky-ops, ${N} generated commands`, () => {
    const r = rng(20261108);
    const commands = Array.from({ length: N }, () => riskyCommand(r));
    const blocked = commands.filter((c) => decision(G['guard-risky-ops'].then(bash(c))) !== 'allow').length;
    assert.ok(blocked > N / 3, `only ${blocked} of ${N} blocked by the baseline; the generator stopped hitting the rules`);
    const out = weaker('guard-risky-ops', commands);
    assert.deepEqual(out.slice(0, 10), [], `${out.length} weaker`);
  });

  test(`guard-prod-ddl, ${N / 2} generated commands, with and without a prod DATABASE_URL`, () => {
    const r = rng(1108);
    const pick = (xs) => xs[Math.floor(r() * xs.length)];
    const MIG = ['python manage.py migrate', 'alembic upgrade head', 'npx prisma migrate deploy',
      'psql "$DATABASE_URL" -c "DROP TABLE x"', 'DATABASE_URL="postgres://u@prod-db/app?a=1&b=2" python manage.py migrate'];
    const commands = Array.from({ length: N / 2 }, () =>
      pick(PREFIX) + (r() < 0.5 ? `echo "${pick(NOISE)}${pick(NOISE)}"${pick(['; ', ' && ', '\n'])}` : '') + pick(MIG) + pick(SUFFIX));
    for (const env of [{}, { DATABASE_URL: 'postgres://app@prod-db.acme.com:5432/app' }]) {
      const out = weaker('guard-prod-ddl', commands, env);
      assert.deepEqual(out.slice(0, 10), [], `${out.length} weaker with ${JSON.stringify(env)}`);
    }
  });

  test(`guard-merge, ${N / 2} generated commands, gh failing outside the repo`, () => {
    const r = rng(611);
    const pick = (xs) => xs[Math.floor(r() * xs.length)];
    const repo = path.resolve('/work/sual-cavab');
    const lookup = (_args, cwd) => {
      const rel = path.relative(repo, cwd);
      if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('not a git repository');
      return { baseRefName: 'main', statusCheckRollup: [], number: 5 };
    };
    const deps = { config: { base: 'staging', protected: ['main'] }, lookup, cwd: repo, dir: repo };
    const CD = ['', 'cd .. && cd sual-cavab && ', '(cd ~ && ls) && ', 'cd frontend && cd .. && ', '(cd /tmp; ls); ',
      'cd x # note\n', "echo \"it's\" && ", 'cd .. && cd .. && cd work/sual-cavab && '];
    const ACT = ['gh pr merge 5', 'gh pr merge 5 --merge', 'git push origin staging', 'git push -u origin main'];
    const commands = Array.from({ length: N / 2 }, () => pick(PREFIX) + pick(CD) + pick(CD) + pick(ACT) + pick(SUFFIX));
    const out = [];
    for (const command of commands) {
      const a = decision(G['guard-merge'].then(bash(command), deps));
      const b = decision(G['guard-merge'].now(bash(command), deps));
      if (rank[b] < rank[a]) out.push(`${a} -> ${b}  ${JSON.stringify(command)}`);
    }
    assert.deepEqual(out.slice(0, 10), [], `${out.length} weaker`);
  });
});

// A guard that outlives its hook timeout decides nothing, which is weaker
// than a release that answered at once. sual-cavab PR #16, round 5: 400
// chained `eval`s took 22 s against a 10 s limit. Every guard must answer
// these within a second, and no weaker than the release.
describe('pathological commands: answered fast, never weaker', () => {
  const LIMIT_MS = 1000;
  const shapes = {
    'chained eval': (tail) => 'eval '.repeat(5000) + tail,
    'eval between words': (tail) => 'x eval '.repeat(2000) + tail,
    'nested bash -c': (tail) => 'bash -c '.repeat(2000) + `"${tail}"`,
    'quoted evals': (tail) => `eval "${tail}" `.repeat(2000),
    'deep subshells': (tail) => '('.repeat(5000) + tail + ')'.repeat(5000),
    'arithmetic': (tail) => '$(( 1<<2 )) '.repeat(3000) + '; ' + tail,
    'heredoc tags': (tail) => 'cat <<EOF\n'.repeat(2000) + 'EOF\n' + tail,
    'ssh and su': (tail) => `ssh h su -c 'x' `.repeat(2000) + '; ' + tail,
  };
  const guards = {
    'guard-risky-ops': ['true; rm -rf ~', undefined],
    'guard-prod-ddl': ['true; python manage.py migrate', { DATABASE_URL: 'postgres://app@prod-db.acme.com:5432/app' }],
    'guard-merge': ['true; git push origin staging', {
      config: { base: 'staging', protected: ['main'] },
      lookup: () => ({ baseRefName: 'staging', statusCheckRollup: [], number: 5 }),
      cwd: '/work/sual-cavab', dir: '/work/sual-cavab',
    }],
  };
  for (const [name, [tail, extra]] of Object.entries(guards)) {
    for (const [shape, build] of Object.entries(shapes)) {
      test(`${name}: ${shape}`, () => {
        const command = build(tail);
        const a = decision(G[name].then(bash(command), extra));
        const t = performance.now();
        const b = decision(G[name].now(bash(command), extra));
        const ms = performance.now() - t;
        assert.ok(ms < LIMIT_MS, `took ${Math.round(ms)} ms`);
        assert.ok(rank[b] >= rank[a], `${a} -> ${b}`);
      });
    }
  }
});
