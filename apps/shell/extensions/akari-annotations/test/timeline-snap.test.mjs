import assert from 'node:assert/strict';
import test from 'node:test';

import {
    SNAP_ENABLED_DEFAULT,
    SNAP_ENABLED_STORAGE_KEY,
    collectEdgeCandidates,
    nearestSnapCandidate,
    readStoredSnapEnabled,
    resolveSnapRange,
    resolveSnapTime,
    snapThresholdSecondsFor,
    writeStoredSnapEnabled
} from '../lib/common/timeline-snap.js';

class MemoryStorage {
    values = new Map();
    getItem(key) { return this.values.get(key) ?? null; }
    setItem(key, value) { this.values.set(key, value); }
}

test('閾値内に候補が無ければそのままの値を返す（0.25 秒グリッドへは落ちない）', () => {
    // 実機 2026-09-02: 140 px/s・閾値 6 px（≈0.043 s）で 4.7706 s へ置くと 4.75 へ吸着していた
    const result = resolveSnapTime(4.7706, [{ time: 0 }, { time: 4.4 }, { time: 6.6 }], 6 / 140);
    assert.equal(result.snapped, false);
    assert.equal(result.time, 4.7706);
    assert.equal(result.candidate, undefined);
});

test('閾値内の最寄り候補へ吸着し、候補を返す', () => {
    const playhead = { time: 9.5, isPlayhead: true };
    const result = resolveSnapTime(9.52, [{ time: 9.0 }, playhead, { time: 10 }], 0.05);
    assert.equal(result.snapped, true);
    assert.equal(result.time, 9.5);
    assert.equal(result.candidate, playhead);
});

test('閾値ちょうどは吸着し、閾値を超えると吸着しない', () => {
    // 2 進で正確に表せる値で境界を見る（0.05 のような値は丸め誤差で境界が揺れる）
    assert.equal(resolveSnapTime(1.5, [{ time: 1 }], 0.5).snapped, true);
    assert.equal(resolveSnapTime(1.5000001, [{ time: 1 }], 0.5).snapped, false);
});

test('閾値が無効（0・負・非有限）なら吸着しない', () => {
    for (const threshold of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        const result = resolveSnapTime(1.001, [{ time: 1 }], threshold);
        assert.equal(result.snapped, false, `threshold=${threshold}`);
        assert.equal(result.time, 1.001);
    }
});

test('非有限な候補は無視する', () => {
    assert.equal(nearestSnapCandidate([{ time: Number.NaN }, { time: 2 }], 1.9)?.time, 2);
    assert.equal(nearestSnapCandidate([], 1), undefined);
});

test('区間移動は始点と終点の近い方へ寄せ、返す time は始点', () => {
    // 終点 3.02 が候補 3.0 に近い → 始点は 3.0 - 2 = 1.0
    const byEnd = resolveSnapRange(1.02, 2, [{ time: 3.0 }, { time: 0.5 }], 0.05);
    assert.equal(byEnd.snapped, true);
    assert.ok(Math.abs(byEnd.time - 1.0) < 1e-9);
    // 始点 0.52 が候補 0.5 に近い → 始点は 0.5
    const byStart = resolveSnapRange(0.52, 2, [{ time: 0.5 }, { time: 9 }], 0.05);
    assert.equal(byStart.snapped, true);
    assert.equal(byStart.time, 0.5);
});

test('区間移動でも閾値内に候補が無ければ始点をそのまま返す', () => {
    // 実機 2026-09-02: 9.4201 s へ置くと 9.5 へ 11 px 跳んでいた
    const result = resolveSnapRange(9.4201, 2, [{ time: 8.8 }, { time: 10.8 }, { time: 0 }], 6 / 140);
    assert.equal(result.snapped, false);
    assert.equal(result.time, 9.4201);
});

test('端の候補はドラッグ中の本人を除いて始点・終点を集める', () => {
    const items = [
        { kind: 'caption', id: 'c-1', start: 0, end: 2 },
        { kind: 'caption', id: 'c-2', start: 2.2, end: 4.2 },
        { kind: 'cut', id: '0', start: 0, end: 30 }
    ];
    const times = collectEdgeCandidates(items, { kind: 'caption', id: 'c-2' }).map(c => c.time);
    assert.deepEqual(times, [0, 2, 0, 30]);
    assert.equal(collectEdgeCandidates(items).length, 6);
});

test('px 閾値は表示幅と表示秒数から秒へ換算し、幅が無ければ undefined', () => {
    assert.ok(Math.abs(snapThresholdSecondsFor(6, 825, 100) - 6 / 8.25) < 1e-12);
    assert.equal(snapThresholdSecondsFor(6, 0, 100), undefined);
    assert.equal(snapThresholdSecondsFor(6, 825, 0), undefined);
});

test('マグネットの既定は OFF で、保存値 1/0 だけを読む', () => {
    assert.equal(SNAP_ENABLED_DEFAULT, false);
    const storage = new MemoryStorage();
    assert.equal(readStoredSnapEnabled(storage), false);
    assert.equal(readStoredSnapEnabled(undefined), false);
    storage.setItem(SNAP_ENABLED_STORAGE_KEY, 'yes');
    assert.equal(readStoredSnapEnabled(storage), false);
    writeStoredSnapEnabled(storage, true);
    assert.equal(storage.getItem(SNAP_ENABLED_STORAGE_KEY), '1');
    assert.equal(readStoredSnapEnabled(storage), true);
    writeStoredSnapEnabled(storage, false);
    assert.equal(readStoredSnapEnabled(storage), false);
});

test('storage が例外を投げても既定値で続行する', () => {
    const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    assert.equal(readStoredSnapEnabled(broken), false);
    assert.doesNotThrow(() => writeStoredSnapEnabled(broken, true));
});
