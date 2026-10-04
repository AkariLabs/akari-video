import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { composeState } from '../src/state.mjs';
import { resolve, AssetResolverError } from '../src/resolve.mjs';
import { setupFixtureEnv } from './helpers.mjs';

function saveCatalog(fixture) {
  writeFileSync(fixture.catalogPath, `${JSON.stringify(fixture.catalog)}\n`);
}

test('explicit free beats old positive price; explicit pro beats old zero price in list and fetch', async () => {
  const fixture = setupFixtureEnv();
  const [free, pro] = fixture.catalog.items;
  free.tier = 'free';
  free.price = 500;
  pro.tier = 'pro';
  pro.price = 0;
  saveCatalog(fixture);

  const state = await composeState({ env: fixture.env });
  assert.equal(state.items.find(item => item.id === free.id).state, 'available');
  assert.equal(state.items.find(item => item.id === pro.id).state, 'locked');
  await assert.rejects(() => resolve(pro.id, { env: fixture.env }),
    error => error instanceof AssetResolverError && error.code === 'locked');
  const result = await resolve(free.id, { env: fixture.env });
  assert.equal(result.cached, false);
  assert.ok(existsSync(path.join(fixture.home, 'assets', free.category, free.id, 'meta.json')));
});

test('legacy metadata uses positive price as pro and null or absent price as free', async () => {
  const fixture = setupFixtureEnv();
  const [free, pro] = fixture.catalog.items;
  delete free.tier;
  free.price = null;
  delete pro.tier;
  pro.price = 500;
  saveCatalog(fixture);
  const state = await composeState({ env: fixture.env });
  assert.equal(state.items.find(item => item.id === free.id).tier, 'free');
  assert.equal(state.items.find(item => item.id === pro.id).tier, 'pro');
  assert.equal(state.items.find(item => item.id === pro.id).state, 'locked');
  await assert.rejects(() => resolve(pro.id, { env: fixture.env }),
    error => error instanceof AssetResolverError && error.code === 'locked');
  delete free.price;
  saveCatalog(fixture);
  assert.equal((await composeState({ env: fixture.env })).items.find(item => item.id === free.id).state, 'available');
});

test('unknown explicit tier fails closed in list and fetch', async () => {
  const fixture = setupFixtureEnv();
  fixture.catalog.items[0].tier = 'unknown';
  fixture.catalog.items[0].price = 0;
  saveCatalog(fixture);
  assert.equal((await composeState({ env: fixture.env })).items.find(item => item.id === 'mini-still').state, 'locked');
  await assert.rejects(() => resolve('mini-still', { env: fixture.env }),
    error => error instanceof AssetResolverError && error.code === 'locked');
});

test('all-access-pass unlocks a Pro item for list and fetch', async () => {
  const fixture = setupFixtureEnv();
  fixture.catalog.items[1].tier = 'pro';
  fixture.catalog.items[1].price = 0;
  saveCatalog(fixture);
  writeFileSync(path.join(fixture.home, 'store-credentials.json'), JSON.stringify({ url: 'https://example.invalid/api/store', token: 'akst_test' }));
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ entitlements: [{ product_id: 'all-access-pass' }] }) });
  const state = await composeState({ env: fixture.env, fetchImpl });
  assert.equal(state.items.find(item => item.id === 'mini-paid').state, 'available');
  const result = await resolve('mini-paid', { env: fixture.env, fetchImpl });
  assert.equal(result.cached, false);
});
