import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { addScene, checkProject, runProjectCommand, syncProject } from '../src/project-command.mjs';
import { readManifest, resolveWhere, writeManifest } from '../src/project-manifest.mjs';
import { resolveLauncherAssets } from '../src/repo-assets.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const assets = resolveLauncherAssets(repo);

async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'akari-project-manifest-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const root = path.join(home, 'project');
  await fs.mkdir(path.join(root, '.akari'), { recursive: true });
  await fs.mkdir(path.join(root, 'planning'));
  return { home, root };
}
const write = (file, value) => fs.writeFile(file, `${JSON.stringify(value)}\n`);
const ids = manifest => manifest.nodes.map(node => node.id);

test('sync one project, preserve manual nodes and edges, and remain byte-identical', async t => {
  const { root } = await fixture(t);
  await write(path.join(root, '.akari', 'asset-references.json'), { version: 0, references: [{ category: 'still', id: 'rose' }] });
  await write(path.join(root, '.akari', 'style-usage.json'), { entries: [{ style_uid: 'st_01', revision: 2 }] });
  await write(path.join(root, 'people.json'), { entries: [{ id: 'prince', edited: '2026-01-01T00:00:00Z' }] });
  await fs.writeFile(path.join(root, 'planning', 'script.md'), '# script');
  await writeManifest(root, { version: 0, kind: 'akari-project-manifest', future: { keep: true }, nodes: [{ id: 'world:desert', kind: 'world', rev: 1, unknown: true }], edges: [{ from: 'world:desert', uses: 'person:prince', note: 'keep' }] });
  const first = await syncProject(root);
  assert.equal(first.changed, true);
  const manifest = await readManifest(root);
  assert.deepEqual(ids(manifest), ['asset:still/rose', 'doc:script.md', 'person:prince', 'project:project', 'style:st_01', 'world:desert']);
  assert.match(manifest.nodes.find(node => node.id === 'doc:script.md').mtime, /^\d{4}-/);
  assert.equal(manifest.future.keep, true);
  assert.equal(manifest.edges.some(edge => edge.note === 'keep'), true);
  const file = path.join(root, '.akari', 'manifest.json');
  const before = await fs.readFile(file, 'utf8');
  const stat = await fs.stat(file);
  assert.equal((await syncProject(root)).changed, false);
  assert.equal(await fs.readFile(file, 'utf8'), before);
  assert.equal((await fs.stat(file)).ino, stat.ino);
  await write(path.join(root, 'people.json'), { entries: [{ id: 'prince', edited: '2026-01-02T00:00:00Z' }] });
  await syncProject(root);
  assert.equal((await readManifest(root)).nodes.find(node => node.id === 'person:prince').rev, 1);
});

test('two scenes combine ledgers into scene edges and scaffold stays minimal', async t => {
  const { root } = await fixture(t);
  await addScene(root, 's01', assets);
  await addScene(root, 's02', assets);
  for (const id of ['s01', 's02']) {
    for (const file of ['edit.json', 'captions.json', 'assets/.gitkeep', 'planning/.gitkeep']) assert.equal(await fs.stat(path.join(root, 'scenes', id, file)).then(() => true), true);
    assert.equal(await fs.stat(path.join(root, 'scenes', id, '.akari')).then(stat => stat.isDirectory()), true);
    assert.equal(await fs.stat(path.join(root, 'scenes', id, '.git')).then(() => true, () => false), false);
  }
  await write(path.join(root, 'scenes', 's01', '.akari', 'asset-references.json'), { references: [{ category: 'audio', id: 'theme' }] });
  await write(path.join(root, 'scenes', 's02', '.akari', 'style-usage.json'), { entries: [{ style_uid: 'st_a', revision: 3 }] });
  await syncProject(root);
  const manifest = await readManifest(root);
  assert.equal(manifest.edges.some(edge => edge.from === 'scene:s01' && edge.uses === 'asset:audio/theme'), true);
  assert.equal(manifest.edges.some(edge => edge.from === 'scene:s02' && edge.uses === 'style:st_a'), true);
  assert.equal(manifest.edges.some(edge => edge.from === 'project:project' && edge.uses === 'scene:s01'), true);
  const edit = path.join(root, 'scenes', 's01', 'edit.json');
  const later = new Date(Date.now() + 10_000);
  await fs.utimes(edit, later, later);
  await syncProject(root);
  assert.equal((await readManifest(root)).nodes.find(node => node.id === 'scene:s01').rev, 1);
  const fromScene = await runProjectCommand(['sync'], { cwd: path.join(root, 'scenes', 's01'), log: () => {} });
  assert.equal(fromScene.exitCode, 0);
  assert.equal(await fs.stat(path.join(root, 'scenes', 's01', '.akari', 'manifest.json')).then(() => true, () => false), false);
});

test('scene add rejects duplicate and traversal IDs', async t => {
  const { root } = await fixture(t);
  const logs = [], errors = [];
  const options = { cwd: root, assets, log: line => logs.push(line), logError: line => errors.push(line) };
  assert.equal((await runProjectCommand(['scene', 'add', 's01'], options)).exitCode, 0);
  assert.equal((await runProjectCommand(['scene', 'add', 's01'], options)).exitCode, 1);
  assert.equal((await runProjectCommand(['scene', 'add', '..'], options)).exitCode, 1);
  assert.equal(await fs.stat(path.join(root, 'scenes', 's01')).then(stat => stat.isDirectory()), true);
  assert.ok(errors.length >= 2);
});

test('check accepts an older project with edit.json but no manifest directory', async t => {
  const { root } = await fixture(t);
  await fs.rm(path.join(root, '.akari'), { recursive: true });
  await write(path.join(root, 'edit.json'), { version: 2 });
  const output = [];
  const result = await runProjectCommand(['check', root], { log: line => output.push(line) });
  assert.equal(result.exitCode, 0);
  assert.match(output[0], /manifest/);
});

test('check handles absent manifest and all five categories', async t => {
  const { root, home } = await fixture(t);
  const env = { HOME: home, AKARI_HOME: path.join(home, '.akari') };
  assert.deepEqual(await checkProject(root, { env }), { absent: true, exitCode: 0 });
  const reportFile = path.join(root, '.akari', 'reports', 'manifest-check.json');
  assert.equal(await fs.stat(reportFile).then(() => true, () => false), false);
  await fs.mkdir(path.join(root, 'assets'));
  await fs.writeFile(path.join(root, 'assets', 'made.txt'), 'new');
  await writeManifest(root, { version: 0, kind: 'akari-project-manifest', nodes: [
    { id: 'project:p', kind: 'project', rev: 0 },
    { id: 'asset:still/rose', kind: 'asset', rev: 0, source: 'lab' },
    { id: 'world:lost', kind: 'world', rev: 0, where: 'world/lost' },
    { id: 'doc:made', kind: 'doc', rev: 0, where: 'assets/made.txt', edited: '2000-01-01T00:00:00Z' },
    { id: 'world:bad', kind: 'world', rev: 0, where: '../outside' },
    { id: 'asset:own/x', kind: 'asset', rev: 0, source: 'own' }
  ], edges: [
    { from: 'project:p', uses: 'missing:x' },
    { from: 'project:p', uses: 'project:p' },
    { from: 'project:p', uses: 'world:lost' },
    { from: 'world:lost', uses: 'project:p' }
  ] });
  const report = await checkProject(root, { env });
  assert.equal(report.exitCode, 1);
  const codes = report.findings.map(finding => finding.code);
  for (const code of ['MISSING_NODE', 'UNACQUIRED', 'MISSING_WHERE', 'STALE', 'SELF_REFERENCE', 'CYCLE', 'INVALID_WHERE']) assert.ok(codes.includes(code), code);
  assert.equal(codes.includes('UNPUBLISHABLE'), false); // v0 has no public copy.
  assert.deepEqual(JSON.parse(await fs.readFile(reportFile, 'utf8')).summary, report.summary);
});

test('tool-output hash change increments revision once and symlink escape is rejected', async t => {
  const { root, home } = await fixture(t);
  await fs.writeFile(path.join(root, 'output.txt'), 'old');
  await fs.writeFile(path.join(home, 'outside.txt'), 'secret');
  await fs.symlink(path.join(home, 'outside.txt'), path.join(root, 'escape.txt'));
  await assert.rejects(resolveWhere(root, 'escape.txt'));
  await writeManifest(root, { version: 0, kind: 'akari-project-manifest', nodes: [{ id: 'tool:x/a', kind: 'tool-output', rev: 2, where: 'output.txt', sha256: 'outdated' }], edges: [] });
  await syncProject(root);
  const first = (await readManifest(root)).nodes.find(node => node.id === 'tool:x/a');
  assert.equal(first.rev, 3);
  assert.notEqual(first.sha256, 'outdated');
  await syncProject(root);
  assert.equal((await readManifest(root)).nodes.find(node => node.id === 'tool:x/a').rev, 3);
});

test('asset resolution checks project first, then isolated library, and detects newer revisions', async t => {
  const { root, home } = await fixture(t);
  const env = { HOME: home, AKARI_HOME: path.join(home, '.akari'), AKARI_LIBRARY_ROOT: path.join(home, 'library') };
  const libraryAsset = path.join(env.AKARI_LIBRARY_ROOT, 'still', 'rose');
  await fs.mkdir(libraryAsset, { recursive: true });
  await write(path.join(libraryAsset, '.meta.json'), { version: 4 });
  await writeManifest(root, { version: 0, kind: 'akari-project-manifest', nodes: [
    { id: 'asset:still/rose', kind: 'asset', rev: 1, source: 'lab', by: 'sync' }
  ], edges: [] });
  assert.deepEqual((await checkProject(root, { env })).findings.map(finding => finding.code), ['STALE']);
  const local = path.join(root, 'assets', 'still', 'rose');
  await fs.mkdir(local, { recursive: true });
  await write(path.join(local, '.meta.json'), { version: 1 });
  assert.deepEqual((await checkProject(root, { env })).findings, []);
  await write(path.join(root, '.akari', 'asset-references.json'), { references: [{ category: 'still', id: 'rose' }] });
  await syncProject(root);
  const asset = (await readManifest(root)).nodes.find(node => node.id === 'asset:still/rose');
  assert.equal(asset.rev, 1);
  assert.equal(asset.where, 'assets/still/rose');
});

test('sync records own, builtin, and Lab sources from resolved asset locations', async t => {
  const { root, home } = await fixture(t);
  const env = { HOME: home, AKARI_HOME: path.join(home, '.akari') };
  const library = path.join(env.AKARI_HOME, 'assets');
  await fs.mkdir(path.join(root, 'assets', 'still', 'local'), { recursive: true });
  await fs.mkdir(path.join(library, 'still', 'bundled'), { recursive: true });
  const lab = path.join(library, 'store', 'pack-1', 'assets', 'still', 'remote');
  await fs.mkdir(lab, { recursive: true });
  await fs.symlink(lab, path.join(library, 'still', 'remote'));
  await write(path.join(root, '.akari', 'asset-references.json'), { references: [
    { category: 'still', id: 'local', sourceKind: 'lab' },
    { category: 'still', id: 'bundled', sourceKind: 'own' },
    { category: 'still', id: 'remote' }
  ] });
  await syncProject(root, { env });
  const nodes = new Map((await readManifest(root)).nodes.map(node => [node.id, node]));
  assert.equal(nodes.get('asset:still/local').source, 'own');
  assert.equal(nodes.get('asset:still/local').where, 'assets/still/local');
  assert.equal(nodes.get('asset:still/bundled').source, 'builtin');
  assert.equal(nodes.get('asset:still/bundled').where, undefined);
  assert.equal(nodes.get('asset:still/remote').source, 'lab');
  assert.deepEqual((await checkProject(root, { env })).findings, []);
  await fs.rm(path.join(root, 'assets', 'still', 'local'), { recursive: true });
  await fs.mkdir(path.join(library, 'still', 'local'), { recursive: true });
  await syncProject(root, { env });
  const moved = (await readManifest(root)).nodes.find(node => node.id === 'asset:still/local');
  assert.equal(moved.source, 'builtin');
  assert.equal(moved.where, undefined);
});

test('unacquired Lab reference is a warning with exit 0, while other missing assets are errors', async t => {
  const { root, home } = await fixture(t);
  const env = { HOME: home, AKARI_HOME: path.join(home, '.akari') };
  await write(path.join(root, '.akari', 'asset-references.json'), { references: [
    { category: 'still', id: 'future', sourceKind: 'lab' }
  ] });
  const options = { cwd: root, env, log: () => {} };
  assert.equal((await runProjectCommand(['sync'], options)).exitCode, 0);
  assert.equal((await readManifest(root)).nodes.find(node => node.id === 'asset:still/future').source, 'lab');
  const checked = await runProjectCommand(['check'], options);
  assert.equal(checked.exitCode, 0);
  assert.deepEqual(checked.result.summary, { error: 0, warning: 1, info: 0 });
  assert.equal(checked.result.findings[0].code, 'UNACQUIRED');
  await write(path.join(root, '.akari', 'asset-references.json'), { references: [
    { category: 'still', id: 'future', sourceKind: 'lab' },
    { category: 'still', id: 'lost' }
  ] });
  await syncProject(root, { env });
  const missing = (await readManifest(root)).nodes.find(node => node.id === 'asset:still/lost');
  assert.equal(missing.source, undefined);
  const failed = await checkProject(root, { env });
  assert.equal(failed.exitCode, 1);
  assert.ok(failed.findings.some(finding => finding.node === missing.id && finding.severity === 'error'));
});

test('CLI sync and check keep an unacquired Lab reference as a warning', async t => {
  const { root, home } = await fixture(t);
  const env = { ...process.env, HOME: home, AKARI_HOME: path.join(home, '.akari'), AKARI_LANG: 'ja' };
  await write(path.join(root, '.akari', 'asset-references.json'), { references: [
    { category: 'still', id: 'not-downloaded', sourceKind: 'lab' }
  ] });
  const bin = path.join(repo, 'packages', 'akari-launcher', 'bin', 'akari.mjs');
  const sync = spawnSync(process.execPath, [bin, 'project', 'sync', root], { encoding: 'utf8', env });
  assert.equal(sync.status, 0, sync.stderr);
  assert.equal((await readManifest(root)).nodes.find(node => node.id === 'asset:still/not-downloaded').source, 'lab');
  const check = spawnSync(process.execPath, [bin, 'project', 'check', root, '--json'], { encoding: 'utf8', env });
  assert.equal(check.status, 0, check.stderr);
  const report = JSON.parse(check.stdout);
  assert.deepEqual(report.summary, { error: 0, warning: 1, info: 0 });
  assert.equal(report.findings[0].code, 'UNACQUIRED');
});

test('person edited change is stale until sync raises rev', async t => {
  const { root, home } = await fixture(t);
  const env = { HOME: home, AKARI_HOME: path.join(home, '.akari') };
  await write(path.join(root, 'people.json'), { entries: [{ id: 'prince', edited: '2026-01-01T00:00:00Z' }] });
  await syncProject(root);
  await write(path.join(root, 'people.json'), { entries: [{ id: 'prince', edited: '2026-01-02T00:00:00Z' }] });
  assert.equal((await checkProject(root, { env })).findings.some(finding => finding.code === 'STALE'), true);
  await syncProject(root);
  assert.equal((await checkProject(root, { env })).findings.some(finding => finding.code === 'STALE'), false);
});

test('channel people resolve only within their channel root', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'akari-project-channel-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const channel = path.join(home, 'channels', 'sample');
  const root = path.join(channel, 'videos', 'film');
  await fs.mkdir(path.join(root, '.akari'), { recursive: true });
  await write(path.join(channel, 'people.json'), { entries: [{ id: 'p1', edited: '2026-01-01T00:00:00Z' }] });
  await syncProject(root);
  const person = (await readManifest(root)).nodes.find(node => node.id === 'person:p1');
  assert.equal(person.source, 'channel');
  assert.equal(person.where, undefined);
  await fs.rename(path.join(channel, 'people.json'), path.join(home, 'outside.json'));
  await fs.symlink(path.join(home, 'outside.json'), path.join(channel, 'people.json'));
  assert.equal((await checkProject(root, { env: { HOME: home, AKARI_HOME: path.join(home, '.akari') } })).findings.some(finding => finding.code === 'MISSING_WHERE'), true);
});

test('manifest and report symlinks cannot redirect writes outside the project', async t => {
  const { root, home } = await fixture(t);
  const outside = path.join(home, 'outside.json');
  await fs.writeFile(outside, 'secret');
  await fs.symlink(outside, path.join(root, '.akari', 'manifest.json'));
  await assert.rejects(syncProject(root));
  assert.equal(await fs.readFile(outside, 'utf8'), 'secret');
  await fs.rm(path.join(root, '.akari', 'manifest.json'));
  await writeManifest(root, { version: 0, kind: 'akari-project-manifest', nodes: [], edges: [] });
  await fs.symlink(home, path.join(root, '.akari', 'reports'));
  await assert.rejects(checkProject(root, { env: { HOME: home, AKARI_HOME: path.join(home, '.akari') } }));
  assert.equal(await fs.stat(path.join(home, 'manifest-check.json')).then(() => true, () => false), false);
});
