import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { resolveUniqueProjectDir, defaultLoadCreatorRootModule } from '../src/first-run.mjs';
import { resolveRepoAssets } from '../src/repo-assets.mjs';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(packageRoot, '..', '..');

async function withScratchRoot(callback) {
  const root = await mkdtemp(join(tmpdir(), 'akari-first-run-units-'));
  try {
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('resolveUniqueProjectDir: 衝突が無ければ YYYY-MM-DD-video をそのまま使う', async () => {
  await withScratchRoot(async (root) => {
    // 月は 0 始まり（7 = 8 月）。ローカル時刻のコンストラクタを使うことで、
    // フォーマット側（getFullYear/getMonth/getDate も同じくローカル）とタイムゾーン
    // ずれが起きないようにしている。
    const dir = resolveUniqueProjectDir(root, new Date(2026, 7, 2));
    assert.equal(dir, join(root, '2026-08-02-video'));
  });
});

test('resolveUniqueProjectDir: 一桁の月日も 0 埋めする', async () => {
  await withScratchRoot(async (root) => {
    const dir = resolveUniqueProjectDir(root, new Date(2026, 0, 5));
    assert.equal(dir, join(root, '2026-01-05-video'));
  });
});

test('resolveUniqueProjectDir: 衝突があれば -2, -3 と連番にする', async () => {
  await withScratchRoot(async (root) => {
    await mkdir(join(root, '2026-08-02-video'), { recursive: true });
    await mkdir(join(root, '2026-08-02-video-2'), { recursive: true });
    const dir = resolveUniqueProjectDir(root, new Date(2026, 7, 2));
    assert.equal(dir, join(root, '2026-08-02-video-3'));
  });
});

test('resolveUniqueProjectDir: ディレクトリを実際には作らない（作成は既存 scaffold 経路に委ねる）', async () => {
  await withScratchRoot(async (root) => {
    const dir = resolveUniqueProjectDir(root, new Date(2026, 7, 2));
    assert.equal(existsSync(dir), false);
  });
});

test('defaultLoadCreatorRootModule: creatorRootModulePath が無ければ null', async () => {
  const mod = await defaultLoadCreatorRootModule({ creatorRootModulePath: null });
  assert.equal(mod, null);
});

test('defaultLoadCreatorRootModule: assets 自体が無くても null', async () => {
  const mod = await defaultLoadCreatorRootModule(undefined);
  assert.equal(mod, null);
});

test('defaultLoadCreatorRootModule: モノレポ checkout 内では実 creator-root モジュールを動的 import で解決する', async () => {
  const assets = resolveRepoAssets(repoRoot);
  assert.ok(assets.creatorRootModulePath, 'このテストはモノレポ checkout 内で実行する前提（packages/creator-root が見つからない）');
  const mod = await defaultLoadCreatorRootModule(assets);
  assert.equal(typeof mod.resolveCreatorRoot, 'function');
  assert.equal(typeof mod.createCreatorRoot, 'function');
  assert.equal(typeof mod.updateMachinePointer, 'function');
  assert.equal(typeof mod.defaultRootPath, 'function');
  assert.equal(mod.DEFAULT_CHANNEL_NAME, 'my-channel');
});
