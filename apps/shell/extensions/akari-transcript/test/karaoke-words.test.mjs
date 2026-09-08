import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { shouldUseKaraokeWords } = require('../lib/common/karaoke-words.js');
const { rowIssues } = require('../lib/common/daihon-qc.js');

test('連結が本文に一致するときだけ words を描画する', () => {
    assert.equal(shouldUseKaraokeWords('喋ってるだけで、', [{ text: '喋' }, { text: 'ってるだけで、' }]), true);
    assert.equal(shouldUseKaraokeWords('喋ってるだけで、', [{ text: 'ってるだけで、' }]), false);
    assert.equal(shouldUseKaraokeWords('編集はもう終わってる感じです。', [{ text: '編は終わってる感じです。' }]), false);
});

test('空白の違いは許容し、句読点や文字順の違いは本文描画に戻す', () => {
    assert.equal(shouldUseKaraokeWords('hello\n world!　', [{ text: ' hello\t' }, { text: 'world! ' }]), true);
    assert.equal(shouldUseKaraokeWords('はい。', [{ text: 'はい' }]), false);
    assert.equal(shouldUseKaraokeWords('あい', [{ text: 'いあ' }]), false);
});

test('words が無い場合と空配列は本文を描画する', () => {
    for (const words of [undefined, null, []]) {
        assert.equal(shouldUseKaraokeWords('はい', words), false);
        assert.equal(shouldUseKaraokeWords('', words), false);
    }
});

test('古い words は表示に使わなくてもカラオケ不整合の札を残す', () => {
    const row = {
        start: 0, end: 3, outStart: 0, text: '喋ってるだけで、', unrecognized: [],
        words: [{ start: 0, end: 3, text: 'ってるだけで、' }]
    };
    assert.equal(shouldUseKaraokeWords(row.text, row.words), false);
    assert.deepEqual(rowIssues(row).find(issue => issue.kind === 'karaoke-unhealthy'), {
        kind: 'karaoke-unhealthy', label: 'カラオケ不整合'
    });
});
