import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fetchEntitlements } from '../src/entitlements.mjs';
import { setupFixtureEnv } from './helpers.mjs';

test('entitlements: store-credentials.json が無ければ無料のみ（空集合）', async () => {
  const { env } = setupFixtureEnv();
  const fetchImpl = async () => {
    throw new Error('credentials が無いのに fetch してはいけない');
  };
  const entitlements = await fetchEntitlements({ env, fetchImpl });
  assert.equal(entitlements.size, 0);
});

test('entitlements: 接続済みなら API の結果を Set にして返す', async () => {
  const { env, home } = setupFixtureEnv();
  writeFileSync(
    path.join(home, 'store-credentials.json'),
    `${JSON.stringify({ url: 'https://example.invalid/api/store', token: 'akst_ok' }, null, 2)}\n`,
  );
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ entitlements: [{ product_id: 'a' }, { product_id: 'b' }] }),
  });
  const entitlements = await fetchEntitlements({ env, fetchImpl });
  assert.deepEqual([...entitlements].sort(), ['a', 'b']);
});

test('entitlements: fetch 失敗（オフライン・401 等）は「不明」として無料のみへフォールバック', async () => {
  const { env, home } = setupFixtureEnv();
  writeFileSync(
    path.join(home, 'store-credentials.json'),
    `${JSON.stringify({ url: 'https://example.invalid/api/store', token: 'akst_broken' }, null, 2)}\n`,
  );

  const networkDown = async () => { throw new Error('network down'); };
  assert.equal((await fetchEntitlements({ env, fetchImpl: networkDown })).size, 0);

  const unauthorized = async () => ({ ok: false, status: 401 });
  assert.equal((await fetchEntitlements({ env, fetchImpl: unauthorized })).size, 0);
});

test('entitlements: AKARI_STORE_API で明示上書きできる', async () => {
  const { home } = setupFixtureEnv();
  writeFileSync(
    path.join(home, 'store-credentials.json'),
    `${JSON.stringify({ url: 'https://example.invalid/api/store', token: 'akst_ok' }, null, 2)}\n`,
  );
  const env = { AKARI_HOME: home, AKARI_STORE_API: 'https://override.invalid' };
  const seen = [];
  const fetchImpl = async (url) => { seen.push(String(url)); return { ok: true, json: async () => ({ entitlements: [] }) }; };
  await fetchEntitlements({ env, fetchImpl });
  assert.deepEqual(seen, ['https://override.invalid/api/store/v1/entitlements']);
});
