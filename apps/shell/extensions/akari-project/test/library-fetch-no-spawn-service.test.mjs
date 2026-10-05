import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { AkariProjectServiceImpl } from '../lib/node/akari-project-service.js';
import { setupFixtureEnv } from '../../../../../packages/asset-resolver/test/helpers.mjs';

const resolverSrc = fileURLToPath(new URL('../../../../../packages/asset-resolver/src/', import.meta.url));
class Service extends AkariProjectServiceImpl {
  async findAssetResolverSrcDir() { return resolverSrc; }
  async runResolverScript() { throw new Error('子プロセスを起動した'); }
}

async function fixture(t) {
  const f = setupFixtureEnv();
  const project = await mkdtemp(join(tmpdir(), 'library-fetch-project-'));
  await mkdir(join(project, '.akari'));
  const names = ['AKARI_HOME', 'AKARI_LIBRARY_ROOT', 'AKARI_CREATOR_ROOT', 'AKARI_ASSETS_CATALOG', 'HOME', 'USERPROFILE'];
  const old = Object.fromEntries(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { ...f.env, AKARI_LIBRARY_ROOT: join(f.root, 'library') });
  t.after(async () => {
    for (const name of names) {
      if (old[name] === undefined) delete process.env[name]; else process.env[name] = old[name];
    }
    await rm(project, { recursive: true, force: true });
    await rm(f.root, { recursive: true, force: true });
  });
  return { f, project, uri: pathToFileURL(project).href, service: new Service() };
}

test('resolveAsset はローカルカタログの実 resolver を同一プロセスで実行する', async t => {
  const f = await fixture(t);
  const result = await f.service.resolveAsset('still/mini-still', f.uri);
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(result.reference, true);
  assert.deepEqual((await f.service.listProjectAssetReferences(f.uri)).map(item => item.id), ['mini-still']);
  assert.ok((await f.service.projectCredits(f.uri)).length >= 0);
  assert.ok((await readFile(join(f.project, '.akari', 'asset-references.json'), 'utf8')).includes('mini-still'));
});

test('業務エラーは子プロセスへフォールバックしない', async t => {
  const f = await fixture(t);
  const result = await f.service.resolveAsset('still/missing', f.uri);
  assert.equal(result.success, false);
  assert.match(result.error, /missing/);
});

test('モジュール読み込み失敗時だけ従来経路を使う', async t => {
  const f = await fixture(t);
  let calls = 0;
  f.service.findAssetResolverSrcDir = async () => join(f.project, 'missing-src');
  f.service.runResolverScript = async () => {
    calls++;
    return { code: 0, stdout: JSON.stringify({ success: false, error: 'fallback' }), stderr: '' };
  };
  assert.deepEqual(await f.service.resolveAsset('still/missing', f.uri), { success: false, error: 'fallback' });
  assert.equal(calls, 1);
});

test('placeLibraryAsset も参照台帳と使用履歴を子プロセスなしで書く', async t => {
  const f = await fixture(t);
  const libraryDir = join(process.env.AKARI_LIBRARY_ROOT, 'still', 'placed');
  await mkdir(libraryDir, { recursive: true });
  await writeFile(join(libraryDir, 'picture.png'), 'image');
  const result = await f.service.placeLibraryAsset({ category: 'still', id: 'placed', libraryDir }, f.uri);
  assert.equal(result.success, true, JSON.stringify(result));
  assert.deepEqual((await f.service.listProjectAssetReferences(f.uri)).map(item => item.id), ['placed']);
  assert.deepEqual(await f.service.projectCredits(f.uri), []);
  await f.service.recordLibraryUsage('still', 'placed', f.uri);
  assert.equal((await f.service.getLibraryUsage())['still/placed'].count, 2);
  await f.service.removeProjectAssetReference(f.uri, { category: 'still', id: 'placed' });
  assert.deepEqual(await f.service.listProjectAssetReferences(f.uri), []);
});
