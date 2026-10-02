import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveAkariAssetsDir, resolveAssetLibraryRoots, resolveLibraryFallback } from '../src/library-reference.mjs';

const CASES = [
  { name: 'new wins', files: [true, true], winner: 0 },
  { name: 'old fallback', files: [false, true], winner: 1 },
  { name: 'new only', files: [true, false], winner: 0 },
  { name: 'missing', files: [false, false], winner: null },
  { name: 'no ledger', files: [true, true], winner: null, references: [] },
  { name: 'traversal both roots', files: [true, true], winner: null, declaredPath: 'assets/still/card/../card/frame.png' },
  { name: 'outside symlink new', files: ['escape', false], winner: null },
  { name: 'outside symlink old', files: [false, 'escape'], winner: null },
  { name: 'outside symlink both', files: ['escape', 'escape'], winner: null },
  { name: 'invalid new still tries old', files: ['escape', true], winner: 1 },
  { name: 'directory is not a file', files: ['directory', 'directory'], winner: null },
];

for (const entry of CASES) test(entry.name, async t => {
  const temp = await fs.mkdtemp(path.join(tmpdir(), 'library-roots-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const roots = [path.join(temp, 'library'), path.join(temp, 'home/assets')];
  const outside = path.join(temp, 'outside');
  await fs.writeFile(outside, 'outside');
  for (let index = 0; index < roots.length; index++) {
    const file = path.join(roots[index], 'still/card/frame.png');
    await fs.mkdir(path.dirname(file), { recursive: true });
    if (entry.files[index] === 'escape') await fs.symlink(outside, file);
    else if (entry.files[index] === 'directory') await fs.mkdir(file);
    else if (entry.files[index]) await fs.writeFile(file, String(index));
  }
  const result = resolveLibraryFallback({
    projectRoot: path.join(temp, 'project'),
    declaredPath: entry.declaredPath ?? 'assets/still/card/frame.png',
    references: entry.references ?? [{ category: 'still', id: 'card' }],
    libraryRoots: roots,
  });
  assert.equal(result.matched, !((entry.references?.length === 0) || entry.declaredPath));
  if (entry.winner === null) {
    assert.equal(result.path, null);
    assert.equal(result.libraryRoot, null);
  } else {
    assert.equal(result.path, await fs.realpath(path.join(roots[entry.winner], 'still/card/frame.png')));
    assert.equal(result.libraryRoot, await fs.realpath(roots[entry.winner]));
  }
});

test('env/location/legacy resolution has fixed write, read, and source expectations', async t => {
  const temp = await fs.mkdtemp(path.join(tmpdir(), 'library-location-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const home = path.join(temp, 'home');
  const legacy = path.join(home, 'assets');
  const library = path.join(temp, 'library');
  await fs.mkdir(home);
  for (const value of [null, '{', {}, { version: 99, root: library, state: 'done' },
    ...['pending', 'migrating', 'done', 'declined'].map(state => ({ version: 0, root: library, state }))]) {
    const file = path.join(home, 'library-location.json');
    if (value === null) await fs.rm(file, { force: true });
    else await fs.writeFile(file, typeof value === 'string' ? value : JSON.stringify(value));
    for (const override of [undefined, path.join(temp, 'override'), legacy]) {
      const env = { AKARI_HOME: home, AKARI_LIBRARY_ROOT: override };
      const active = value && value.version === 0 && ['migrating', 'done'].includes(value.state);
      const expectedWrite = override || (active ? library : legacy);
      assert.deepEqual(resolveAssetLibraryRoots(env), {
        write: expectedWrite,
        read: expectedWrite === legacy ? [legacy] : [expectedWrite, legacy],
        source: override ? 'env' : active ? 'location' : 'legacy',
      });
      assert.equal(resolveAkariAssetsDir(env), expectedWrite);
    }
  }
  assert.deepEqual(resolveAssetLibraryRoots({ HOME: temp }), {
    write: path.join(temp, '.akari/assets'), read: [path.join(temp, '.akari/assets')], source: 'legacy',
  });
  for (const env of [{ USERPROFILE: temp }, { HOMEDRIVE: temp, HOMEPATH: '/profile' }]) {
    const homeDir = env.USERPROFILE || `${env.HOMEDRIVE}${env.HOMEPATH}`;
    const expected = path.join(homeDir, '.akari/assets');
    assert.deepEqual(resolveAssetLibraryRoots(env, { platform: 'win32' }), {
      write: expected, read: [expected], source: 'legacy',
    });
  }
});

for (const previousRootPresent of [false, true]) {
  for (const state of ['pending', 'migrating', 'done', 'declined']) {
    test(`previousRoot ${previousRootPresent ? 'present' : 'absent'} / ${state}: write, read, source`, async t => {
      const temp = await fs.mkdtemp(path.join(tmpdir(), 'library-previous-'));
      t.after(() => fs.rm(temp, { recursive: true, force: true }));
      const home = path.join(temp, 'home');
      const legacy = path.join(home, 'assets');
      const root = path.join(temp, 'next');
      const previousRoot = path.join(temp, 'previous');
      await fs.mkdir(home);
      await fs.writeFile(path.join(home, 'library-location.json'), JSON.stringify({
        version: 0, root, state, ...(previousRootPresent ? { previousRoot } : {}),
      }));
      const env = { AKARI_HOME: home };
      const migrated = state === 'migrating' || state === 'done';
      const write = migrated ? root : previousRootPresent ? previousRoot : legacy;
      const read = migrated
        ? previousRootPresent ? [root, previousRoot, legacy] : [root, legacy]
        : previousRootPresent ? [previousRoot, legacy] : [legacy];
      const source = migrated || previousRootPresent ? 'location' : 'legacy';
      assert.deepEqual(resolveAssetLibraryRoots(env), { write, read, source });
      assert.equal(resolveAkariAssetsDir(env), write);
      const override = path.join(temp, 'override');
      assert.deepEqual(resolveAssetLibraryRoots({ ...env, AKARI_LIBRARY_ROOT: override }), {
        write: override,
        read: previousRootPresent ? [override, previousRoot, legacy] : [override, legacy],
        source: 'env',
      });
    });
  }
}

test('read roots deduplicate by realpath, including the temp directory alias', async t => {
  const temp = await fs.mkdtemp(path.join(tmpdir(), 'library-realpath-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const home = path.join(temp, 'home');
  const legacy = path.join(home, 'assets');
  const alias = path.join(temp, 'alias');
  await fs.mkdir(legacy, { recursive: true });
  await fs.symlink(legacy, alias, 'dir');
  await fs.writeFile(path.join(home, 'library-location.json'), JSON.stringify({
    version: 0, root: path.join(temp, 'next'), state: 'migrating', previousRoot: alias,
  }));
  assert.deepEqual(resolveAssetLibraryRoots({ AKARI_HOME: home }).read, [path.join(temp, 'next'), alias]);
});

test('default library roots find an asset under previousRoot', async t => {
  const temp = await fs.mkdtemp(path.join(tmpdir(), 'library-previous-fallback-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const home = path.join(temp, 'home');
  const previousRoot = path.join(temp, 'previous');
  const file = path.join(previousRoot, 'still/card/frame.png');
  await fs.mkdir(home);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, 'previous asset');
  await fs.writeFile(path.join(home, 'library-location.json'), JSON.stringify({
    version: 0, root: path.join(temp, 'next'), state: 'migrating', previousRoot,
  }));
  const oldHome = process.env.AKARI_HOME;
  const oldOverride = process.env.AKARI_LIBRARY_ROOT;
  process.env.AKARI_HOME = home;
  delete process.env.AKARI_LIBRARY_ROOT;
  t.after(() => {
    if (oldHome === undefined) delete process.env.AKARI_HOME;
    else process.env.AKARI_HOME = oldHome;
    if (oldOverride === undefined) delete process.env.AKARI_LIBRARY_ROOT;
    else process.env.AKARI_LIBRARY_ROOT = oldOverride;
  });
  const result = resolveLibraryFallback({
    projectRoot: path.join(temp, 'project'),
    declaredPath: 'assets/still/card/frame.png',
    references: [{ category: 'still', id: 'card' }],
  });
  assert.deepEqual(result, {
    matched: true, path: await fs.realpath(file), libraryRoot: await fs.realpath(previousRoot),
  });
});
