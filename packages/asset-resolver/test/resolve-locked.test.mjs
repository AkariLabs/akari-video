import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { AssetResolverError, resolve as resolveAsset } from '../src/resolve.mjs';
import { setupFixtureEnv } from './helpers.mjs';

test('resolve: 未購入の有料素材は locked で拒否され、何も登録されない', async () => {
  const { env, home } = setupFixtureEnv();

  await assert.rejects(
    () => resolveAsset('mini-paid', { env }),
    (error) => {
      assert.ok(error instanceof AssetResolverError);
      assert.equal(error.code, 'locked');
      assert.match(error.message, /500/);
      return true;
    },
  );

  assert.equal(existsSync(path.join(home, 'assets', 'still', 'mini-paid')), false);
});

test('resolve: entitlements に含まれていれば有料素材も解決できる', async () => {
  const { env, home } = setupFixtureEnv();
  writeFileSync(
    path.join(home, 'store-credentials.json'),
    `${JSON.stringify({ url: 'https://example.invalid/api/store', token: 'akst_test', email: 'demo@example.invalid' }, null, 2)}\n`,
  );

  const fetchImpl = async (url, options = {}) => {
    if (String(url).endsWith('/v1/entitlements')) {
      assert.equal(options.headers?.authorization, 'Bearer akst_test');
      return {
        ok: true,
        json: async () => ({ entitlements: [{ product_id: 'mini-paid' }] }),
      };
    }
    throw new Error(`想定外の fetch 呼び出し: ${url}`);
  };

  const result = await resolveAsset('mini-paid', { env, fetchImpl });
  assert.equal(result.cached, false);
  assert.ok(existsSync(path.join(home, 'assets', 'still', 'mini-paid', 'meta.json')));
});
