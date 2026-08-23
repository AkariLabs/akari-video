import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { resolveTimelineClipName } = require('../lib/browser/timeline-selection-model.js');

test('HTML overlay: src と preset が無ければ既存どおり id を clip name にする', () => {
    assert.equal(resolveTimelineClipName({ id: 'simple-html' }), 'simple-html');
    assert.equal(resolveTimelineClipName({ id: 'chapter-tag' }), 'chapter-tag');
});

test('スロット付き HTML は params の最初の値を clip name にする', () => {
    assert.equal(resolveTimelineClipName({
        id: 'chapter-tag',
        html: 'overlays/chapter-tag.html',
        params: { title: '第1章 問題の本質', subtitle: '補足' }
    }), '第1章 問題の本質');
});

test('空の代表値は id へ fallback し、native telop の params は preset を変えない', () => {
    assert.equal(resolveTimelineClipName({
        id: 'chapter-tag', html: 'overlays/chapter-tag.html', params: { title: '' }
    }), 'chapter-tag');
    assert.equal(resolveTimelineClipName({
        id: 'native-telop', preset: 'ref3_name_rounded', params: { name: 'AKARI' }
    }), 'ref3_name_rounded');
});

test('baked telop: non-empty src の basename を既存どおり clip name にする', () => {
    assert.equal(resolveTimelineClipName({
        id: 'baked-telop',
        src: 'assets/telop/baked-title.webm',
        preset: 'ref3_name_rounded'
    }), 'baked-title.webm');
});

test('src → preset: non-empty src は preset より優先する', () => {
    assert.equal(resolveTimelineClipName({
        id: 'native-telop',
        src: 'renders/name-card.mov',
        preset: 'ref3_name_rounded'
    }), 'name-card.mov');
});

test('unbaked telop: undefined src は path として扱わず preset へ fallback する', () => {
    assert.equal(resolveTimelineClipName({
        id: 'native-telop',
        src: undefined,
        preset: 'ref3_name_rounded'
    }), 'ref3_name_rounded');
});

test('preset → id: src と preset が無ければ id へ fallback する', () => {
    assert.equal(resolveTimelineClipName({
        id: 'native-telop',
        src: undefined,
        preset: undefined
    }), 'native-telop');
});

test('空文字や文字列でない src/preset は path・fallback 候補として扱わない', () => {
    assert.equal(resolveTimelineClipName({
        id: 'empty-values',
        src: '',
        preset: ''
    }), 'empty-values');
    assert.equal(resolveTimelineClipName({
        id: 'invalid-values',
        src: { baked: false },
        preset: 42
    }), 'invalid-values');
});
