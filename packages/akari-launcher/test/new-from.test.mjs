import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runNewCommand } from '../src/new-command.mjs';
import { resolveRepoAssets } from '../src/repo-assets.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const fixture = join(repo, 'packages', 'project-scaffold', 'test', 'fixtures', 'playbook-sample');
const assets = resolveRepoAssets(repo);

test('new --from directory applies a playbook', async () => {
  const root = await mkdtemp(join(tmpdir(), 'akari-new-from-'));
  try {
    const lines = [];
    const result = await runNewCommand(['p1', '--from', fixture], { cwd: root, assets, log: line => lines.push(line) });
    assert.equal(result.exitCode, 0);
    assert.match(lines.join('\n'), /create-project-report\.html/);
    assert.match(lines.join('\n'), /playbook-sheet\.html/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('new --from puts the playbook and edit skeleton in the initial commit', async (t) => {
  if (spawnSync('git', ['--version'], { encoding: 'utf8' }).status !== 0) {
    t.skip('git is unavailable');
    return;
  }
  const root = await mkdtemp(join(tmpdir(), 'akari-new-initial-commit-'));
  try {
    const project = join(root, 'p1');
    const result = await runNewCommand([project, '--from', fixture], { cwd: root, assets, log: () => {} });
    assert.equal(result.exitCode, 0);
    assert.equal(result.result.git.action, 'initialized-and-committed');
    const committed = spawnSync('git', ['-C', project, 'show', '--pretty=format:', '--name-only', 'HEAD'], { encoding: 'utf8' });
    assert.equal(committed.status, 0, committed.stderr);
    assert.match(committed.stdout, /planning\/playbook\.json/);
    assert.match(committed.stdout, /planning\/playbook\.md/);
    const status = spawnSync('git', ['-C', project, 'status', '--porcelain', '--', 'edit.json'], { encoding: 'utf8' });
    assert.equal(status.status, 0, status.stderr);
    assert.equal(status.stdout.trim(), '');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('new --from id resolves the local shelf', async () => {
  const root = await mkdtemp(join(tmpdir(), 'akari-new-id-'));
  try {
    const home = join(root, 'home');
    const { mkdir, cp } = await import('node:fs/promises');
    await mkdir(join(home, 'playbooks'), { recursive: true });
    await cp(fixture, join(home, 'playbooks', 'sample'), { recursive: true });
    const result = await runNewCommand(['p2', '--from', 'sample'], { cwd: root, assets, env: { ...process.env, AKARI_HOME: home }, log: () => {} });
    assert.equal(result.exitCode, 0);
    assert.ok(JSON.parse(await readFile(join(root, 'p2', 'planning', 'playbook.json'), 'utf8')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('channel playbook takes precedence over the local shelf', async () => {
  const root = await mkdtemp(join(tmpdir(), 'akari-new-channel-'));
  try {
    const { mkdir, cp } = await import('node:fs/promises');
    const creator = join(root, 'creator');
    const shelf = join(root, 'home');
    const { createCreatorRoot } = await import('../../creator-root/src/index.mjs');
    await createCreatorRoot(creator);
    await mkdir(join(creator, 'channels', 'my-channel', 'playbooks'), { recursive: true });
    await mkdir(join(shelf, 'playbooks'), { recursive: true });
    await cp(fixture, join(creator, 'channels', 'my-channel', 'playbooks', 'sample'), { recursive: true });
    await cp(fixture, join(shelf, 'playbooks', 'sample'), { recursive: true });
    const result = await runNewCommand(['p5', '--from', 'sample'], { cwd: root, assets,
      env: { ...process.env, AKARI_CREATOR_ROOT: creator, AKARI_HOME: shelf }, log: () => {} });
    assert.equal(result.exitCode, 0);
    assert.match(result.applied.playbookJsonPath, /playbook\.json$/);
    const book = JSON.parse(await readFile(result.applied.playbookJsonPath, 'utf8'));
    assert.equal(book.provenance.appliedFrom.path, join(creator, 'channels', 'my-channel', 'playbooks', 'sample'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('new without --from keeps the ordinary path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'akari-new-plain-'));
  try {
    const result = await runNewCommand(['p3'], { cwd: root, assets, log: () => {} });
    assert.equal(result.exitCode, 0);
    assert.equal(result.applied, undefined);
    await assert.rejects(readFile(join(root, 'p3', 'planning', 'playbook.json')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('missing --from id fails in Japanese before creating the project', async () => {
  const root = await mkdtemp(join(tmpdir(), 'akari-new-missing-'));
  try {
    const errors = [];
    const result = await runNewCommand(['p4', '--from', 'no-such-id'], { cwd: root, assets, env: { ...process.env, AKARI_HOME: join(root, 'home') }, logError: line => errors.push(line) });
    assert.equal(result.exitCode, 1);
    assert.match(errors.join(' '), /作り方が見つかりません/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
