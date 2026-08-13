import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadCatalog } from '../src/catalog.mjs';
import { composeState } from '../src/state.mjs';
import { setupFixtureEnv } from './helpers.mjs';

test('loadCatalog はローカルパス指定のカタログを読める', async () => {
  const { env, catalog } = setupFixtureEnv();
  const loaded = await loadCatalog({ env });
  assert.equal(loaded.schema, 'akari-assets-catalog/v0');
  assert.equal(loaded.items.length, catalog.items.length);
});

test('composeState: entitlements 無しでは無料素材が available・有料素材が locked', async () => {
  const { env } = setupFixtureEnv();
  const { items, home, entitlementsStatus } = await composeState({ env });
  assert.equal(items.length, 2);

  const free = items.find((i) => i.id === 'mini-still');
  const paid = items.find((i) => i.id === 'mini-paid');
  assert.equal(free.state, 'available');
  assert.equal(paid.state, 'locked');
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

test('composeState: ローカルに実体があるものは cached になる', async () => {
  const { env, home } = setupFixtureEnv();
  const dir = path.join(home, 'assets', 'still', 'mini-still');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'dummy.txt'), 'already here\n');

  const { items } = await composeState({ env });
  const free = items.find((i) => i.id === 'mini-still');
  assert.equal(free.state, 'cached');
});
