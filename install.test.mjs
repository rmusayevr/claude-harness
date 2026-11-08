/**
 * Tests for the installer.
 *
 * install.mjs mutates someone's project: it writes files, edits their
 * settings.json, and appends to their CLAUDE.md. The failure modes that matter
 * are all destructive — clobbering a local edit, leaving an orphan behind,
 * half-installing and then failing. Those are what this asserts.
 *
 * Every case runs the real CLI against a real temp directory. There are no
 * mocks, because the thing under test IS the filesystem effect.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, rmSync, readdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INSTALL = path.join(HERE, 'install.mjs');
let proj;

beforeEach(() => {
  proj = mkdtempSync(path.join(tmpdir(), 'harness-install-'));
  writeFileSync(path.join(proj, 'main.py'), 'print(1)\n');
});

const run = (...args) => {
  const r = spawnSync(process.execPath, [INSTALL, ...args, '--target', proj], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
};
const p = (rel) => path.join(proj, rel);
const read = (rel) => readFileSync(p(rel), 'utf8');
const manifest = () => JSON.parse(read('.claude/harness-manifest.json'));
const skillNames = () => readdirSync(p('.claude/skills')).sort();
const EDIT = '\n<!-- my local tweak -->\n';

// ===========================================================================
// A copy of the harness itself, so a test can change what "upstream" says.
function makeSource() {
  const src = mkdtempSync(path.join(tmpdir(), 'harness-src-'));
  for (const e of ['install.mjs', 'skills', 'agents', 'hooks', 'scripts', 'templates', 'rules', '.claude-plugin', 'package.json'])
    cpSync(path.join(HERE, e), path.join(src, e), { recursive: true });
  return src;
}

describe('profiles', () => {
  test('core installs no stack packs', () => {
    assert.equal(run('install', '--profile', 'core').code, 0);
    const names = skillNames();
    assert.ok(names.includes('reproduce-first'), 'core skills present');
    assert.ok(!names.includes('stateful-markers'), 'backend pack must NOT be installed');
    assert.ok(!names.includes('loading-and-empty'), 'frontend pack must NOT be installed');
  });

  test('backend adds only the backend pack', () => {
    run('install', '--profile', 'backend');
    const names = skillNames();
    assert.ok(names.includes('stateful-markers'));
    assert.ok(!names.includes('loading-and-empty'));
  });

  test('full adds both packs', () => {
    run('install', '--profile', 'full');
    const names = skillNames();
    assert.ok(names.includes('stateful-markers'));
    assert.ok(names.includes('loading-and-empty'));
  });

  test('switching profile removes packs the new profile does not include', () => {
    run('install', '--profile', 'backend');
    assert.ok(skillNames().includes('stateful-markers'));
    const r = run('install', '--profile', 'frontend');
    assert.match(r.out, /removed 1 file/);
    assert.ok(!skillNames().includes('stateful-markers'), 'old pack removed');
    assert.ok(skillNames().includes('loading-and-empty'), 'new pack added');
  });

  test('an unknown profile is refused before anything is written', () => {
    const r = run('install', '--profile', 'nonsense');
    assert.equal(r.code, 1);
    assert.match(r.err, /Unknown profile/);
    assert.ok(!existsSync(p('.claude')), 'nothing written');
  });

  test('hooks are installed without the harness’s own test files', () => {
    run('install', '--profile', 'core');
    const hooks = readdirSync(p('.claude/hooks')).sort();
    assert.ok(hooks.includes('guard-risky-ops.mjs'), 'guards present');
    assert.deepEqual(hooks.filter((f) => f.endsWith('.test.mjs')), [], 'no test files copied into the project');
  });
});

// ===========================================================================
describe('CLAUDE.md is never overwritten', () => {
  test('an existing CLAUDE.md keeps every line the user wrote', () => {
    writeFileSync(p('CLAUDE.md'), '# Acme\n\nWe use pnpm, not npm.\nAsk before touching infra/.\n');
    const r = run('install');
    const after = read('CLAUDE.md');
    assert.match(r.out, /appended a marked harness block/);
    assert.ok(after.startsWith('# Acme'), 'user content still leads the file');
    assert.match(after, /We use pnpm, not npm\./);
    assert.match(after, /Ask before touching infra\//);
    assert.match(after, /<!-- BEGIN harness/);
  });

  test('CLAUDE.md is created when absent', () => {
    const r = run('install');
    assert.match(r.out, /created CLAUDE\.md/);
    assert.match(read('CLAUDE.md'), /<!-- BEGIN harness/);
  });

  test('--claude-md skip leaves the file entirely alone', () => {
    writeFileSync(p('CLAUDE.md'), 'mine\n');
    run('install', '--claude-md', 'skip');
    assert.equal(read('CLAUDE.md'), 'mine\n');
  });

  test('--claude-md sidecar writes alongside and says it is not auto-loaded', () => {
    writeFileSync(p('CLAUDE.md'), 'mine\n');
    const r = run('install', '--claude-md', 'sidecar');
    assert.equal(read('CLAUDE.md'), 'mine\n', 'original untouched');
    assert.ok(existsSync(p('CLAUDE.harness.md')));
    assert.match(r.out, /NOT loaded automatically/);
    assert.match(r.out, /@CLAUDE\.harness\.md/);
  });

  test('reinstalling does not stack a second harness block', () => {
    writeFileSync(p('CLAUDE.md'), '# Acme\n');
    run('install');
    run('install');
    assert.equal((read('CLAUDE.md').match(/<!-- BEGIN harness/g) ?? []).length, 1);
  });

  test('an edited harness block is not silently replaced', () => {
    run('install');
    writeFileSync(p('CLAUDE.md'), read('CLAUDE.md').replace('## Working agreement', '## My rules'));
    const r = run('install');
    assert.match(r.out, /skipped[\s\S]*CLAUDE\.md harness block/);
    assert.match(read('CLAUDE.md'), /## My rules/, 'my edit survived');
  });
});

// ===========================================================================
describe('settings.json', () => {
  test('unrelated settings and other hooks survive the merge', () => {
    mkdirSync(p('.claude'), { recursive: true });
    writeFileSync(p('.claude/settings.json'), JSON.stringify({
      env: { ACME_REGION: 'eu-west-1' },
      hooks: { PostToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'echo mine' }] }] },
    }, null, 2));
    run('install');
    const s = JSON.parse(read('.claude/settings.json'));
    assert.equal(s.env.ACME_REGION, 'eu-west-1');
    assert.equal(s.hooks.PostToolUse[0].hooks[0].command, 'echo mine');
    assert.equal(s.hooks.PreToolUse.length, 3, 'the guard groups and the usage recorder added');
    assert.equal(s.hooks.UserPromptSubmit.length, 1, 'usage recorder on typed slash commands');
  });

  test('a settings.json with a UTF-8 BOM is read, not rejected', () => {
    mkdirSync(p('.claude'), { recursive: true });
    writeFileSync(p('.claude/settings.json'), '﻿' + JSON.stringify({ env: { A: '1' } }));
    const r = run('install');
    assert.equal(r.code, 0, 'PowerShell writes BOMs; a project config must still be readable');
    assert.equal(JSON.parse(read('.claude/settings.json')).env.A, '1');
  });

  test('unparseable settings.json fails BEFORE any file is written', () => {
    mkdirSync(p('.claude'), { recursive: true });
    writeFileSync(p('.claude/settings.json'), '{ not json');
    const r = run('install');
    assert.equal(r.code, 1);
    assert.match(r.err, /Nothing has been written/);
    assert.ok(!existsSync(p('.claude/skills')), 'no half-install left behind');
    assert.ok(!existsSync(p('.claude/harness-manifest.json')), 'no orphaned files without a manifest');
  });

  test('reinstalling does not duplicate the harness hook entry', () => {
    run('install');
    run('install');
    const s = JSON.parse(read('.claude/settings.json'));
    const ours = s.hooks.PreToolUse.filter((g) => g.hooks.some((h) => h.command.includes('/.claude/hooks/guard-')));
    assert.equal(ours.length, 2, 'each guard appears exactly once after a reinstall');
    assert.equal(s.hooks.UserPromptSubmit.length, 1, 'the usage hook is not duplicated either');
  });

  test('uninstall removes harness hooks from every event and keeps the project’s own', () => {
    mkdirSync(p('.claude'), { recursive: true });
    const mine = { type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/my-check.mjs"' };
    writeFileSync(p('.claude/settings.json'), JSON.stringify({
      hooks: { UserPromptSubmit: [{ hooks: [mine] }], PreToolUse: [{ matcher: 'Bash', hooks: [mine] }] },
    }));
    run('install');
    assert.equal(run('uninstall').code, 0);
    const s = JSON.parse(read('.claude/settings.json'));
    assert.deepEqual(s.hooks.UserPromptSubmit, [{ hooks: [mine] }], 'only the project hook is left');
    assert.deepEqual(s.hooks.PreToolUse, [{ matcher: 'Bash', hooks: [mine] }]);
  });
});

// ===========================================================================
describe('local edits are not clobbered', () => {
  test('install skips a locally edited file and says so', () => {
    run('install');
    writeFileSync(p('.claude/skills/handoff/SKILL.md'), read('.claude/skills/handoff/SKILL.md') + EDIT);
    const r = run('install');
    assert.match(r.out, /1 skipped \(locally edited/);
    assert.match(read('.claude/skills/handoff/SKILL.md'), /my local tweak/);
  });

  describe('a recorded incident does not freeze the skill', () => {
    const SKILL = '.claude/skills/handoff/SKILL.md';
    const PLACEHOLDER = '_None recorded yet. `/promote-lesson` appends real occurrences here._';
    const BULLET = '- **My project (2026-11).** Something that cost a day.';
    const addIncident = () => writeFileSync(p(SKILL), read(SKILL).replace(PLACEHOLDER, BULLET));
    // As if the file had been installed from an older upstream whose body differed.
    const makeStale = () => {
      const old = read(SKILL).replace('# Handoff', '# Handoff (old wording)');
      writeFileSync(p(SKILL), old);
      const m = manifest();
      const entry = m.files.find((f) => f.to === SKILL);
      const sha = (t) => createHash('sha256').update(t).digest('hex').slice(0, 16);
      const strip = (t) => t.replace(/^## Incidents[^\n]*\n[\s\S]*?(?=^## |(?![\s\S]))/m, '');
      entry.sha = sha(old);
      entry.bodySha = sha(strip(old));
      writeFileSync(p('.claude/harness-manifest.json'), JSON.stringify(m, null, 2));
    };

    test('an update keeps the incident and is not reported as skipped', () => {
      run('install');
      addIncident();
      const r = run('install');
      assert.doesNotMatch(r.out, /skipped/);
      assert.match(read(SKILL), /Something that cost a day/);
      assert.doesNotMatch(read(SKILL), /None recorded yet/);
      const again = read(SKILL);
      run('install');
      assert.equal(read(SKILL), again, 'a second update changes nothing');
    });

    test('an update still takes upstream wording and keeps the incident', () => {
      run('install');
      makeStale();
      addIncident();
      const r = run('install');
      assert.doesNotMatch(r.out, /skipped/);
      assert.doesNotMatch(read(SKILL), /old wording/);
      assert.match(read(SKILL), /Something that cost a day/);
    });

    test('an install made before bodySha was recorded still merges', () => {
      run('install');
      addIncident();
      const m = manifest();
      for (const f of m.files) delete f.bodySha;
      writeFileSync(p('.claude/harness-manifest.json'), JSON.stringify(m, null, 2));
      const r = run('install');
      assert.doesNotMatch(r.out, /skipped/);
      assert.match(read(SKILL), /Something that cost a day/);
    });

    test('a body edit next to an incident is still a local edit: skipped, nothing lost', () => {
      run('install');
      addIncident();
      writeFileSync(p(SKILL), read(SKILL).replace('# Handoff', '# Handoff (my wording)'));
      const r = run('install');
      assert.match(r.out, /1 skipped \(locally edited/);
      assert.match(read(SKILL), /my wording/);
      assert.match(read(SKILL), /Something that cost a day/);
    });

    test('free text in the Incidents section is never dropped', () => {
      run('install');
      writeFileSync(p(SKILL), read(SKILL).replace(PLACEHOLDER, 'Remember to ask Dana first.'));
      const r = run('install');
      assert.match(r.out, /1 skipped \(locally edited/);
      assert.match(read(SKILL), /ask Dana first/);
    });

    test('--force still replaces the file', () => {
      run('install');
      addIncident();
      run('install', '--force');
      assert.doesNotMatch(read(SKILL), /Something that cost a day/);
    });
  });

  describe('incident merge: what a fresh-eyes review tried', () => {
    const H = '.claude/skills/handoff/SKILL.md';
    const MAP = '.claude/skills/map-subsystem/SKILL.md';
    const PH = '_None recorded yet. `/promote-lesson` appends real occurrences here._';
    let src;
    const runS = (...args) => {
      const r = spawnSync(process.execPath, [path.join(src, 'install.mjs'), ...args, '--target', proj], { encoding: 'utf8' });
      return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
    };
    const upstream = (name, fn) => {
      const f = path.join(src, 'skills', name, 'SKILL.md');
      writeFileSync(f, fn(readFileSync(f, 'utf8')));
    };
    const local = (rel, fn) => writeFileSync(p(rel), fn(read(rel)));
    beforeEach(() => {
      src = makeSource();
      runS('install');
    });

    test('upstream drops its Incidents section: the incident is kept, the file is skipped', () => {
      local(H, (t) => t.replace(PH, '- LOST-1 cost a day.'));
      upstream('handoff', (t) => t.replace('## Incidents', '## Occurrences'));
      const r = runS('install');
      assert.match(r.out, /skipped/);
      assert.match(read(H), /LOST-1 cost a day/);
    });

    test('a skill that ships without the section keeps a section the person added', () => {
      local(MAP, (t) => t.trimEnd() + '\n\n## Incidents\n\n- MAP-LOST-1 cost a day.\n');
      upstream('map-subsystem', (t) => t + '\nAn upstream line.\n');
      runS('install');
      assert.match(read(MAP), /MAP-LOST-1/);
      local(MAP, (t) => t);
    });

    test('...even with no upstream change and the section in the middle', () => {
      local(MAP, (t) => t.replace('## Output', '## Incidents\n\n- MAP-LOST-2 cost a day.\n\n## Output'));
      runS('install');
      assert.match(read(MAP), /MAP-LOST-2/);
    });

    test('text on the placeholder line is a local edit, not dropped', () => {
      local(H, (t) => t.replace(PH, PH + ' Ask Dana before any handoff.\n\n- K one.'));
      const r = runS('install');
      assert.match(r.out, /skipped/);
      assert.match(read(H), /Ask Dana before any handoff/);
    });

    test('upstream can reword and retract its own incident; the person’s bullet stays', () => {
      upstream('handoff', (t) => t.replace(PH, '- UP original wording.'));
      runS('install');
      assert.match(read(H), /UP original wording/);
      local(H, (t) => t.trimEnd() + '\n- OWN stays.\n');
      upstream('handoff', (t) => t.replace('UP original wording', 'UP corrected wording'));
      runS('install');
      assert.match(read(H), /UP corrected wording/);
      assert.doesNotMatch(read(H), /UP original wording/);
      assert.match(read(H), /OWN stays/);
      upstream('handoff', (t) => t.replace('- UP corrected wording.', PH));
      runS('install');
      assert.doesNotMatch(read(H), /UP corrected wording/);
      assert.match(read(H), /OWN stays/);
    });

    test('an install from before bodySha: skipped with a hint, then --merge-incidents, then it flows', () => {
      local(H, (t) => t.replace(PH, '- OLD-1 cost a day.'));
      const m = manifest();
      for (const f of m.files) {
        delete f.bodySha;
        delete f.incidents;
      }
      writeFileSync(p('.claude/harness-manifest.json'), JSON.stringify(m, null, 2));
      upstream('handoff', (t) => t.replace('# Handoff', '# Handoff v2'));
      const r1 = runS('install');
      assert.match(r1.out, /--merge-incidents/);
      assert.doesNotMatch(read(H), /Handoff v2/);
      runS('install', '--merge-incidents');
      assert.match(read(H), /Handoff v2/);
      assert.match(read(H), /OLD-1 cost a day/);
      assert.ok(manifest().files.find((f) => f.to === H).bodySha, 'recorded now');
      upstream('handoff', (t) => t.replace('# Handoff v2', '# Handoff v3'));
      runS('install');
      assert.match(read(H), /Handoff v3/);
      assert.match(read(H), /OLD-1 cost a day/);
    });

    test('a section the person deleted is not put back', () => {
      local(H, (t) => t.replace(/## Incidents[\s\S]*$/, ''));
      const r = runS('install');
      assert.match(r.out, /skipped/);
      assert.doesNotMatch(read(H), /## Incidents/);
    });

    test('trailing whitespace on a bullet does not freeze the skill', () => {
      local(H, (t) => t.replace(PH, '- WS one,  \n  line two.  \n\n- WS two.'));
      upstream('handoff', (t) => t.replace('# Handoff', '# Handoff v2'));
      const r = runS('install');
      assert.doesNotMatch(r.out, /skipped/);
      assert.match(read(H), /Handoff v2/);
      assert.match(read(H), /WS two/);
    });

    test('a CRLF file does not end up with mixed line endings', () => {
      local(H, (t) => t.replace(PH, '- CR one.').replace(/\n/g, '\r\n'));
      upstream('handoff', (t) => t.replace('# Handoff', '# Handoff v2'));
      runS('install');
      assert.match(read(H), /Handoff v2/);
      assert.match(read(H), /CR one/);
      assert.doesNotMatch(read(H), /(?<!\r)\n/, 'every line ending is CRLF');
    });

    test('when another section follows, its blank line is kept', () => {
      upstream('handoff', (t) => t + '\n## After\n\nText.\n');
      runS('install');
      local(H, (t) => t.replace(PH, '- B1 one.\n- B2 two.'));
      upstream('handoff', (t) => t.replace('# Handoff', '# Handoff v2'));
      runS('install');
      assert.match(read(H), /- B2 two\.\n\n## After/);
    });
  });

  test('--force overwrites it', () => {
    run('install');
    writeFileSync(p('.claude/skills/handoff/SKILL.md'), read('.claude/skills/handoff/SKILL.md') + EDIT);
    run('install', '--force');
    assert.doesNotMatch(read('.claude/skills/handoff/SKILL.md'), /my local tweak/);
  });

  test('status distinguishes clean, edited and missing', () => {
    run('install');
    writeFileSync(p('.claude/skills/handoff/SKILL.md'), read('.claude/skills/handoff/SKILL.md') + EDIT);
    rmSync(p('.claude/skills/risky-op/SKILL.md'));
    const r = run('status');
    assert.match(r.out, /1 locally edited/);
    assert.match(r.out, /1 missing/);
    assert.match(r.out, /edited[\s\S]*handoff/);
    assert.match(r.out, /missing[\s\S]*risky-op/);
  });

  test('repair restores missing files but leaves edits alone', () => {
    run('install');
    writeFileSync(p('.claude/skills/handoff/SKILL.md'), read('.claude/skills/handoff/SKILL.md') + EDIT);
    rmSync(p('.claude/skills/risky-op/SKILL.md'));
    const r = run('repair');
    assert.match(r.out, /restored[\s\S]*risky-op/);
    assert.match(r.out, /1 left alone/);
    assert.match(read('.claude/skills/handoff/SKILL.md'), /my local tweak/);
    assert.ok(existsSync(p('.claude/skills/risky-op/SKILL.md')));
  });

  test('uninstall keeps a locally edited file rather than deleting it', () => {
    run('install');
    writeFileSync(p('.claude/skills/handoff/SKILL.md'), read('.claude/skills/handoff/SKILL.md') + EDIT);
    const r = run('uninstall');
    assert.match(r.out, /locally-edited file\(s\) kept/);
    assert.ok(existsSync(p('.claude/skills/handoff/SKILL.md')), 'my edit was not deleted');
  });
});

// ===========================================================================
describe('uninstall leaves no orphans', () => {
  test('a bare project returns to exactly its original contents', () => {
    run('install', '--profile', 'full');
    run('uninstall');
    assert.deepEqual(readdirSync(proj), ['main.py']);
  });

  test('settings.json we created is removed even after a reinstall', () => {
    run('install', '--profile', 'core');
    run('install', '--profile', 'full');
    run('uninstall');
    assert.ok(!existsSync(p('.claude/settings.json')),
      'createdByUs must survive re-install, or an empty {} is orphaned');
    assert.deepEqual(readdirSync(proj), ['main.py']);
  });

  test('a settings.json we did not create keeps its own keys', () => {
    mkdirSync(p('.claude'), { recursive: true });
    writeFileSync(p('.claude/settings.json'), JSON.stringify({ env: { A: '1' } }));
    run('install');
    run('uninstall');
    const s = JSON.parse(read('.claude/settings.json'));
    assert.equal(s.env.A, '1');
    assert.ok(!s.hooks, 'harness hook removed, file kept');
  });

  test('CLAUDE.md keeps user content and loses only the block', () => {
    writeFileSync(p('CLAUDE.md'), '# Acme\n\nWe use pnpm.\n');
    run('install');
    run('uninstall');
    const after = read('CLAUDE.md');
    assert.match(after, /We use pnpm\./);
    assert.doesNotMatch(after, /BEGIN harness/);
  });

  test('CLAUDE.md is deleted when it held only the harness block', () => {
    run('install');
    const r = run('uninstall');
    assert.match(r.out, /removed CLAUDE\.md/);
    assert.ok(!existsSync(p('CLAUDE.md')));
  });

  test('lessons are project knowledge and survive uninstall', () => {
    run('install');
    mkdirSync(p('.claude/lessons'), { recursive: true });
    writeFileSync(p('.claude/lessons/a-lesson.md'), '# kept\n');
    run('uninstall');
    assert.ok(existsSync(p('.claude/lessons/a-lesson.md')), 'never delete recorded lessons');
  });

  test('uninstalling with no manifest refuses instead of guessing', () => {
    const r = run('uninstall');
    assert.equal(r.code, 1);
    assert.match(r.err, /no manifest found/);
  });
});

// ===========================================================================
describe('manifest and portability', () => {
  test('every tracked file carries a content hash and exists', () => {
    run('install');
    const m = manifest();
    assert.ok(m.files.length > 20);
    for (const f of m.files) {
      assert.match(f.sha, /^[0-9a-f]{16}$/, `${f.to} has a hash`);
      assert.ok(existsSync(p(f.to)), `${f.to} exists`);
    }
    assert.equal(m.profile, 'core');
  });

  test('the plugin-root token is rewritten so scripted skills resolve', () => {
    run('install');
    const skill = read('.claude/skills/promote-lesson/SKILL.md');
    assert.doesNotMatch(skill, /CLAUDE_PLUGIN_ROOT/,
      'that token only substitutes for plugin installs, not copied ones');
    assert.match(skill, /\$\{CLAUDE_PROJECT_DIR\}\/\.claude\/harness\/scripts\/vault\.mjs/);
    assert.ok(existsSync(p('.claude/harness/scripts/vault.mjs')), 'the script travelled with it');
  });

  test('a rewritten file is not reported as locally edited afterwards', () => {
    run('install');
    const r = run('status');
    assert.match(r.out, /0 locally edited/, 'hashes must be taken on the transformed bytes');
  });

  test('--dry-run writes nothing at all', () => {
    const r = run('install', '--profile', 'full', '--dry-run');
    assert.equal(r.code, 0);
    assert.match(r.out, /nothing was written/);
    assert.deepEqual(readdirSync(proj), ['main.py']);
  });

  test('update KEEPS the installed profile instead of silently downgrading it', () => {
    // Found in a real project: a `full` install came back as `core` after an
    // update, with both stack packs deleted. parseArgs defaults profile to
    // 'core', so `opts.profile ?? manifest.profile` never fell through.
    run('install', '--profile', 'full');
    assert.ok(skillNames().includes('stateful-markers'), 'packs present before update');
    run('update');
    assert.equal(manifest().profile, 'full', 'update must not change the profile');
    assert.ok(skillNames().includes('stateful-markers'), 'backend pack survived the update');
    assert.ok(skillNames().includes('loading-and-empty'), 'frontend pack survived the update');
  });

  test('update DOES change the profile when one is explicitly passed', () => {
    run('install', '--profile', 'full');
    run('update', '--profile', 'core');
    assert.equal(manifest().profile, 'core');
    assert.ok(!skillNames().includes('stateful-markers'), 'explicit downgrade still works');
  });

  test('update re-reads the local checkout without a network fetch', () => {
    run('install');
    rmSync(p('.claude/skills/handoff/SKILL.md'));
    const r = run('update');
    assert.match(r.out, /local checkout, no download/);
    assert.ok(existsSync(p('.claude/skills/handoff/SKILL.md')));
  });
});
