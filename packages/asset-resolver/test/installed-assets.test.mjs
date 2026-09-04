import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../src/catalog.mjs';
import { AssetResolverError, resolve as resolveAsset } from '../src/resolve.mjs';
import { composeState } from '../src/state.mjs';
import { setupFixtureEnv } from './helpers.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(packageRoot, 'bin', 'akari-assets.mjs');

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function writeInstalled({ home, id = 'installed-one', title = 'Installed One', category = 'pack', payload = 'local payload' }) {
  const packRoot = path.join(home, 'assets', 'store', 'fixture-pack', 'fixture-pack-v1');
  const itemPath = category === 'pack' ? `custom/${id}` : `assets/${category}/${id}`;
  const assetRoot = path.join(packRoot, itemPath);
  mkdirSync(assetRoot, { recursive: true });
  writeFileSync(path.join(assetRoot, 'payload.txt'), payload);
  const indexPath = path.join(home, 'assets', 'installed.json');
  mkdirSync(path.dirname(indexPath), { recursive: true });
  writeFileSync(indexPath, `${JSON.stringify({
    schema: 'akari-installed-assets/v0',
    packs: {
      'fixture-pack': {
        version: 1,
        installedAt: '2026-01-01T00:00:00.000Z',
        root: packRoot,
        items: [{
          id,
          title,
          path: itemPath,
          version: 1,
          files: [{ path: 'payload.txt', bytes: Buffer.byteLength(payload), sha256: sha256(payload) }]
        }]
      }
    }
  }, null, 2)}\n`);
  return { packRoot, assetRoot, indexPath };
}

function runCli(args, env) {
  return spawnSync(process.execPath, [bin, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('installed item をカタログへマージし、CLI は [installed] と source を表示する', async () => {
  const { env, home } = setupFixtureEnv();
  writeInstalled({ home, category: 'scene3d' });

  const catalog = await loadCatalog({ env });
  const item = catalog.items.find((entry) => entry.id === 'installed-one');
  assert.equal(item.source, 'installed');
  assert.equal(item.category, 'scene3d');
  assert.equal(item.price, 0);
  assert.ok(path.isAbsolute(item.files[0].local_path));
  assert.deepEqual(Object.keys(item.files[0]).sort(), ['bytes', 'local_path', 'name', 'sha256']);

  const text = runCli(['list'], env);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /\[installed\]\s+installed-one/);
  const json = runCli(['list', '--json'], env);
  assert.equal(json.status, 0, json.stderr);
  assert.equal(JSON.parse(json.stdout).find((entry) => entry.id === 'installed-one').source, 'installed');
});

test('同じ id はリモート catalog より installed item を優先する', async () => {
  const { env, home } = setupFixtureEnv();
  writeInstalled({ home, id: 'mini-still', title: '購入済みローカル版', category: 'scene3d' });

  const { items } = await composeState({ env });
  const item = items.find((entry) => entry.id === 'mini-still');
  assert.equal(item.title, '購入済みローカル版');
  assert.equal(item.category, 'scene3d');
  assert.equal(item.source, 'installed');
  assert.equal(item.state, 'available');
});

test('installed item の fetch はローカル実体をコピーし sha256 一致時だけ登録する', async () => {
  const { env, home, root } = setupFixtureEnv();
  const payload = 'verified local payload';
  writeInstalled({ home, category: 'pack', payload });
  const project = path.join(root, 'project');
  mkdirSync(project, { recursive: true });

  const result = await resolveAsset('installed-one', { env, project });
  assert.equal(result.cached, false);
  assert.equal(result.category, 'pack');
  assert.equal(readFileSync(path.join(result.dir, 'payload.txt'), 'utf8'), payload);
  assert.equal(readFileSync(path.join(result.projectDir, 'payload.txt'), 'utf8'), payload);
});

test('installed item の実体改竄は integrity エラーで fail-closed にする', async () => {
  const { env, home } = setupFixtureEnv();
  const { assetRoot } = writeInstalled({ home, category: 'still' });
  writeFileSync(path.join(assetRoot, 'payload.txt'), 'tampered');

  await assert.rejects(
    () => resolveAsset('installed-one', { env }),
    (error) => error instanceof AssetResolverError && error.code === 'integrity',
  );
  assert.equal(existsSync(path.join(home, 'assets', 'still', 'installed-one')), false);
});

for (const indexState of ['missing', 'empty']) {
  test(`installed.json が ${indexState} のとき既存 list / fetch 出力を変えない`, () => {
    const { env, home } = setupFixtureEnv();
    if (indexState === 'empty') {
      mkdirSync(path.join(home, 'assets'), { recursive: true });
      writeFileSync(path.join(home, 'assets', 'installed.json'), '{"schema":"akari-installed-assets/v0","packs":{}}\n');
    }
    const list = runCli(['list'], env);
    assert.equal(list.status, 0, list.stderr);
    assert.equal(list.stdout,
      `使える素材 2 件（ライブラリ: ${home}）\n`
      + '  ☁  mini-still\t[still]\tフィクスチャ素材 mini-still\n'
      + '  ¥500  mini-paid\t[still]\tフィクスチャ素材 mini-paid（有料）\n');

    const fetchResult = runCli(['fetch', 'mini-still'], env);
    assert.equal(fetchResult.status, 0, fetchResult.stderr);
    assert.equal(fetchResult.stdout, `取得しました: ${path.join(home, 'assets', 'still', 'mini-still')}\n`);
  });
}

test('カタログ到達不能・キャッシュ無しでも installed item だけで一覧化できる', async () => {
  const { env, home } = setupFixtureEnv({ AKARI_ASSETS_CATALOG: 'https://catalog.invalid/catalog.json' });
  writeInstalled({ home, category: 'scene3d' });
  const { base, items } = await composeState({
    env,
    fetchImpl: async () => { throw new Error('offline'); },
  });
  assert.equal(base, null);
  assert.deepEqual(items.map((item) => item.id), ['installed-one']);
  assert.equal(items[0].source, 'installed');
});

test('カタログ到達不能・キャッシュ無しで installed item も無ければ従来どおり失敗する', async () => {
  const { env } = setupFixtureEnv({ AKARI_ASSETS_CATALOG: 'https://catalog.invalid/catalog.json' });
  await assert.rejects(
    () => loadCatalog({ env, fetchImpl: async () => { throw new Error('offline'); } }),
    /カタログを取得できず、キャッシュもありません/,
  );
});

test('壊れた installed.json は欠損を黙って無視せず明示エラーにする', async () => {
  const { env, home } = setupFixtureEnv();
  writeInstalled({ home });
  const indexPath = path.join(home, 'assets', 'installed.json');
  const index = JSON.parse(readFileSync(indexPath, 'utf8'));
  delete index.packs['fixture-pack'].items[0].files[0].sha256;
  writeFileSync(indexPath, `${JSON.stringify(index)}\n`);

  await assert.rejects(() => loadCatalog({ env }), /files\[\] が不正/);
});

test('installed item の path が素材ディレクトリ外を指す索引は拒否する', async () => {
  const { env, home } = setupFixtureEnv();
  writeInstalled({ home });
  const indexPath = path.join(home, 'assets', 'installed.json');
  const index = JSON.parse(readFileSync(indexPath, 'utf8'));
  index.packs['fixture-pack'].items[0].files[0].path = '../../outside.txt';
  writeFileSync(indexPath, `${JSON.stringify(index)}\n`);

  await assert.rejects(() => loadCatalog({ env }), /パック外を指しています/);
});

test('sync のキャッシュへ installed item を混ぜない', () => {
  const { env, home, catalog } = setupFixtureEnv();
  writeInstalled({ home });

  const result = runCli(['sync'], env);
  assert.equal(result.status, 0, result.stderr);
  const cached = JSON.parse(readFileSync(path.join(home, 'catalog-cache.json'), 'utf8'));
  assert.deepEqual(cached, catalog);
  assert.equal(cached.items.some((item) => item.source === 'installed'), false);
});
