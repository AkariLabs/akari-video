import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildDaihonRows } = require('../lib/common/daihon-row-model.js');

const base = {
    id: 'c-0001', start: 0, end: 2, text: 'こんにちは世界', edited: false,
    words: [
        { text: 'こんにちは', start: 0, end: 1 },
        { text: '世界', start: 1, end: 2 }
    ]
};

test('2断片の切れ目を単語 index に変換する', () => {
    const [row] = buildDaihonRows([{ ...base, display_fragments: ['こんにちは', '世界'] }], null);
    assert.equal(row.fragmentBreakWordIndex, 1);
});

test('words が無い2断片は文字 index を返す', () => {
    const [row] = buildDaihonRows([{
        ...base, words: undefined, display_fragments: ['こんにちは', '世界']
    }], null);
    assert.equal(row.fragmentBreakWordIndex, 5);
    assert.equal(row.words, null);
});

test('全区間がカット中の行は出力窓を null にする', () => {
    const segments = [
        { kind: 'src', outStart: 0, outEnd: 1, cutIndex: 0, in: 0, out: 1, speed: 1 },
        { kind: 'src', outStart: 1, outEnd: 2, cutIndex: 1, in: 3, out: 4, speed: 1 }
    ];
    const [row] = buildDaihonRows([{ ...base, start: 1.2, end: 2.8 }], segments);
    assert.equal(row.outStart, null);
    assert.equal(row.outEnd, null);
});

test('output 時間の行は timeline map を適用しない', () => {
    const segments = [{ kind: 'src', outStart: 0, outEnd: 1, cutIndex: 0, in: 5, out: 7, speed: 2 }];
    const [row] = buildDaihonRows([{ ...base, start: 5, end: 6, time_domain: 'output' }], segments);
    assert.equal(row.outStart, 5);
    assert.equal(row.outEnd, 6);
    assert.equal(row.timeDomain, 'output');
});
