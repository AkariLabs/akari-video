import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync
} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { isAssetCached, scanLocalLibrary } from '../src/library.mjs';
import { resolve as resolveAsset } from '../src/resolve.mjs';
import { setupFixtureEnv } from './helpers.mjs';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

test('キット素材の symlink 越し fetch はプロジェクトへ実体をコピーする', async () => {
  const { env, home, root } = setupFixtureEnv();
  try {
    const id = 'sample-kit-frame';
    const category = 'overlay';
    const packRoot = path.join(home, 'assets', 'store', 'sample-kit');
    const assetRoot = path.join(packRoot, 'assets', category, id);
    const fragment = '<div>sample kit frame</div>\n';
    mkdirSync(assetRoot, { recursive: true });
    writeFileSync(path.join(assetRoot, 'fragment.html'), fragment);
    mkdirSync(path.join(home, 'assets', category), { recursive: true });
    symlinkSync(path.relative(path.join(home, 'assets', category), assetRoot), path.join(home, 'assets', category, id), 'dir');
    writeFileSync(path.join(home, 'assets', 'installed.json'), `${JSON.stringify({
      schema: 'akari-installed-assets/v0',
      packs: {
        'sample-kit': {
          version: 1,
          installedAt: '2026-09-14T00:00:00.000Z',
          root: packRoot,
          items: [{
            id,
            title: 'Sample Kit Frame',
            path: `assets/${category}/${id}`,
            version: 1,
            files: [{ path: 'fragment.html', bytes: Buffer.byteLength(fragment), sha256: sha256(fragment) }]
          }]
        }
      }
    }, null, 2)}\n`);

    assert.equal(isAssetCached(home, category, id), true);
    assert.equal(scanLocalLibrary(home).has(`${category}/${id}`), true);
    const project = path.join(root, 'project');
    const result = await resolveAsset(id, { env, project });
    assert.equal(result.cached, true);
    assert.equal(lstatSync(result.projectDir).isSymbolicLink(), false);
    assert.equal(readFileSync(path.join(result.projectDir, 'fragment.html'), 'utf8'), fragment);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('壊れた素材 symlink は cached 扱いにもローカル一覧にも入れない', () => {
  const { home, root } = setupFixtureEnv();
  try {
    const categoryDir = path.join(home, 'assets', 'overlay');
    mkdirSync(categoryDir, { recursive: true });
    symlinkSync('../../store/missing/assets/overlay/broken-frame', path.join(categoryDir, 'broken-frame'), 'dir');
    assert.equal(isAssetCached(home, 'overlay', 'broken-frame'), false);
    assert.equal(scanLocalLibrary(home).has('overlay/broken-frame'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
