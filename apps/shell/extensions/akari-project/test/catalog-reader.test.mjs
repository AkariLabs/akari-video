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
        source: undefined,
        remote: undefined
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
    assert.deepEqual(parsed.license, { spdx: 'CC0-1.0', scope: 'commercial-ok' });
    assert.deepEqual(parsed.source, { url: 'https://polyhaven.com/a/Camera_01', preview_url: 'https://cdn.polyhaven.com/x.png', acquisition: undefined });
});

test('parseCatalogItemMeta: license/source が欠けていても undefined フィールドとして扱う（例外なし）', () => {
    const raw = JSON.stringify({ id: 'x', category: 'audio', title: 'y', license: {}, source: {} });
    const parsed = parseCatalogItemMeta(raw);
    assert.equal(parsed.license, undefined);
    assert.equal(parsed.source, undefined);
});

// remote / license.scope / source.acquisition — 分類バッジ導出（distribution）が要る新フィールド
// （task.md §1）。実データ確認済み: catalog/font/851-chikara-dzuyoku（free）・
// catalog/font/vdl-v7-mincho（paid）・catalog/font/ab-kirigirisu（subscription）。

test('parseCatalogItemMeta: remote:true を読む', () => {
    const raw = JSON.stringify({ id: '851-chikara-dzuyoku', category: 'font', title: '851チカラヅヨク', remote: true });
    assert.equal(parseCatalogItemMeta(raw).remote, true);
});

test('parseCatalogItemMeta: remote:false も読む（true 固定ではない）', () => {
    const raw = JSON.stringify({ id: 'x', category: 'font', title: 'y', remote: false });
    assert.equal(parseCatalogItemMeta(raw).remote, false);
});

test('parseCatalogItemMeta: remote が boolean でなければ undefined（型不一致は無視）', () => {
    const raw = JSON.stringify({ id: 'x', category: 'font', title: 'y', remote: 'yes' });
    assert.equal(parseCatalogItemMeta(raw).remote, undefined);
});

test('parseCatalogItemMeta: remote 欠落は undefined', () => {
    const raw = JSON.stringify({ id: 'x', category: 'font', title: 'y' });
    assert.equal(parseCatalogItemMeta(raw).remote, undefined);
});

test('parseCatalogItemMeta: license.scope を spdx と一緒に読む', () => {
    const raw = JSON.stringify({
        id: 'vdl-v7-mincho', category: 'font', title: 'VDL V7明朝',
        license: { spdx: 'LicenseRef-proprietary', scope: 'paid-license-required' }
    });
    const parsed = parseCatalogItemMeta(raw);
    assert.deepEqual(parsed.license, { spdx: 'LicenseRef-proprietary', scope: 'paid-license-required' });
});

test('parseCatalogItemMeta: license.scope は spdx が無くても単独で読める', () => {
    const raw = JSON.stringify({ id: 'x', category: 'font', title: 'y', license: { scope: 'commercial-ok' } });
    const parsed = parseCatalogItemMeta(raw);
    assert.deepEqual(parsed.license, { spdx: undefined, scope: 'commercial-ok' });
});

test('parseCatalogItemMeta: source.acquisition を url/preview_url と一緒に読む', () => {
    const raw = JSON.stringify({
        id: 'ab-kirigirisu', category: 'font', title: 'AB霧雨',
        source: { url: 'https://fonts.adobe.com/fonts/ab-kirigirisu', acquisition: 'login' }
    });
    const parsed = parseCatalogItemMeta(raw);
    assert.equal(parsed.source.acquisition, 'login');
    assert.equal(parsed.source.url, 'https://fonts.adobe.com/fonts/ab-kirigirisu');
});

test('parseCatalogItemMeta: source.acquisition は url/preview_url が無くても単独で読める', () => {
    const raw = JSON.stringify({ id: 'x', category: 'font', title: 'y', source: { acquisition: 'direct' } });
    const parsed = parseCatalogItemMeta(raw);
    assert.deepEqual(parsed.source, { url: undefined, preview_url: undefined, acquisition: 'direct' });
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
