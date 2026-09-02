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
        tags: ['subtitle']
    }]);
});

test('parsePresetShowcaseJsonl: textanim / textstyle の壊れ行をスキップする', () => {
    const invalidAnimation = JSON.stringify({ id: 'bad', name: '不正', category: '動き', description: '不足', slot: 'middle' });
    const invalidStyle = JSON.stringify({ id: 'bad', kind: 'textstyle', category: 'subtitle', name: '不正', sample_text: '不足' });
    assert.deepEqual(parsePresetShowcaseJsonl(invalidAnimation, 'textanim'), []);
    assert.deepEqual(parsePresetShowcaseJsonl(invalidStyle, 'textstyle'), []);
});

test('derivePresetShowcaseChips: 4 種の件数を固定順で返す', () => {
    const chips = derivePresetShowcaseChips({
        telop: [{ kind: 'telop', id: 'a', name: 'A', category: 'caption', tags: [] }],
        lut: [
            { kind: 'lut', id: 'b', name: 'B', description: 'B', whenToUse: 'B', tags: [] },
            { kind: 'lut', id: 'c', name: 'C', description: 'C', whenToUse: 'C', tags: [] }
        ],
        textanim: [{ kind: 'textanim', id: 'd', name: 'D', category: 'in', tags: ['in'] }],
        textstyle: [{ kind: 'textstyle', id: 'e', name: 'E', category: 'subtitle', tags: ['subtitle'] }]
    });
    assert.deepEqual(chips, [
        { category: 'preset:telop', label: 'テロップ', count: 1 },
        { category: 'preset:lut', label: 'LUT', count: 2 },
        { category: 'preset:textanim', label: 'テキストアニメ', count: 1 },
        { category: 'preset:textstyle', label: 'テキストスタイル', count: 1 }
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
