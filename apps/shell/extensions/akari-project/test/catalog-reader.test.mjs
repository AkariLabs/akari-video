import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCatalogItemMeta, filterCatalogItems } from '../lib/common/catalog-reader.js';

// meta.json 寛容リーダー単体テスト（task.md L0: 必須3フィールドのみ / 欠落 / 壊れJSON の3様態）
// + 検索・カテゴリフィルタの純関数。

test('parseCatalogItemMeta: 必須3フィールドのみ — id/category/title だけの最小形を読める', () => {
    const raw = JSON.stringify({ id: 'vintage-camera', category: '3d', title: 'ヴィンテージカメラ' });
    const parsed = parseCatalogItemMeta(raw);
    assert.deepEqual(parsed, {
        id: 'vintage-camera',
        category: '3d',
        title: 'ヴィンテージカメラ',
        description: undefined,
        tags: undefined,
        when_to_use: undefined,
        license: undefined,
        source: undefined
    });
});

test('parseCatalogItemMeta: 必須フィールド欠落（category なし）— undefined', () => {
    const raw = JSON.stringify({ id: 'x', title: 'no category' });
    assert.equal(parseCatalogItemMeta(raw), undefined);
});

test('parseCatalogItemMeta: 必須フィールドが空文字 — undefined', () => {
    const raw = JSON.stringify({ id: '', category: '3d', title: 'x' });
    assert.equal(parseCatalogItemMeta(raw), undefined);
});

test('parseCatalogItemMeta: 壊れた JSON — 例外を投げず undefined', () => {
    assert.equal(parseCatalogItemMeta('{ broken json ,,,'), undefined);
});

test('parseCatalogItemMeta: JSON として妥当だがオブジェクトでない — undefined', () => {
    assert.equal(parseCatalogItemMeta('[1, 2, 3]'), undefined);
    assert.equal(parseCatalogItemMeta('"just a string"'), undefined);
});

test('parseCatalogItemMeta: 未知フィールドがあっても例外にならず、既知フィールドだけ読む', () => {
    const raw = JSON.stringify({
        id: 'vintage-camera',
        category: '3d',
        title: 'ヴィンテージカメラ 3D モデル',
        description: '革ストラップのカメラモデル',
        tags: ['product-demo', 'vintage', 'camera'],
        when_to_use: 'レトロ演出のシーン',
        license: { spdx: 'CC0-1.0', scope: 'commercial-ok' },
        source: { url: 'https://polyhaven.com/a/Camera_01', preview_url: 'https://cdn.polyhaven.com/x.png' },
        knobs: [{ cssVar: '--rotate-y' }],
        ai_usage: '説明文'
    });
    const parsed = parseCatalogItemMeta(raw);
    assert.equal(parsed.description, '革ストラップのカメラモデル');
    assert.deepEqual(parsed.tags, ['product-demo', 'vintage', 'camera']);
    assert.equal(parsed.when_to_use, 'レトロ演出のシーン');
    assert.deepEqual(parsed.license, { spdx: 'CC0-1.0' });
    assert.deepEqual(parsed.source, { url: 'https://polyhaven.com/a/Camera_01', preview_url: 'https://cdn.polyhaven.com/x.png' });
});

test('parseCatalogItemMeta: license/source が欠けていても undefined フィールドとして扱う（例外なし）', () => {
    const raw = JSON.stringify({ id: 'x', category: 'audio', title: 'y', license: {}, source: {} });
    const parsed = parseCatalogItemMeta(raw);
    assert.equal(parsed.license, undefined);
    assert.equal(parsed.source, undefined);
});

const CATEGORY_ITEMS = [
    { id: 'vintage-camera', category: '3d', title: 'ヴィンテージカメラ 3D モデル', tags: ['vintage', 'camera'], description: 'レトロなカメラ' },
    { id: 'modern-smartphone', category: '3d', title: 'モダンスマートフォン', tags: ['product-demo'] },
    { id: 'corporate-upbeat-bgm', category: 'audio', title: 'コーポレート BGM', description: 'upbeat corporate track' }
];

test('filterCatalogItems: category=all は全件を通す', () => {
    assert.equal(filterCatalogItems(CATEGORY_ITEMS, '', 'all').length, 3);
});

test('filterCatalogItems: カテゴリチップで絞る', () => {
    const result = filterCatalogItems(CATEGORY_ITEMS, '', '3d');
    assert.equal(result.length, 2);
    assert.ok(result.every(item => item.category === '3d'));
});

test('filterCatalogItems: 検索語はタイトルを対象にする', () => {
    const result = filterCatalogItems(CATEGORY_ITEMS, 'スマートフォン', 'all');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'modern-smartphone');
});

test('filterCatalogItems: 検索語は description も対象にする', () => {
    const result = filterCatalogItems(CATEGORY_ITEMS, 'corporate', 'all');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'corporate-upbeat-bgm');
});

test('filterCatalogItems: 検索語は tags も対象にする', () => {
    const result = filterCatalogItems(CATEGORY_ITEMS, 'vintage', 'all');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'vintage-camera');
});

test('filterCatalogItems: 検索語 + カテゴリの両方で絞る', () => {
    const result = filterCatalogItems(CATEGORY_ITEMS, 'product-demo', '3d');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'modern-smartphone');
});

test('filterCatalogItems: 一致なしは 0 件（例外なし）', () => {
    assert.equal(filterCatalogItems(CATEGORY_ITEMS, 'no-such-term', 'all').length, 0);
});
