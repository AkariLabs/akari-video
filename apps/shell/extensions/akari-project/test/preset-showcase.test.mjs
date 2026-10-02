import test from 'node:test';
import assert from 'node:assert/strict';
import {
    derivePresetShowcaseChips,
    filterPresetShowcaseItems,
    parsePresetShowcaseJsonl,
    appendLibraryTextstyleShowcaseItems
} from '../lib/common/preset-showcase.js';

test('parsePresetShowcaseJsonl: retired telop is never offered', () => {
    assert.deepEqual(parsePresetShowcaseJsonl(JSON.stringify({
        id: 'old', name: 'Old', category: 'caption', tags: [],
        description: 'legacy', when_to_use: 'legacy'
    }), 'telop'), []);
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
    const valid = JSON.stringify({ id: 'ok', name: '有効', description: 'description', when_to_use: 'use', tags: ['lut'] });
    const missing = JSON.stringify({ id: 'missing-category', name: '不正', tags: [] });
    const items = parsePresetShowcaseJsonl([valid, '{ broken', missing, '', valid].join('\n'), 'lut');
    assert.deepEqual(items.map(item => item.id), ['ok', 'ok']);
});

test('parsePresetShowcaseJsonl: textanim は slot をタグへ正規化し sampleText を保持する', () => {
    const items = parsePresetShowcaseJsonl(JSON.stringify({
        id: 'fade-up',
        name: 'フェードアップ',
        category: 'フェード',
        description: '下から薄く浮かぶ',
        sample_text: '浮かぶ字幕',
        slot: 'in'
    }), 'textanim');
    assert.deepEqual(items, [{
        kind: 'textanim',
        id: 'fade-up',
        name: 'フェードアップ',
        category: 'フェード',
        description: '下から薄く浮かぶ',
        sampleText: '浮かぶ字幕',
        tags: ['in']
    }]);
});

test('parsePresetShowcaseJsonl: textstyle は category をタグへ正規化し sampleText を保持する', () => {
    const items = parsePresetShowcaseJsonl(JSON.stringify({
        id: 'subtitle-news',
        kind: 'textstyle',
        category: 'subtitle',
        name: 'ニュース風',
        sample_text: '速報ニュース',
        style: { size_px: 56 }
    }), 'textstyle');
    assert.deepEqual(items, [{
        kind: 'textstyle',
        id: 'subtitle-news',
        name: 'ニュース風',
        category: 'subtitle',
        sampleText: '速報ニュース',
        style: { size_px: 56 },
        tags: ['subtitle']
    }]);
});

test('parsePresetShowcaseJsonl: textanim / textstyle の壊れ行をスキップする', () => {
    const invalidAnimation = JSON.stringify({ id: 'bad', name: '不正', category: '動き', description: '不足', slot: 'middle' });
    const invalidStyle = JSON.stringify({ id: 'bad', kind: 'textstyle', category: 'subtitle', name: '不正', sample_text: '不足' });
    assert.deepEqual(parsePresetShowcaseJsonl(invalidAnimation, 'textanim'), []);
    assert.deepEqual(parsePresetShowcaseJsonl(invalidStyle, 'textstyle'), []);
});

test('library textstyle follows built-ins, carries origin and drops conflicting ids', () => {
    const builtin = [{ kind: 'textstyle', id: 'neon', name: 'Built-in', tags: [] }];
    const library = [
        { id: 'neon', name: 'Other', category: 'test', style: {}, origin: 'library' },
        { id: 'library-gold-sample', name: 'Gold', category: 'metallic', style: { strokes: [] }, origin: 'library' }
    ];
    const items = appendLibraryTextstyleShowcaseItems(builtin, library, () => 'file:///preview.png');
    assert.equal(items.length, 2);
    assert.equal(items[0], builtin[0]);
    assert.equal(items[1].origin, 'library');
    assert.equal(items[1].previewUrl, 'file:///preview.png');
    assert.deepEqual(items[1].style, { strokes: [] });
});

test('derivePresetShowcaseChips: 退役後の 3 種の件数を固定順で返す', () => {
    const chips = derivePresetShowcaseChips({
        lut: [
            { kind: 'lut', id: 'b', name: 'B', description: 'B', whenToUse: 'B', tags: [] },
            { kind: 'lut', id: 'c', name: 'C', description: 'C', whenToUse: 'C', tags: [] }
        ],
        textanim: [{ kind: 'textanim', id: 'd', name: 'D', category: 'in', tags: ['in'] }],
        textstyle: [{ kind: 'textstyle', id: 'e', name: 'E', category: 'subtitle', tags: ['subtitle'] }]
    });
    assert.deepEqual(chips, [
        { category: 'preset:lut', label: 'LUT', count: 2 },
        { category: 'preset:textanim', label: 'テキストアニメ', count: 1 },
        { category: 'preset:textstyle', label: 'テキストスタイル', count: 1 }
    ]);
});

const SEARCH_ITEMS = [
    { kind: 'textstyle', id: 'caption-pop', name: 'ポップ字幕', category: 'caption', tags: ['bright', 'caption'] },
    { kind: 'textstyle', id: 'news-lower', name: 'ニュース下帯', category: 'lower-third', tags: ['news'] }
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
