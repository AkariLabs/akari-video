// 有料素材の zip 取得経路（resolvePaidZip。契約 §6/§8）のテスト。
// カタログ item に files[] を持たせず、entitled 判定 → `/v1/download/<id>` から zip 取得 →
// checksums.txt 検証 → validate-asset → ~/.akari/assets/<category>/<id>/ 登録までを確認する。
// zip の作成/展開は実体（システムの zip/unzip CLI）を使う — 外部 npm 依存を増やさない設計を
// テスト側でも踏襲する（worker/tools/publish-paid.mjs と対称）。

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { AssetResolverError, resolve as resolveAsset } from '../src/resolve.mjs';
import { setupFixtureEnv } from './helpers.mjs';

const MINI_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function paidMetaBuffer(id, category) {
  const meta = {
    id,
    category,
    title: `フィクスチャ有料素材 ${id}`,
    description: 'asset-resolver 有料経路のテスト用フィクスチャ',
    when_to_use: 'テストのみ',
    tags: ['fixture', 'paid'],
    knobs: [],
    ai_usage: 'テスト用途のみ',
    requires: [],
    provenance: { origin: 'asset-resolver test fixture', generator: null },
    author: 'test',
    license: { spdx: 'LicenseRef-fixture', scope: 'paid-license-required', attribution_required: false, ai_training_allowed: false },
    price: 2980,
    version: 1,
  };
  return Buffer.from(`${JSON.stringify(meta, null, 2)}\n`);
}

/**
 * 契約 §6 の zip 構成（`<id>-v<version>/` 直下に README.md / LICENSE.md / 本体 / checksums.txt）を
 * システムの `zip` コマンドで実際に作る。`corrupt: '<name>'` を指定すると、その名前の
 * checksums.txt エントリだけ sha256 を意図的にずらす（checksums 不一致テスト用）。
 */
function buildPaidZip(id, category, { corrupt } = {}) {
  const stage = mkdtempSync(path.join(tmpdir(), 'paid-zip-fixture-'));
  const rootName = `${id}-v1`;
  const rootDir = path.join(stage, rootName);
  mkdirSync(rootDir, { recursive: true });

  const payload = {
    'meta.json': paidMetaBuffer(id, category),
    'fragment.html': Buffer.from(
      `<div class="${id}-stub"><canvas></canvas><div data-akari-3d-fallback>fixture</div>`
      + '<script type="application/json" data-akari-3d-scene>{"model":"model.glb"}</script></div>\n',
    ),
    'model.glb': Buffer.from('glTF-fixture-not-a-real-binary'),
    'preview.png': MINI_PNG,
  };
  const allFiles = {
    'README.md': Buffer.from('# fixture\n'),
    'LICENSE.md': Buffer.from('fixture license\n'),
    ...payload,
  };
  for (const [name, buffer] of Object.entries(allFiles)) {
    writeFileSync(path.join(rootDir, name), buffer);
  }

  const checksumLines = Object.keys(allFiles).sort().map((name) => {
    const digest = name === corrupt ? '0'.repeat(64) : sha256(allFiles[name]);
    return `${digest}  ${name}`;
  });
  writeFileSync(path.join(rootDir, 'checksums.txt'), `${checksumLines.join('\n')}\n`);

  const zipPath = path.join(stage, `${rootName}.zip`);
  execFileSync('zip', ['-q', '-X', '-r', zipPath, rootName], { cwd: stage });
  return zipPath;
}

/** entitlements + download の両エンドポイントを模擬する fetchImpl。 */
function fetchImplFor(id, { entitled, zipPath }) {
  return async (url, options = {}) => {
    const s = String(url);
    if (s.endsWith('/v1/entitlements')) {
      assert.equal(options.headers?.authorization, 'Bearer akst_test');
      return { ok: true, json: async () => ({ entitlements: entitled ? [{ product_id: id }] : [] }) };
    }
    if (s.endsWith(`/v1/download/${id}`)) {
      assert.equal(options.headers?.authorization, 'Bearer akst_test');
      if (!zipPath) {
        return { ok: false, status: 403 };
      }
      return { ok: true, status: 200, body: Readable.toWeb(createReadStream(zipPath)) };
    }
    throw new Error(`想定外の fetch 呼び出し: ${url}`);
  };
}

function addPaidCatalogItem(catalog, catalogPath, id, category, price) {
  const withPaidItem = structuredClone(catalog);
  withPaidItem.items.push({
    id,
    category,
    title: `フィクスチャ有料素材 ${id}`,
    tags: ['fixture', 'paid'],
    license: { spdx: 'LicenseRef-fixture' },
    price,
    version: 1,
    preview: '',
    provenance: {},
    // files[] を意図的に持たせない（有料 item の実カタログ形）
  });
  writeFileSync(catalogPath, `${JSON.stringify(withPaidItem, null, 2)}\n`);
}

function writeCredentials(home) {
  writeFileSync(
    path.join(home, 'store-credentials.json'),
    `${JSON.stringify({ url: 'https://example.invalid/api/store', token: 'akst_test', email: 'demo@example.invalid' }, null, 2)}\n`,
  );
}

test('resolvePaidZip: entitled 成功 — zip 取得 → checksums 検証 → validate-asset → 登録される', async () => {
  const { env, home, catalog, catalogPath } = setupFixtureEnv();
  writeCredentials(home);
  addPaidCatalogItem(catalog, catalogPath, 'mini-paid-zip', 'scene3d', 2980);
  const zipPath = buildPaidZip('mini-paid-zip', 'scene3d');

  const result = await resolveAsset('mini-paid-zip', {
    env,
    fetchImpl: fetchImplFor('mini-paid-zip', { entitled: true, zipPath }),
  });

  assert.equal(result.cached, false);
  assert.equal(result.category, 'scene3d');
  assert.equal(result.dir, path.join(home, 'assets', 'scene3d', 'mini-paid-zip'));
  assert.ok(existsSync(path.join(result.dir, 'meta.json')));
  assert.ok(existsSync(path.join(result.dir, 'fragment.html')));
  assert.ok(existsSync(path.join(result.dir, 'model.glb')));
  assert.ok(existsSync(path.join(result.dir, 'preview.png')));
  // README.md / LICENSE.md / checksums.txt は素材ペイロードではないので登録先に持ち込まない
  assert.equal(existsSync(path.join(result.dir, 'README.md')), false);
  assert.equal(existsSync(path.join(result.dir, 'checksums.txt')), false);

  const meta = JSON.parse(readFileSync(path.join(result.dir, 'meta.json'), 'utf8'));
  assert.equal(meta.id, 'mini-paid-zip');

  const stray = readdirSync(home).filter((name) => name.startsWith('.tmp-resolve-'));
  assert.deepEqual(stray, []);
});

test('resolvePaidZip: 未購入は locked で拒否され、download エンドポイントは叩かれない', async () => {
  const { env, home, catalog, catalogPath } = setupFixtureEnv();
  writeCredentials(home);
  addPaidCatalogItem(catalog, catalogPath, 'mini-paid-zip', 'scene3d', 2980);

  await assert.rejects(
    () => resolveAsset('mini-paid-zip', {
      env,
      fetchImpl: fetchImplFor('mini-paid-zip', { entitled: false, zipPath: null }),
    }),
    (error) => {
      assert.ok(error instanceof AssetResolverError);
      assert.equal(error.code, 'locked');
      assert.match(error.message, /2,980|2980/);
      return true;
    },
  );

  assert.equal(existsSync(path.join(home, 'assets', 'scene3d', 'mini-paid-zip')), false);
});

test('resolvePaidZip: checksums 不一致は fail-closed（登録されず、部分ファイルも残らない）', async () => {
  const { env, home, catalog, catalogPath } = setupFixtureEnv();
  writeCredentials(home);
  addPaidCatalogItem(catalog, catalogPath, 'mini-paid-zip', 'scene3d', 2980);
  const zipPath = buildPaidZip('mini-paid-zip', 'scene3d', { corrupt: 'model.glb' });

  await assert.rejects(
    () => resolveAsset('mini-paid-zip', {
      env,
      fetchImpl: fetchImplFor('mini-paid-zip', { entitled: true, zipPath }),
    }),
    (error) => {
      assert.ok(error instanceof AssetResolverError);
      assert.equal(error.code, 'integrity');
      return true;
    },
  );

  const destDir = path.join(home, 'assets', 'scene3d', 'mini-paid-zip');
  assert.equal(existsSync(destDir), false, '登録先が作られていないこと');
  const stray = readdirSync(home).filter((name) => name.startsWith('.tmp-resolve-'));
  assert.deepEqual(stray, [], '一時ディレクトリが破棄されていること');
});

test('resolvePaidZip: ダウンロード失敗（トークン失効等）も fail-closed', async () => {
  const { env, home, catalog, catalogPath } = setupFixtureEnv();
  writeCredentials(home);
  addPaidCatalogItem(catalog, catalogPath, 'mini-paid-zip', 'scene3d', 2980);

  await assert.rejects(
    () => resolveAsset('mini-paid-zip', {
      env,
      fetchImpl: fetchImplFor('mini-paid-zip', { entitled: true, zipPath: null }),
    }),
    (error) => {
      assert.ok(error instanceof AssetResolverError);
      assert.equal(error.code, 'download_failed');
      return true;
    },
  );

  assert.equal(existsSync(path.join(home, 'assets', 'scene3d', 'mini-paid-zip')), false);
});
