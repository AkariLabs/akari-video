// テスト共通セットアップ: フィクスチャカタログを一時ディレクトリに書き出し、
// AKARI_ASSETS_CATALOG（ローカルパス）+ AKARI_HOME を差した env を組み立てる。

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildFixtureCatalog } from './fixtures/build-fixture-library.mjs';

/** @returns {{ env: object, root: string, catalog: object, catalogPath: string, baseDir: string, home: string }} */
export function setupFixtureEnv(extraEnv = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'asset-resolver-test-'));
  const baseDir = path.join(root, 'base');
  const home = path.join(root, 'home');
  mkdirSync(baseDir, { recursive: true });
  mkdirSync(home, { recursive: true });

  const catalog = buildFixtureCatalog(baseDir);
  const catalogPath = path.join(root, 'catalog.json');
  writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);

  const env = {
    AKARI_HOME: home,
    AKARI_ASSETS_CATALOG: catalogPath,
    ...extraEnv,
  };

  return { env, root, catalog, catalogPath, baseDir, home };
}
