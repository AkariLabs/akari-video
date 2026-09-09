import assert from 'node:assert/strict';
import test from 'node:test';

import { collectEdgeCandidates, resolveSnapTime } from '../lib/common/timeline-snap.js';

// 同じ素材・同尺の 2 本。別レーン端が同レーンの隣接境界を 0.2 ms 越える再現条件。
function fixture(track, edge) {
    const clips = [
        { kind: 'cut', id: 'trim', track, start: 10, end: 20 },
        { kind: 'cut', id: 'copy', track: 1 - track, start: 9.9998, end: 20.0002 },
        { kind: 'cut', id: 'before', track, start: 0, end: 10 },
        { kind: 'cut', id: 'after', track, start: 20, end: 30 }
    ];
    // 左右それぞれ、同尺のコピーをトリム方向に 0.2 ms だけずらす。
    const copy = clips[1];
    if (edge === 'left') copy.end = copy.start + 10;
    else copy.start = copy.end - 10;
    const wouldOverlap = time => {
        const start = edge === 'left' ? time : 10;
        const end = edge === 'right' ? time : 20;
        return clips.some(clip => clip.id !== 'trim' && clip.track === track
            && Math.min(end, clip.end) - Math.max(start, clip.start) > 1e-4);
    };
    const candidates = collectEdgeCandidates(clips, { kind: 'cut', id: 'trim' });
    return { candidates, wouldOverlap, boundary: edge === 'left' ? 10 : 20 };
}

test('同尺 2 レーンの左右境界 ±3px は全て合法（最寄り別レーン端による拒否を再現）', () => {
    let legacyRejections = 0;
    for (const track of [0, 1]) {
        for (const edge of ['left', 'right']) {
            const { candidates, wouldOverlap, boundary } = fixture(track, edge);
            for (const pixelsPerSecond of [100, 10000]) {
                for (let pixels = -3; pixels <= 3; pixels += 0.25) {
                    const raw = boundary + pixels / pixelsPerSecond;
                    const threshold = 6 / pixelsPerSecond;
                    if (wouldOverlap(resolveSnapTime(raw, candidates, threshold).time)) legacyRejections++;
                    const result = resolveSnapTime(raw, candidates, threshold, wouldOverlap);
                    assert.equal(wouldOverlap(result.time), false, `${track}/${edge}/${pixelsPerSecond}/${pixels}px`);
                }
            }
        }
    }
    assert.ok(legacyRejections > 0, 'ガード無しの従来処理では実際に拒否される条件であること');
});

test('吸着だけが重なるときは生の合法値に戻し、ガイド候補も消す', () => {
    const result = resolveSnapTime(9.99, [{ time: 10.0002 }], 0.06, time => time > 10.0001);
    assert.deepEqual(result, { time: 9.99, snapped: false });
});

test('生の値も重なるときは閾値内の同レーン隣接境界への吸着を残す', () => {
    const boundary = { time: 10 };
    const result = resolveSnapTime(10.02, [{ time: 10.0002 }, boundary], 0.06, time => time > 10.0001);
    assert.deepEqual(result, { time: 10, snapped: true, candidate: boundary });
});

test('別レーン端への合法な吸着と、ガード無しの移動・layer の最寄り吸着を残す', () => {
    const crossLane = { time: 10.02, isPlayhead: true };
    const candidates = [{ time: 10 }, crossLane];
    for (const guard of [undefined, () => false]) {
        assert.deepEqual(resolveSnapTime(10.025, candidates, 0.06, guard),
            { time: 10.02, snapped: true, candidate: crossLane });
    }
});

test('合法な境界が閾値外なら本当の同レーン重なりを拒否する', () => {
    const { candidates, wouldOverlap } = fixture(0, 'right');
    const result = resolveSnapTime(20.1, candidates, 0.06, wouldOverlap);
    assert.equal(result.time, 20.1);
    assert.equal(wouldOverlap(result.time), true);
    const noLegalCandidate = resolveSnapTime(20.02, [{ time: 20.0002 }], 0.06, wouldOverlap);
    assert.equal(wouldOverlap(noLegalCandidate.time), true);
});

test('無効な閾値では吸着とフォールバックを行わない', () => {
    for (const threshold of [0, -1, NaN, Infinity]) {
        assert.deepEqual(resolveSnapTime(10.02, [{ time: 10 }], threshold,
            () => { throw new Error('吸着無効時は重なり判定不要'); }), { time: 10.02, snapped: false });
    }
});
