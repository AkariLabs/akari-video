import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { cacheCatalog, loadCatalog, readCatalogCache } from '../src/catalog.mjs';
import { composeState } from '../src/state.mjs';
import { setupFixtureEnv } from './helpers.mjs';

test('loadCatalog はローカルパス指定のカタログを読める', async () => {
  const { env, catalog } = setupFixtureEnv();
  const loaded = await loadCatalog({ env });
  assert.equal(loaded.schema, 'akari-assets-catalog/v0');
  assert.equal(loaded.items.length, catalog.items.length);
});

test('catalog cache drops files for locked and Pro items before writing and on old-cache reads', async () => {
  const { env, home, catalog } = setupFixtureEnv();
  catalog.items[0].tier = 'free';
  catalog.items[1].tier = 'pro';
  catalog.items[1].files = [{ name: 'private.zip', url: 'https://example.invalid/private.zip' }];
  catalog.items.push({ id: 'locked-free', category: 'audio', tier: 'free', state: 'locked', files: [{ name: 'secret.mp3', url: 'https://example.invalid/secret.mp3' }] });
  await cacheCatalog(env, catalog);
  const cachePath = path.join(home, 'catalog-cache.json');
  const saved = JSON.parse(readFileSync(cachePath, 'utf8'));
  assert.ok(saved.items[0].files.length > 0);
  assert.equal(Object.hasOwn(saved.items[1], 'files'), false);
  assert.equal(Object.hasOwn(saved.items[2], 'files'), false);
  assert.ok(catalog.items[1].files.length > 0, 'caller catalog is not mutated');

  writeFileSync(cachePath, JSON.stringify(catalog));
  const oldCache = await readCatalogCache(env);
  assert.equal(Object.hasOwn(oldCache.items[1], 'files'), false);
  assert.equal(Object.hasOwn(oldCache.items[2], 'files'), false);
});

test('composeState: entitlements 無しでは無料素材が available・有料素材が locked', async () => {
  const { env } = setupFixtureEnv();
  const { items, home, entitlementsStatus } = await composeState({ env });
  assert.equal(items.length, 2);

  const free = items.find((i) => i.id === 'mini-still');
  const paid = items.find((i) => i.id === 'mini-paid');
  assert.equal(free.state, 'available');
  assert.equal(paid.state, 'locked');
  assert.equal(Object.hasOwn(paid, 'files'), false);
  assert.equal(entitlementsStatus, 'no_credentials');
  assert.ok(home.endsWith('home') || home.includes('home'));
});

test('composeState: entitlements 取得失敗の status を返しつつ locked 判定は変えない', async () => {
  const { env, home } = setupFixtureEnv();
  writeFileSync(
    path.join(home, 'store-credentials.json'),
    `${JSON.stringify({ url: 'https://example.invalid/api/store', token: 'akst_revoked' }, null, 2)}\n`,
  );
  const { items, entitlementsStatus } = await composeState({
    env,
    fetchImpl: async () => ({ ok: false, status: 401 }),
  });
  assert.equal(entitlementsStatus, 'unauthorized');
  assert.equal(items.find((item) => item.id === 'mini-paid').state, 'locked');
});

test('composeState strips files from a locked Pro item even if catalog includes them', async () => {
  const { env, catalog, catalogPath } = setupFixtureEnv();
  catalog.items[1].files = [{ name: 'payload.mp3', url: 'https://example.invalid/private.mp3' }];
  writeFileSync(catalogPath, JSON.stringify(catalog));
  const item = (await composeState({ env })).items.find(entry => entry.id === 'mini-paid');
  assert.equal(item.state, 'locked');
  assert.equal(Object.hasOwn(item, 'files'), false);
});

test('a product or item entitlement does not unlock Pro without all-access-pass', async () => {
  const { env, home } = setupFixtureEnv();
  writeFileSync(path.join(home, 'store-credentials.json'), JSON.stringify({ url: 'https://example.invalid/api/store', token: 'akst_test' }));
  const state = await composeState({ env, fetchImpl: async () => ({ ok: true, json: async () => ({ entitlements: [{ product_id: 'mini-paid' }] }) }) });
  assert.equal(state.items.find(item => item.id === 'mini-paid').state, 'locked');
});

test('composeState: ローカルに実体があるものは cached になる', async () => {
  const { env, home } = setupFixtureEnv();
  const dir = path.join(home, 'assets', 'still', 'mini-still');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'dummy.txt'), 'already here\n');

  const { items } = await composeState({ env });
  const free = items.find((i) => i.id === 'mini-still');
  assert.equal(free.state, 'cached');
});

test('composeState: legacy local-only metadata without tier displays free while catalog stays fail-closed', async () => {
  const { env, home, catalog, catalogPath } = setupFixtureEnv();
  const dir = path.join(home, 'assets', 'audio', 'old-local');
  mkdirSync(dir, { recursive: true });
  const source = { url: 'https://example.invalid/old-local.wav', acquisition: 'direct' };
  writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ id: 'old-local', title: 'Old Local', category: 'audio', tags: [], license: {}, price: null, source }));
  writeFileSync(path.join(dir, 'take.wav'), 'audio');
  delete catalog.items[0].tier;
  delete catalog.items[0].price;
  writeFileSync(catalogPath, JSON.stringify(catalog));

  const { items } = await composeState({ env });
  const local = items.find(item => item.id === 'old-local');
  assert.deepEqual(local.source, source);
  assert.equal(local.tier, 'free');
  assert.ok(local.machineTags.includes('tier:free'));
  assert.equal(items.find(item => item.id === 'mini-still').tier, 'pro');
});

test('composeState: entitledProducts に kit 商品を載せ、資格情報なしでは空配列にする', async () => {
  const connected = setupFixtureEnv();
  writeFileSync(
    path.join(connected.home, 'store-credentials.json'),
    `${JSON.stringify({ url: 'https://example.invalid/api/store', token: 'akst_test' }, null, 2)}\n`,
  );
  let fetchCount = 0;
  const state = await composeState({
    env: connected.env,
    fetchImpl: async () => {
      fetchCount += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          entitlements: [{ product_id: 'world-kit', kind: 'kit', current_version: 3 }],
        }),
      };
    },
  });
  assert.deepEqual(state.entitledProducts, [{ id: 'world-kit', kind: 'kit', currentVersion: 3 }]);
  assert.equal(fetchCount, 2);

  const disconnected = setupFixtureEnv();
  let disconnectedFetchCount = 0;
  const disconnectedState = await composeState({
    env: disconnected.env,
    fetchImpl: async () => {
      disconnectedFetchCount += 1;
      throw new Error('資格情報なしでは呼ばれない');
    },
  });
  assert.deepEqual(disconnectedState.entitledProducts, []);
  assert.equal(disconnectedFetchCount, 0);
});
