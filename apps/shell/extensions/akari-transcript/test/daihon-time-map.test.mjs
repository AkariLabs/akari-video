import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { sourceToOutput, outputToSource, resolveCurrent } = require('../lib/common/daihon-time-map.js');
const { sourceToOutput: canonicalSourceToOutput } = require('@akari-video/edit-store');

const segments = [
    { kind: 'src', outStart: 0, outEnd: 2, cutIndex: 0, in: 0, out: 2, speed: 1 },
    { kind: 'src', outStart: 2, outEnd: 4, cutIndex: 1, in: 4, out: 8, speed: 2 }
];

test('sourceToOutput は edit-store 正本と同値である', () => {
    for (const [candidateSegments, sourceT] of [
        [segments, 1.5], [segments, 3], [segments, 4], [segments, 6], [segments, 20], [[], 1]
    ]) {
        assert.equal(
            sourceToOutput(candidateSegments, sourceT),
            canonicalSourceToOutput(candidateSegments, sourceT)
        );
    }
});

test('outputToSource は edit-store の gap 契約を保つ', () => {
    const withGap = [
        { kind: 'src', outStart: 0, outEnd: 1, cutIndex: 0, in: 0, out: 1, speed: 1 },
        { kind: 'gap', outStart: 1, outEnd: 2, cutIndex: null },
        { kind: 'src', outStart: 2, outEnd: 3, cutIndex: 1, in: 3, out: 4, speed: 1 }
    ];
    assert.equal(outputToSource(withGap, 1.5).sourceT, null);
    assert.equal(outputToSource(withGap, 2.5).sourceT, 3.5);
});

test('resolveCurrent は行と0.1秒先行点灯の語を解決する', () => {
    const rows = [{
        id: 'c-0001', start: 0, end: 2, outStart: 0, outEnd: 2, text: 'AB',
        words: [{ text: 'A', start: 0, end: 0.8 }, { text: 'B', start: 1, end: 1.8 }],
        fragmentBreakWordIndex: null, edited: false, timeDomain: 'source'
    }];
    assert.deepEqual(resolveCurrent(rows, 0.91), { rowId: 'c-0001', wordIndex: 1 });
    assert.deepEqual(resolveCurrent(rows, 2.1), { rowId: null, wordIndex: null });
});

test('resolveCurrent は語間の隙間で直前語を既読位置として返す', () => {
    const rows = [{
        id: 'c-0001', start: 0, end: 2, outStart: 0, outEnd: 2, text: 'AB',
        words: [{ text: 'A', start: 0, end: 0.5 }, { text: 'B', start: 1.2, end: 1.8 }],
        fragmentBreakWordIndex: null, edited: false, timeDomain: 'source'
    }];
    assert.deepEqual(resolveCurrent(rows, 0.8), { rowId: 'c-0001', wordIndex: 0 });
});
