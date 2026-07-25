import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveUpwardCatalogRoot, CATALOG_ROOT_UPWARD_MAX_DEPTH } from '../lib/node/catalog-root-search.js';

// 上方探索純関数の単体テスト（task.md L0: 一致あり/なし/深すぎ）。
// hasCatalogIndex は catalog/INDEX.md の存在判定を注入する形なので fs に触らず検証できる。

test('一致あり: maxDepth 内の祖先ディレクトリで見つかる', async () => {
    const start = '/Users/example/repo/apps/shell/lib/backend';
    const target = '/Users/example/repo';
    const hasCatalogIndex = async dir => dir === target;
    const result = await resolveUpwardCatalogRoot(start, CATALOG_ROOT_UPWARD_MAX_DEPTH, hasCatalogIndex);
    assert.equal(result, target);
});

test('一致あり: 起点ディレクトリ自身が一致する場合（depth 0）', async () => {
    const start = '/Users/example/repo';
    const hasCatalogIndex = async dir => dir === start;
    const result = await resolveUpwardCatalogRoot(start, CATALOG_ROOT_UPWARD_MAX_DEPTH, hasCatalogIndex);
    assert.equal(result, start);
});

test('一致なし: どの祖先も catalog/INDEX.md を持たない', async () => {
    const start = '/Users/example/repo/apps/shell/lib/backend';
    const result = await resolveUpwardCatalogRoot(start, CATALOG_ROOT_UPWARD_MAX_DEPTH, async () => false);
    assert.equal(result, undefined);
});

test('深すぎ: 一致は存在するが maxDepth を超えた祖先にしかない — 見つからない', async () => {
    // start から target までは 9 階層上（dirname を 9 回）— maxDepth=8 の探索範囲外。
    const start = '/a/b/c/d/e/f/g/h/i/j';
    const target = '/a';
    const hasCatalogIndex = async dir => dir === target;
    const result = await resolveUpwardCatalogRoot(start, CATALOG_ROOT_UPWARD_MAX_DEPTH, hasCatalogIndex);
    assert.equal(result, undefined);
});

test('深すぎの境界確認: maxDepth をひとつ増やせば同じ target が見つかる', async () => {
    const start = '/a/b/c/d/e/f/g/h/i/j';
    const target = '/a';
    const hasCatalogIndex = async dir => dir === target;
    const result = await resolveUpwardCatalogRoot(start, CATALOG_ROOT_UPWARD_MAX_DEPTH + 1, hasCatalogIndex);
    assert.equal(result, target);
});

test('ファイルシステムルートに達したら打ち切る（一致なしのまま無限ループしない）', async () => {
    const start = '/a/b';
    const result = await resolveUpwardCatalogRoot(start, 100, async () => false);
    assert.equal(result, undefined);
});
