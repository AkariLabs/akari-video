import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { localizedCatalogPackText, parseCatalogPacksFile } from '../lib/common/catalog-packs.js';

test('pack title and description resolve independently and preserve the base summary', () => {
    const [pack] = parseCatalogPacksFile(JSON.stringify({ packs: [{ id: 'p', category: 'font', title: '基底', summary: '説明',
        i18n: { en: { title: 'English' }, fr: { description: 'Description' } } }] }));
    assert.equal(localizedCatalogPackText(pack, 'title', 'en'), 'English');
    assert.equal(localizedCatalogPackText(pack, 'description', 'en'), '説明');
    assert.equal(localizedCatalogPackText(pack, 'title', 'fr'), 'English');
    assert.equal(localizedCatalogPackText(pack, 'description', 'fr'), 'Description');
    assert.equal(localizedCatalogPackText(pack, 'title', 'ja'), '基底');
    assert.equal(pack.summary, '説明');
});

test('distributed packs have English copy and no internal curation note', () => {
    const raw = readFileSync(new URL('../../../../../catalog/packs.json', import.meta.url), 'utf8');
    const packs = parseCatalogPacksFile(raw);
    assert.equal(packs.length, 2);
    assert.doesNotMatch(raw, /選別の正本/u);
    for (const pack of packs) {
        assert.ok(localizedCatalogPackText(pack, 'title', 'en'));
        assert.ok(localizedCatalogPackText(pack, 'description', 'en'));
        assert.equal(localizedCatalogPackText(pack, 'title', 'ja'), pack.title);
    }
});

// catalog/packs.json（パック台帳）の寛容リーダー単体テスト（task.md L0:
// 欠損・壊れ JSON・スキーマ不一致・要素ごとの必須フィールド欠落のどれでも落ちない）。

test('parseCatalogPacksFile: 正常な台帳（複数 pack）を読む', () => {
    const raw = JSON.stringify({
        schema: 'akari-catalog-packs/v0',
        packs: [
            { id: 'font25-2026-08', category: 'font', title: 'テロップ向け必須フォント 25 選', summary: 'バラエティ〜企業紹介まで幅広くカバー' },
            { id: 'sfx-impact-2026-08', category: 'audio', title: 'インパクト効果音パック' }
        ]
    });
    const packs = parseCatalogPacksFile(raw);
    assert.equal(packs.length, 2);
    assert.deepEqual(packs[0], {
        id: 'font25-2026-08',
        category: 'font',
        title: 'テロップ向け必須フォント 25 選',
        summary: 'バラエティ〜企業紹介まで幅広くカバー'
    });
    assert.equal(packs[1].summary, undefined);
});

test('parseCatalogPacksFile: 壊れた JSON — 例外を投げず空配列', () => {
    assert.deepEqual(parseCatalogPacksFile('{ broken json ,,,'), []);
});

test('parseCatalogPacksFile: JSON として妥当だがオブジェクトでない — 空配列', () => {
    assert.deepEqual(parseCatalogPacksFile('[1, 2, 3]'), []);
    assert.deepEqual(parseCatalogPacksFile('"just a string"'), []);
});

test('parseCatalogPacksFile: packs フィールドが無い — 空配列', () => {
    assert.deepEqual(parseCatalogPacksFile(JSON.stringify({ schema: 'akari-catalog-packs/v0' })), []);
});

test('parseCatalogPacksFile: packs が配列でない — 空配列', () => {
    assert.deepEqual(parseCatalogPacksFile(JSON.stringify({ packs: 'not-an-array' })), []);
});

test('parseCatalogPacksFile: schema フィールドが無くても packs があれば読む（寛容リーダー）', () => {
    const raw = JSON.stringify({ packs: [{ id: 'x', category: 'font', title: 'y' }] });
    assert.equal(parseCatalogPacksFile(raw).length, 1);
});

test('parseCatalogPacksFile: 必須フィールド（id/category/title）を欠く要素はスキップし、他の要素は残す', () => {
    const raw = JSON.stringify({
        packs: [
            { id: 'ok-pack', category: 'font', title: '正常なパック' },
            { category: 'font', title: 'id 無し' },
            { id: 'no-title', category: 'font' },
            null,
            'not-an-object'
        ]
    });
    const packs = parseCatalogPacksFile(raw);
    assert.equal(packs.length, 1);
    assert.equal(packs[0].id, 'ok-pack');
});

test('parseCatalogPacksFile: 必須フィールドが空文字 — その要素はスキップ', () => {
    const raw = JSON.stringify({ packs: [{ id: '', category: 'font', title: 'x' }] });
    assert.deepEqual(parseCatalogPacksFile(raw), []);
});
