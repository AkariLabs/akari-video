import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { setupFixtureEnv } from './helpers.mjs';
import { resolve as fetchAsset } from '../src/resolve.mjs';
import { composeState } from '../src/state.mjs';
import { bundleProjectReferences } from '../src/bundle.mjs';
import { createCreatorRoot, migrateAssetLibrary, resolveAssetLibraryRoots } from '../../creator-root/src/index.mjs';

const cli = path.resolve(import.meta.dirname, '../bin/akari-assets.mjs');
test('CLI migrate/list, interrupted reads, late old CLI writes, reference bundle and env write root', async t => {
  const f = setupFixtureEnv(); t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  const creator = path.join(f.root, 'creator'); await createCreatorRoot(creator);
  const env = { ...f.env, AKARI_CREATOR_ROOT: creator };
  const original = await fetchAsset('mini-still', { env });
  const library = path.join(creator, 'library');
  await fs.mkdir(path.join(f.home, 'assets/audio/theme'), { recursive: true });
  await fs.writeFile(path.join(f.home, 'assets/audio/theme/a.wav'), 'sound');
  let count = 0;
  const partial = await migrateAssetLibrary({ env, fsOps: { rename: async (...args) => {
    if (++count === 2) throw new Error('interrupted'); return fs.rename(...args);
  } } });
  assert.equal(partial.state, 'migrating');
  assert.equal((await composeState({ env })).items.find(x => x.id === 'mini-still').state, 'cached');
  assert.equal((await fetchAsset('mini-still', { env })).dir, original.dir);
  const run = args => spawnSync(process.execPath, [cli, ...args], {
    env: { ...process.env, ...env, HOME: f.root, AKARI_LIBRARY_ROOT: library }, encoding: 'utf8' });
  const migrate = run(['migrate']); assert.equal(migrate.status, 0, migrate.stderr);
  assert.equal(JSON.parse(migrate.stdout).state, 'done');
  const list = run(['list']); assert.equal(list.status, 0, list.stderr);
  assert.ok(list.stdout.split('\n')[0].includes(library));
  assert.match(list.stdout, /✓  mini-still/);
  assert.equal(JSON.parse(run(['migrate']).stdout).moved, 0);
  const project = path.join(f.root, 'project');
  await fs.mkdir(project);
  await fetchAsset('mini-still', { env, project, reference: true });
  assert.deepEqual((await bundleProjectReferences({ env, project })).failures, []);
  // A previous CLI still writes the old home/assets; the resolver reads it and explicit migration collects it.
  await fs.rename(path.join(library, 'still'), path.join(f.home, 'assets/still'));
  assert.equal((await fetchAsset('mini-still', { env })).cached, true);
  assert.ok((await migrateAssetLibrary({ env })).moved > 0);
  assert.equal((await fetchAsset('mini-still', { env })).dir, path.join(library, 'still/mini-still'));
  const customEnv = { ...env, AKARI_LIBRARY_ROOT: path.join(f.root, 'custom') };
  const fresh = await fetchAsset('mini-still', { env: customEnv, force: true });
  assert.equal(fresh.dir, path.join(resolveAssetLibraryRoots(customEnv).write, 'still/mini-still'));
  assert.ok(!(await fs.readdir(f.home)).some(name => name.startsWith('.tmp-resolve-')));
  assert.ok(!(await fs.readdir(resolveAssetLibraryRoots(customEnv).write)).some(name => name.startsWith('.tmp-resolve-')));
});
