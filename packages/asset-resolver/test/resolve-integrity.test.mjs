import assert from 'node:assert/strict';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { AssetResolverError, resolve as resolveAsset } from '../src/resolve.mjs';
import { setupFixtureEnv } from './helpers.mjs';

test('resolve: sha256 不一致は fail-closed（登録されず、部分ファイルも残らない）', async () => {
  const { env, home, catalog, catalogPath } = setupFixtureEnv();

  // 配信元カタログの sha256 を改竄する（サーバ側が返す値が実ファイルと食い違うケースの模擬）
  const tampered = structuredClone(catalog);
  const item = tampered.items.find((i) => i.id === 'mini-still');
  const metaFile = item.files.find((f) => f.name === 'meta.json');
  metaFile.sha256 = '0'.repeat(64);
  writeFileSync(catalogPath, `${JSON.stringify(tampered, null, 2)}\n`);

  await assert.rejects(
    () => resolveAsset('mini-still', { env }),
    (error) => {
      assert.ok(error instanceof AssetResolverError);
      assert.equal(error.code, 'integrity');
      return true;
    },
  );

  const destDir = path.join(home, 'assets', 'still', 'mini-still');
  assert.equal(existsSync(destDir), false, '登録先が作られていないこと');

  const stray = readdirSync(home).filter((name) => name.startsWith('.tmp-resolve-'));
  assert.deepEqual(stray, [], '一時ディレクトリが破棄されていること');
});
