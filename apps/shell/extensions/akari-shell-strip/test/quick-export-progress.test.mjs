import test from 'node:test';
import assert from 'node:assert/strict';
import {
    estimateElapsedAndRemaining,
    latestQuickExportProgress,
    parseQuickExportProgressLine
} from '../lib/common/quick-export-progress.js';

test('parseQuickExportProgressLine: out_time_ms/total_ms 行から % を算出', () => {
    assert.deepEqual(parseQuickExportProgressLine('PROGRESS out_time_ms=5000 total_ms=10000'), {
        percent: 50,
        outTimeMs: 5000,
        totalMs: 10000,
        done: false
    });
});

test('parseQuickExportProgressLine: done 行は 100% 確定', () => {
    assert.deepEqual(parseQuickExportProgressLine('PROGRESS done total_ms=10000'), {
        percent: 100,
        outTimeMs: 10000,
        totalMs: 10000,
        done: true
    });
});

test('parseQuickExportProgressLine: 一致しない行は undefined（無視）', () => {
    assert.equal(parseQuickExportProgressLine(''), undefined);
    assert.equal(parseQuickExportProgressLine('PASS: exports/final.mp4'), undefined);
    assert.equal(parseQuickExportProgressLine('{"findings":[]}'), undefined);
    assert.equal(parseQuickExportProgressLine('  PROGRESS out_time_ms=abc total_ms=10  '), undefined);
});

test('parseQuickExportProgressLine: total_ms=0 は 0% に落とす（ゼロ除算を避ける）', () => {
    assert.equal(parseQuickExportProgressLine('PROGRESS out_time_ms=0 total_ms=0').percent, 0);
});

test('latestQuickExportProgress: 複数行のうち最後に見つかった行だけを返す', () => {
    const text = [
        'some other stdout noise',
        'PROGRESS out_time_ms=1000 total_ms=10000',
        'PROGRESS out_time_ms=4000 total_ms=10000',
        'more noise'
    ].join('\n');
    assert.deepEqual(latestQuickExportProgress(text), {
        percent: 40,
        outTimeMs: 4000,
        totalMs: 10000,
        done: false
    });
});

test('latestQuickExportProgress: 一致行が無ければ undefined', () => {
    assert.equal(latestQuickExportProgress('nothing here\nor here'), undefined);
});

test('estimateElapsedAndRemaining: done/100% は残り0固定', () => {
    const snapshot = { percent: 100, outTimeMs: 10000, totalMs: 10000, done: true };
    assert.deepEqual(estimateElapsedAndRemaining(snapshot, 12345), { elapsedMs: 12345, remainingMs: 0 });
});

test('estimateElapsedAndRemaining: 0% は残り時間を計算できず undefined', () => {
    const snapshot = { percent: 0, outTimeMs: 0, totalMs: 10000, done: false };
    assert.deepEqual(estimateElapsedAndRemaining(snapshot, 500), { elapsedMs: 500, remainingMs: undefined });
});

test('estimateElapsedAndRemaining: 線形外挿（50%経過・4秒経過なら残り約4秒）', () => {
    const snapshot = { percent: 50, outTimeMs: 5000, totalMs: 10000, done: false };
    const result = estimateElapsedAndRemaining(snapshot, 4000);
    assert.equal(result.elapsedMs, 4000);
    assert.equal(result.remainingMs, 4000);
});

test('estimateElapsedAndRemaining: 25%経過・3秒経過なら残り約9秒', () => {
    const snapshot = { percent: 25, outTimeMs: 2500, totalMs: 10000, done: false };
    const result = estimateElapsedAndRemaining(snapshot, 3000);
    assert.equal(result.remainingMs, 9000);
});
