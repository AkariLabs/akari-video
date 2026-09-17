import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { ENTRY_VERSION_FILE, entryStatus, entryTargets, refreshEntrySkillOnLaunch, resolveEntrySource, runSkillsCommand } from '../src/skills-command.mjs';
import { checkEntrySkill, forbiddenTerms } from '../../../scripts/check-entry-skill.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const bin = join(repo, 'packages/akari-launcher/bin/akari.mjs');

function fixture(t) {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'akari-entry-test-')));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const env = { ...process.env, HOME: join(scratch, 'home'), AKARI_HOME: join(scratch, 'state'), AKARI_NO_AUTO_UPDATE: '1' };
  mkdirSync(env.HOME);
  mkdirSync(env.AKARI_HOME);
  const logs = [];
  const warnings = [];
  const options = { env, log: line => logs.push(line), logError: line => warnings.push(line) };
  return { scratch, env, options, logs, warnings, targets: entryTargets(env) };
}

test('install is idempotent and copies only the entry skill into the two HOME locations', async t => {
  const f = fixture(t);
  const version = resolveEntrySource(f.options).version;
  for (let i = 0; i < 2; i++) assert.equal((await runSkillsCommand(['install', '--entry'], f.options)).exitCode, 0);
  for (const target of f.targets) {
    assert.equal(lstatSync(target).isSymbolicLink(), false);
    assert.equal(readFileSync(join(target, ENTRY_VERSION_FILE), 'utf8'), `${version}\n`);
    assert.equal(readFileSync(join(target, 'SKILL.md'), 'utf8'), readFileSync(join(repo, 'skills/akari/SKILL.md'), 'utf8'));
    assert.equal(existsSync(join(dirname(target), 'edit-plan')), false);
    assert.equal(existsSync(join(target, 'test')), false);
  }
  for (const name of ['.codex', '.cursor', '.config']) assert.equal(existsSync(join(f.env.HOME, name)), false);
});

test('install excludes test and hidden entries relative to the source root', async t => {
  const f = fixture(t);
  const app = join(f.env.AKARI_HOME, 'app');
  const source = join(app, 'skills/akari');
  const excluded = ['test/entry.test.mjs', '.scratch/draft.md', '.temporary', 'references/.cache/draft.md', 'references/.temporary'];
  for (const name of ['SKILL.md', 'references/guide.md', ...excluded]) {
    mkdirSync(dirname(join(source, name)), { recursive: true });
    writeFileSync(join(source, name), name);
  }
  mkdirSync(join(app, 'packages/akari-launcher'), { recursive: true });
  writeFileSync(join(app, 'packages/akari-launcher/package.json'), '{"version":"9.8.7"}');
  const extra = join(f.scratch, 'extra');
  assert.equal((await runSkillsCommand(['install', '--entry', '--target', extra], f.options)).exitCode, 0);
  for (const target of [...f.targets, extra]) {
    assert.equal(readFileSync(join(target, 'SKILL.md'), 'utf8'), 'SKILL.md');
    assert.equal(readFileSync(join(target, ENTRY_VERSION_FILE), 'utf8'), '9.8.7\n');
    assert.equal(readFileSync(join(target, 'references/guide.md'), 'utf8'), 'references/guide.md');
    for (const name of ['test', '.scratch', 'references/.cache', ...excluded]) {
      assert.equal(existsSync(join(target, name)), false, `${name} must not be installed`);
    }
  }
});

test('remove preserves unmarked directories, deletes marked defaults and explicit targets only', async t => {
  const f = fixture(t);
  const extra = join(f.scratch, 'extra');
  const untouched = join(f.scratch, 'unmarked');
  mkdirSync(untouched);
  writeFileSync(join(untouched, 'SKILL.md'), 'user content');
  assert.equal((await runSkillsCommand(['install', '--entry', '--target', extra], f.options)).exitCode, 0);
  rmSync(join(f.targets[0], ENTRY_VERSION_FILE));
  assert.equal((await runSkillsCommand(['remove', '--entry', '--target', extra, '--target', untouched], f.options)).exitCode, 1);
  assert.equal(existsSync(f.targets[0]), true);
  assert.equal(existsSync(f.targets[1]), false);
  assert.equal(existsSync(extra), false);
  assert.equal(readFileSync(join(untouched, 'SKILL.md'), 'utf8'), 'user content');
  assert.ok(f.warnings.length >= 2);
});

test('status reports presence, version and stale without modifying files', async t => {
  const f = fixture(t);
  assert.ok(entryStatus(f.options).targets.every(target => !target.exists && !target.stale));
  await runSkillsCommand(['install', '--entry'], f.options);
  writeFileSync(join(f.targets[0], ENTRY_VERSION_FILE), '0.0.0\n');
  const status = entryStatus(f.options);
  assert.equal(status.targets[0].version, '0.0.0');
  assert.equal(status.targets[0].stale, true);
  assert.equal(status.targets[1].stale, false);
  assert.equal((await runSkillsCommand(['status', '--json'], f.options)).exitCode, 0);
  assert.deepEqual(JSON.parse(f.logs.at(-1)), status);
  assert.equal(readFileSync(join(f.targets[0], ENTRY_VERSION_FILE), 'utf8'), '0.0.0\n');
});

test('launch refresh overwrites only a different version; --version invokes it', async t => {
  const f = fixture(t);
  await runSkillsCommand(['install', '--entry'], f.options);
  for (const target of f.targets) writeFileSync(join(target, 'SKILL.md'), 'local edit');
  writeFileSync(join(f.targets[0], ENTRY_VERSION_FILE), '0.0.0\n');
  const result = spawnSync(process.execPath, [bin, '--version'], { env: f.env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^v\d/);
  assert.equal(result.stderr, '');
  assert.equal(readFileSync(join(f.targets[0], 'SKILL.md'), 'utf8'), readFileSync(join(repo, 'skills/akari/SKILL.md'), 'utf8'));
  assert.equal(readFileSync(join(f.targets[1], 'SKILL.md'), 'utf8'), 'local edit');
  assert.ok(entryStatus(f.options).targets.every(target => !target.stale));
});

test('launch refresh does nothing when uninstalled, including when source is absent', t => {
  const f = fixture(t);
  refreshEntrySkillOnLaunch({ ...f.options, repoRoot: join(f.scratch, 'absent') });
  const result = spawnSync(process.execPath, [bin, '--version'], { env: f.env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(f.targets.every(target => !existsSync(target)));
  assert.equal(existsSync(join(f.env.HOME, '.claude')), false);
});

test('install, refresh and remove preserve symlink destinations and their contents', async t => {
  const f = fixture(t);
  const outside = join(f.scratch, 'linked-source');
  mkdirSync(outside);
  writeFileSync(join(outside, 'SKILL.md'), 'keep me');
  writeFileSync(join(outside, ENTRY_VERSION_FILE), '0.0.0\n');
  mkdirSync(dirname(f.targets[0]), { recursive: true });
  symlinkSync(outside, f.targets[0], process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await runSkillsCommand(['install', '--entry'], f.options)).exitCode, 1);
  refreshEntrySkillOnLaunch(f.options);
  assert.equal((await runSkillsCommand(['remove', '--entry'], f.options)).exitCode, 1);
  assert.ok(lstatSync(f.targets[0]).isSymbolicLink());
  assert.equal(readFileSync(join(outside, 'SKILL.md'), 'utf8'), 'keep me');
  assert.equal(readFileSync(join(outside, ENTRY_VERSION_FILE), 'utf8'), '0.0.0\n');
  assert.match(f.warnings.join('\n'), /symlink/);
});

test('linked files inside a managed target are not followed or removed', async t => {
  const f = fixture(t);
  await runSkillsCommand(['install', '--entry'], f.options);
  const outside = join(f.scratch, 'file.md');
  writeFileSync(outside, 'outside');
  const skill = join(f.targets[0], 'SKILL.md');
  rmSync(skill);
  symlinkSync(outside, skill);
  writeFileSync(join(f.targets[0], ENTRY_VERSION_FILE), '0.0.0');
  refreshEntrySkillOnLaunch(f.options);
  assert.equal((await runSkillsCommand(['install', '--entry'], f.options)).exitCode, 1);
  await runSkillsCommand(['remove', '--entry'], f.options);
  assert.equal(readFileSync(outside, 'utf8'), 'outside');
  assert.ok(lstatSync(skill).isSymbolicLink());
});

test('AKARI_HOME app source takes precedence and its launcher version is used', async t => {
  const f = fixture(t);
  const app = join(f.env.AKARI_HOME, 'app');
  mkdirSync(join(app, 'skills/akari'), { recursive: true });
  mkdirSync(join(app, 'packages/akari-launcher'), { recursive: true });
  writeFileSync(join(app, 'skills/akari/SKILL.md'), 'installed app skill');
  writeFileSync(join(app, 'packages/akari-launcher/package.json'), '{"version":"9.8.7"}');
  assert.equal((await runSkillsCommand(['install', '--entry'], f.options)).exitCode, 0);
  for (const target of f.targets) {
    assert.equal(readFileSync(join(target, 'SKILL.md'), 'utf8'), 'installed app skill');
    assert.equal(readFileSync(join(target, ENTRY_VERSION_FILE), 'utf8'), '9.8.7\n');
  }
});

test('invalid CLI arguments fail before creating targets; CLI install and remove work', async t => {
  const f = fixture(t);
  for (const args of [[], ['install'], ['install', '--entry', '--target'], ['remove', '--entry', '--json'], ['status', '--json', '--unknown']]) {
    assert.equal((await runSkillsCommand(args, f.options)).exitCode, 1);
  }
  assert.ok(f.targets.every(target => !existsSync(target)));
  for (const action of ['install', 'remove']) {
    const result = spawnSync(process.execPath, [bin, 'skills', action, '--entry'], { env: f.env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(f.targets.every(target => existsSync(target) === (action === 'install')));
  }
});

test('entry lint rejects every forbidden term, other skill names and overlong descriptions', t => {
  const f = fixture(t);
  const file = join(f.scratch, 'SKILL.md');
  assert.ok(checkEntrySkill() <= 200);
  for (const value of [...forbiddenTerms, 'create-project', 'あ'.repeat(201)]) {
    writeFileSync(file, `---\nname: akari\ndescription: ${value}\n---\n`);
    assert.throws(() => checkEntrySkill(file));
  }
  writeFileSync(file, '---\nname: akari\ndescription: >-\n  動画を作りたい\n  BGM\n---\n');
  const result = spawnSync(process.execPath, [join(repo, 'scripts/check-entry-skill.mjs'), file], { env: f.env, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /BGM/);
});
