import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fetchEntitlements } from '../src/entitlements.mjs';
import { setupFixtureEnv } from './helpers.mjs';

test('entitlements: store-credentials.json が無ければ no_credentials + 空集合', async () => {
  const { env } = setupFixtureEnv();
  const fetchImpl = async () => {
    throw new Error('credentials が無いのに fetch してはいけない');
  };
  const result = await fetchEntitlements({ env, fetchImpl });
  assert.equal(result.status, 'no_credentials');
  assert.equal(result.ids.size, 0);
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
  const result = await fetchEntitlements({ env, fetchImpl });
  assert.equal(result.status, 'ok');
  assert.deepEqual([...result.ids].sort(), ['a', 'b']);
});

test('entitlements: ネットワーク失敗は error + 空集合で無料のみへフォールバック', async () => {
  const { env, home } = setupFixtureEnv();
  writeFileSync(
    path.join(home, 'store-credentials.json'),
    `${JSON.stringify({ url: 'https://example.invalid/api/store', token: 'akst_broken' }, null, 2)}\n`,
  );

  const networkDown = async () => { throw new Error('network down'); };
  const result = await fetchEntitlements({ env, fetchImpl: networkDown });
  assert.equal(result.status, 'error');
  assert.equal(result.ids.size, 0);
});

test('entitlements: HTTP 401 / 403 は unauthorized + 空集合', async () => {
  const { env, home } = setupFixtureEnv();
  writeFileSync(
    path.join(home, 'store-credentials.json'),
    `${JSON.stringify({ url: 'https://example.invalid/api/store', token: 'akst_revoked' }, null, 2)}\n`,
  );
  for (const status of [401, 403]) {
    const result = await fetchEntitlements({ env, fetchImpl: async () => ({ ok: false, status }) });
    assert.equal(result.status, 'unauthorized');
    assert.equal(result.ids.size, 0);
  }
});

test('entitlements: response body error=token_revoked は HTTP status に関わらず unauthorized', async () => {
  const { env, home } = setupFixtureEnv();
  writeFileSync(
    path.join(home, 'store-credentials.json'),
    `${JSON.stringify({ url: 'https://example.invalid/api/store', token: 'akst_revoked' }, null, 2)}\n`,
  );
  const result = await fetchEntitlements({
    env,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ error: 'token_revoked' }) }),
  });
  assert.equal(result.status, 'unauthorized');
  assert.equal(result.ids.size, 0);
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
