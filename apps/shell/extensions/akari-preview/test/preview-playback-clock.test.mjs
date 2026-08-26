import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { outputTimeForSourceClock, resolveSourceClockPosition } from '../lib/common/preview-playback-clock.js';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'src', 'browser', 'akari-preview-open-handler.ts'), 'utf8');

test('two-source boundary holds the output clock while the next media clock is not ready', () => {
    const secondCut = { outStart: 6, outEnd: 11, in: 0.5, speed: 1 };
    assert.equal(outputTimeForSourceClock(secondCut, 0, 6, false), 6);
    assert.equal(outputTimeForSourceClock(secondCut, 0.5, 6, true), 6);
    assert.equal(outputTimeForSourceClock(secondCut, 1.25, 6, true), 6.75);
});

test('source swap gates every output-clock consumer until metadata seek completes', () => {
    assert.match(source, /let sourceSwapPending = false/);
    assert.match(source, /sourceSwapPending = true;[\s\S]*onReady\(\);[\s\S]*sourceSwapPending = false;[\s\S]*tick\(true\)/);
    assert.match(source, /outputTimeForSourceClockFn\([\s\S]*!sourceSwapPending[\s\S]*\)/);
    assert.match(source, /if \(!sourceSwapPending\) applyKeepRangeBoundary\(\)/);
});

test('overlapping source seconds never select a segment from another source', () => {
    const segments = [
        { kind: 'src', src: 'a', in: 0, out: 6, outStart: 0, outEnd: 6 },
        { kind: 'src', src: 'b', in: 0.5, out: 5.5, outStart: 6, outEnd: 11 }
    ];
    assert.deepEqual(
        resolveSourceClockPosition(segments, 0, 1),
        { index: 1, time: 0.5, ended: false }
    );
    assert.deepEqual(
        resolveSourceClockPosition(segments, 1, 1),
        { index: 1, time: 1, ended: false }
    );
    assert.match(source, /resolveSourceClockPositionFn\(segments, sourceTime, preferredIndex\)/);
});

test('duplicated same-source ranges resolve to the segment nearest the preferred index, not the first in the array', () => {
    // 同じ B ロール範囲の再利用（や、ほぼ同一 in/out のマット窓の並び）では、複数セグメントが
    // 同一 src・重複ソース範囲を持つ。後方の窓を再生中に一致探索が最前の窓を返すと、
    // 出力クロックが後退して再生ヘッドが巻き戻る（2026-08-26 akari-reel 実機ループの一因）。
    const segments = [
        { kind: 'src', src: 'broll', in: 0, out: 4.3, outStart: 3, outEnd: 7.3 },
        { kind: 'src', src: 'main', in: 56, out: 60, outStart: 7.3, outEnd: 11.3 },
        { kind: 'src', src: 'broll', in: 0, out: 4.3, outStart: 11.3, outEnd: 15.6 },
        { kind: 'src', src: 'broll', in: 0, out: 2.5, outStart: 15.6, outEnd: 18.1 }
    ];
    // preferred = 3 番目の broll 窓のとき、その手前の窓ではなく preferred 自身が勝つ
    assert.deepEqual(
        resolveSourceClockPosition(segments, 1.5, 2),
        { index: 2, time: 1.5, ended: false }
    );
    // preferred の範囲外に出たクロックでも、最前の窓へは吸い付かず
    // preferredIndex に最も近い一致を選ぶ
    assert.deepEqual(
        resolveSourceClockPosition(segments, 3.0, 3),
        { index: 2, time: 3.0, ended: false }
    );
    const spread = [
        { kind: 'src', src: 'broll', in: 0, out: 4, outStart: 0, outEnd: 4 },
        { kind: 'src', src: 'broll', in: 10, out: 14, outStart: 4, outEnd: 8 },
        { kind: 'src', src: 'broll', in: 0, out: 4, outStart: 8, outEnd: 12 }
    ];
    // 同距離の一致が前後にあるときは前方（後の出力時刻）を選び、後退よりも前進へ倒す
    assert.deepEqual(
        resolveSourceClockPosition(spread, 1, 1),
        { index: 2, time: 1, ended: false }
    );
});
