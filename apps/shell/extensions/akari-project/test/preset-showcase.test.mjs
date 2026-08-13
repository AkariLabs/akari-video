import test from 'node:test';
import assert from 'node:assert/strict';
import {
    derivePresetShowcaseChips,
    filterPresetShowcaseItems,
    parsePresetShowcaseJsonl
} from '../lib/common/preset-showcase.js';

test('parsePresetShowcaseJsonl: telop は公開フィールドだけを読む', () => {
    const items = parsePresetShowcaseJsonl(JSON.stringify({
        id: 'caption-pop',
        name: 'ポップ字幕',
        category: 'caption',
        tags: ['pop', 'caption'],
        params: [{ key: 'text' }],
        unknown: 'ignored'
    }), 'telop');
    assert.deepEqual(items, [{
        kind: 'telop',
        id: 'caption-pop',
        name: 'ポップ字幕',
        category: 'caption',
        tags: ['pop', 'caption']
    }]);
    assert.equal('params' in items[0], false);
});

test('parsePresetShowcaseJsonl: LUT は説明と使いどころを camelCase へ正規化する', () => {
    const items = parsePresetShowcaseJsonl(JSON.stringify({
        id: 'natural',
        name: 'ナチュラル',
        description: '穏やかな色調',
        when_to_use: '一般的な書き出し',
        tags: ['lut', 'natural'],
        params: [{ key: 'intensity' }]
    }), 'lut');
    assert.deepEqual(items, [{
        kind: 'lut',
        id: 'natural',
        name: 'ナチュラル',
        description: '穏やかな色調',
        whenToUse: '一般的な書き出し',
        tags: ['lut', 'natural']
    }]);
});

test('parsePresetShowcaseJsonl: 壊れた行と必須フィールド不正行だけを飛ばして残りを返す', () => {
    const valid = JSON.stringify({ id: 'ok', name: '有効', category: 'caption', tags: ['caption'] });
    const missing = JSON.stringify({ id: 'missing-category', name: '不正', tags: [] });
    const items = parsePresetShowcaseJsonl([valid, '{ broken', missing, '', valid].join('\n'), 'telop');
    assert.deepEqual(items.map(item => item.id), ['ok', 'ok']);
});

test('derivePresetShowcaseChips: テロップ / LUT の件数を固定順で返す', () => {
    const chips = derivePresetShowcaseChips({
        telop: [{ kind: 'telop', id: 'a', name: 'A', category: 'caption', tags: [] }],
        lut: [
            { kind: 'lut', id: 'b', name: 'B', description: 'B', whenToUse: 'B', tags: [] },
            { kind: 'lut', id: 'c', name: 'C', description: 'C', whenToUse: 'C', tags: [] }
        ]
    });
    assert.deepEqual(chips, [
        { category: 'preset:telop', label: 'テロップ', count: 1 },
        { category: 'preset:lut', label: 'LUT', count: 2 }
    ]);
});

const SEARCH_ITEMS = [
    { kind: 'telop', id: 'caption-pop', name: 'ポップ字幕', category: 'caption', tags: ['bright', 'caption'] },
    { kind: 'telop', id: 'news-lower', name: 'ニュース下帯', category: 'lower-third', tags: ['news'] }
];

test('filterPresetShowcaseItems: 和名・id・タグを検索する', () => {
    assert.deepEqual(filterPresetShowcaseItems(SEARCH_ITEMS, 'ニュース').map(item => item.id), ['news-lower']);
    assert.deepEqual(filterPresetShowcaseItems(SEARCH_ITEMS, 'caption-pop').map(item => item.id), ['caption-pop']);
    assert.deepEqual(filterPresetShowcaseItems(SEARCH_ITEMS, 'bright').map(item => item.id), ['caption-pop']);
});

test('filterPresetShowcaseItems: 空検索は全件、不一致は 0 件', () => {
    assert.equal(filterPresetShowcaseItems(SEARCH_ITEMS, ' ').length, 2);
    assert.equal(filterPresetShowcaseItems(SEARCH_ITEMS, 'no-match').length, 0);
});
