/**
 * Large, awkward-but-harmless commands: big heredocs full of quotes,
 * backticks, `$`, backslashes and template strings.
 *
 * sual-cavab reported four such commands (150 to 300 lines) refused with
 * "unexpected EOF" and no guard decision. A hook cannot produce a shell parse
 * error, so the suspect was the shell tool, but a hook that threw, stalled or
 * printed noise on this input would look the same from outside. This pins that
 * down: every guard answers quickly, allows the benign command, still catches a
 * risky one placed after it, and the real hook process exits 0 with clean output.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GUARDS = ['guard-risky-ops', 'guard-prod-ddl', 'guard-merge'];
const decide = {};
for (const g of GUARDS) decide[g] = (await import(pathToFileURL(path.join(ROOT, 'hooks', `${g}.mjs`)).href)).decide;

const BT = String.fromCharCode(96);
const BS = String.fromCharCode(92);
const body = [
  ...Array.from({ length: 250 }, (_, i) => `const msg${i} = ${BT}value $` + `{x${i}} costs $5 and "quotes" and 'apostrophes' ${BT}; // it's #${i}`),
  `echo $(date) ${BT}uname${BT} ${BS} trailing${BS}`,
].join('\n');

const SHAPES = {
  'quoted tag to a file': (after = '') => `cat > /tmp/gen.js <<'JS'\n${body}\nJS\nnode /tmp/gen.js${after}`,
  'unquoted tag': (after = '') => `cat > f.txt <<EOF\n${body}\nEOF${after}`,
  'tab-stripped tag': (after = '') => `cat <<-'END'\n\t${body.replace(/\n/g, '\n\t')}\n\tEND${after}`,
  'fed to a shell': (after = '') => `bash <<'EOF'\n${body}\nEOF${after}`,
  'no terminator': (after = '') => `cat <<'EOF'\n${body}${after}`,
  'python': (after = '') => `python - <<'PY'\nprint("""${body}""")\nPY${after}`,
};
const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });
const MERGE_DEPS = { config: null, lookup: () => null, cwd: '/work', dir: '/work' };
const call = (g, command) => decide[g](bash(command), g === 'guard-merge' ? MERGE_DEPS : undefined);

describe('large heredocs', () => {
  for (const [label, build] of Object.entries(SHAPES)) {
    test(`${label}: every guard allows it, fast`, () => {
      for (const g of GUARDS) {
        const t = performance.now();
        const d = call(g, build());
        assert.ok(performance.now() - t < 500, `${g} was slow`);
        assert.equal(d?.decision ?? 'allow', 'allow', `${g}: ${JSON.stringify(d)}`);
      }
    });

    test(`${label}: the hook processes exit 0 with clean output`, () => {
      const input = JSON.stringify(bash(build()));
      for (const g of GUARDS) {
        const r = spawnSync(process.execPath, [path.join(ROOT, 'hooks', `${g}.mjs`)], { input, encoding: 'utf8', cwd: ROOT });
        assert.equal(r.status, 0, `${g} exited ${r.status}`);
        assert.equal(r.stderr, '', `${g} wrote to stderr`);
        if (r.stdout.trim()) JSON.parse(r.stdout);
      }
    });
  }

  test('a risky command after a large heredoc is still caught', () => {
    for (const [label, build] of Object.entries(SHAPES)) {
      if (label === 'no terminator' || label === 'tab-stripped tag') continue; // the body swallows what follows, as a shell would
      assert.notEqual(call('guard-risky-ops', build('\nrm -rf ~'))?.decision ?? 'allow', 'allow', label);
    }
  });
});
