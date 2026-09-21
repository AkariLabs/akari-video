// Same case table in render-cut and edit-lint. Neither runtime depends on creator-root.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveAssetLibraryRoots, resolveLibraryFallback } from '../src/library-reference.mjs';
import { resolveAssetLibraryRoots as canonical } from '../../creator-root/src/index.mjs';

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
  const outside = path.join(temp, 'outside'); await fs.writeFile(outside, 'outside');
  for (let index = 0; index < roots.length; index++) {
    const file = path.join(roots[index], 'still/card/frame.png');
    await fs.mkdir(path.dirname(file), { recursive: true });
    if (entry.files[index] === 'escape') await fs.symlink(outside, file);
    else if (entry.files[index] === 'directory') await fs.mkdir(file);
    else if (entry.files[index]) await fs.writeFile(file, String(index));
  }
  const result = resolveLibraryFallback({ projectRoot: path.join(temp, 'project'),
    declaredPath: entry.declaredPath ?? 'assets/still/card/frame.png',
    references: entry.references ?? [{ category: 'still', id: 'card' }], libraryRoots: roots });
  if (entry.winner === null) { assert.equal(result.path, null); assert.equal(result.libraryRoot, null); }
  else {
    assert.equal(result.path, await fs.realpath(path.join(roots[entry.winner], 'still/card/frame.png')));
    assert.equal(result.libraryRoot, await fs.realpath(roots[entry.winner]));
  }
});

test('resolver mirror matches canonical env/location/legacy table', async t => {
  const temp = await fs.mkdtemp(path.join(tmpdir(), 'library-location-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const home = path.join(temp, 'home'); await fs.mkdir(home);
  for (const value of [null, '{', {}, { version: 99, root: temp, state: 'done' },
    ...['pending', 'migrating', 'done', 'declined'].map(state => ({ version: 0, root: path.join(temp, 'library'), state }))]) {
    const file = path.join(home, 'library-location.json');
    if (value === null) await fs.rm(file, { force: true });
    else await fs.writeFile(file, typeof value === 'string' ? value : JSON.stringify(value));
    for (const override of [undefined, path.join(temp, 'override'), path.join(home, 'assets')]) {
      const env = { AKARI_HOME: home, AKARI_LIBRARY_ROOT: override };
      const result = resolveAssetLibraryRoots(env);
      assert.deepEqual(result, canonical(env));
      // Explicit expectations prevent the mirrors and canonical resolver drifting together.
      const active = value && value.version === 0 && ['migrating', 'done'].includes(value.state);
      const expectedWrite = override || (active ? path.join(temp, 'library') : path.join(home, 'assets'));
      assert.equal(result.write, expectedWrite);
      assert.equal(result.source, override ? 'env' : active ? 'location' : 'legacy');
      assert.deepEqual(result.read, [...new Set([expectedWrite, path.join(home, 'assets')])]);
    }
  }
  for (const env of [{ HOME: temp }, { USERPROFILE: temp }, { HOMEDRIVE: temp, HOMEPATH: '/profile' }]) {
    assert.deepEqual(resolveAssetLibraryRoots(env, { platform: 'win32' }), canonical(env, { platform: 'win32' }));
  }
});
