import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { cacheCatalog } from '../src/catalog.mjs';
import { localAssetDir } from '../src/library.mjs';
import { fetchEntitlements } from '../src/entitlements.mjs';
import { downloadPaidZip } from '../src/paid-zip.mjs';
import { resolve } from '../src/resolve.mjs';
import { setupFixtureEnv } from './helpers.mjs';

function fixture(fileCount = 1) {
  const { env, home } = setupFixtureEnv({
    AKARI_ASSETS_CATALOG: 'https://unit.invalid/catalog',
    AKARI_ASSETS_BASE: 'https://unit.invalid/files',
  });
  const item = { id: 'fast-audio', category: 'audio', price: 0,
    files: Array.from({ length: fileCount }, (_, i) => ({ name: 'part-' + i + '.bin', key: 'part-' + i + '.bin' })) };
  const catalog = { schema: 'akari-assets-catalog/v0', base: 'https://unit.invalid/files', items: [item] };
  return { env, home, item, catalog };
}

test('取得済み id はカタログもファイルも通信しない', async () => {
  const { env, item, catalog } = fixture();
  await cacheCatalog(env, catalog);
  const dir = localAssetDir(env, item.category, item.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'part-0.bin'), 'ready');
  let calls = 0;
  const result = await resolve(item.id, { env, fetchImpl: async () => { calls++; throw Error('unexpected fetch'); } });
  assert.equal(result.cached, true);
  assert.equal(calls, 0);
});

test('category/id の手元素材はカタログファイルが無くても配置できる', async () => {
  const { env, item } = fixture();
  env.AKARI_ASSETS_CATALOG = '/missing-catalog.json';
  const dir = localAssetDir(env, item.category, item.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'part-0.bin'), 'ready');
  const result = await resolve(`${item.category}/${item.id}`, { env,
    fetchImpl: async () => { throw Error('catalog was fetched'); } });
  assert.equal(result.cached, true);
  assert.equal(result.dir, dir);
});

test('控えに id があれば未取得でもファイルだけ取得する', async () => {
  const { env, item, catalog } = fixture();
  await cacheCatalog(env, catalog);
  const urls = [];
  const result = await resolve(item.id, { env, fetchImpl: async url => {
    urls.push(url);
    return new Response('file');
  } });
  assert.equal(result.cached, false);
  assert.deepEqual(urls, ['https://unit.invalid/files/part-0.bin']);
});

test('控えに id がなければカタログを取り直す', async () => {
  const { env, item, catalog } = fixture();
  await cacheCatalog(env, { ...catalog, items: [] });
  const urls = [];
  await resolve(item.id, { env, fetchImpl: async url => {
    urls.push(url);
    return new Response(url.endsWith('/catalog') ? JSON.stringify(catalog) : 'file');
  } });
  assert.deepEqual(urls, ['https://unit.invalid/catalog', 'https://unit.invalid/files/part-0.bin']);
});

test('応答停止は短い時間切れで失敗し、一時ファイルを残さない', async () => {
  const { env, home, item, catalog } = fixture(4);
  await cacheCatalog(env, catalog);
  await assert.rejects(
    resolve(item.id, { env, timeouts: { responseMs: 30, idleMs: 30 }, fetchImpl: async url =>
      url.endsWith('part-0.bin') ? new Promise(() => {}) : new Response('file') }),
    /時間切れ/,
  );
  assert.equal(existsSync(localAssetDir(env, item.category, item.id)), false);
  const roots = [home, path.dirname(localAssetDir(env, item.category, item.id))];
  for (const root of roots) {
    if (existsSync(root)) assert.equal(readdirSync(root).some(name => name.startsWith('.tmp-resolve-')), false);
  }
});

test('4 ファイルは少なくとも 2 本を同時に転送する', async () => {
  const { env, item, catalog } = fixture(4);
  await cacheCatalog(env, catalog);
  let active = 0, peak = 0;
  await resolve(item.id, { env, fetchImpl: async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise(done => setTimeout(done, 15));
    active--;
    return new Response('file');
  } });
  assert.ok(peak >= 2, 'peak=' + peak);
});

test('転送開始後にバイトが止まれば時間切れで一時ファイルを消す', async () => {
  const { env, item, catalog } = fixture();
  await cacheCatalog(env, catalog);
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); } });
  await assert.rejects(
    resolve(item.id, { env, timeouts: { responseMs: 30, idleMs: 30 },
      fetchImpl: async () => new Response(body) }),
    /転送.*時間切れ/,
  );
  assert.equal(existsSync(localAssetDir(env, item.category, item.id)), false);
});

test('控えに無い id のカタログ応答停止は時間切れの理由を返す', async () => {
  const { env, item, catalog } = fixture();
  await cacheCatalog(env, { ...catalog, items: [] });
  await assert.rejects(
    resolve(item.id, { env, timeouts: { responseMs: 30, idleMs: 30 },
      fetchImpl: async () => new Promise(() => {}) }),
    /カタログ.*時間切れ/,
  );
});

test('権利確認の応答停止は理由を持つ error で終わる', async () => {
  const { env, home } = fixture();
  writeFileSync(path.join(home, 'store-credentials.json'), JSON.stringify({ token: 'test' }));
  const result = await fetchEntitlements({ env, timeouts: { responseMs: 20, idleMs: 20 },
    fetchImpl: async () => new Promise(() => {}) });
  assert.equal(result.status, 'error');
  assert.match(result.error, /権利確認.*時間切れ/);
});

test('有料 zip の応答停止は理由を返す', async () => {
  const { env, home } = fixture();
  await assert.rejects(downloadPaidZip('paid-one', { token: 'test' }, path.join(home, 'paid.zip'),
    { env, timeouts: { responseMs: 20, idleMs: 20 }, fetchImpl: async () => new Promise(() => {}) }),
  /有料 zip.*時間切れ/);
});

test('壊れたカタログの控えは取り直す', async () => {
  const { env, home, item, catalog } = fixture();
  writeFileSync(path.join(home, 'catalog-cache.json'), '{broken');
  const urls = [];
  await resolve(item.id, { env, fetchImpl: async url => {
    urls.push(url);
    return new Response(url.endsWith('/catalog') ? JSON.stringify(catalog) : 'file');
  } });
  assert.deepEqual(urls, ['https://unit.invalid/catalog', 'https://unit.invalid/files/part-0.bin']);
});
