import assert from 'node:assert/strict';
import test from 'node:test';

import { retime } from '../lib/index.js';

function baseEdit(items) {
    return {
        version: 2,
        output: { width: 1920, height: 1080, fps: 30 },
        sources: [{ id: 'a', path: 'a.mp4' }],
        tracks: [{ id: 'v', lane: 'visual', items }],
    };
}

test('retime は開始と終了の境界を個別に round し、素材秒を変更しない', () => {
    const edit = baseEdit([{
        id: 'a', at: 11, duration: 10,
        keyframes: [{ t: 0 }, { t: 7 }],
        source: { kind: 'media', src: 'a', in: 1.25, out: 4.75 },
    }]);
    const result = retime(edit, 24);
    assert.equal(result.output.fps, 24);
    assert.deepEqual(
        [result.tracks[0].items[0].at, result.tracks[0].items[0].duration],
        [Math.round(11 * 0.8), Math.round(21 * 0.8) - Math.round(11 * 0.8)],
    );
    assert.deepEqual(result.tracks[0].items[0].keyframes.map(keyframe => keyframe.t), [0, 6]);
    assert.deepEqual(result.tracks[0].items[0].source, edit.tracks[0].items[0].source);
    assert.notEqual(result, edit);
});

test('retime は同値になった開始境界の順序を保って後続を押し出す', () => {
    const result = retime(baseEdit([
        { id: 'a', at: 0, duration: 15, source: { kind: 'media', src: 'a', in: 0, out: 1 } },
        { id: 'b', at: 1, duration: 15, source: { kind: 'media', src: 'a', in: 1, out: 2 } },
        { id: 'c', at: 2, duration: 15, source: { kind: 'media', src: 'a', in: 2, out: 3 } },
    ]), 10);
    assert.deepEqual(result.tracks[0].items.map(item => item.id), ['a', 'b', 'c']);
    assert.deepEqual(result.tracks[0].items.map(item => item.at), [0, 1, 2]);
});

test('retime は 0 フレーム尺を 1 にし、その増分を同じトラックの後続だけへ伝播する', () => {
    const edit = baseEdit([
        { id: 'a', at: 0, duration: 1, source: { kind: 'media', src: 'a', in: 0, out: 1 } },
        { id: 'b', at: 10, duration: 3, source: { kind: 'media', src: 'a', in: 1, out: 2 } },
    ]);
    edit.tracks.push({
        id: 'other', lane: 'visual', items: [
            { id: 'c', at: 10, duration: 3, source: { kind: 'media', src: 'a', in: 2, out: 3 } },
        ],
    });
    const result = retime(JSON.stringify(edit), 1);
    assert.equal(result.tracks[0].items[0].duration, 1);
    assert.equal(result.tracks[0].items[1].at, 1);
    assert.equal(result.tracks[1].items[0].at, 0);
});

test('retime は audio item の duration: 0 未解決センチネルを保持する', () => {
    const edit = baseEdit([]);
    edit.sources.push({ id: 'voice', path: 'voice.wav' });
    edit.tracks.push({
        id: 'audio', lane: 'audio', items: [{
            id: 'n-0001', at: 30, duration: 0, role: 'narration',
            source: { kind: 'media', src: 'voice', in: 0 },
        }],
    });
    const result = retime(edit, 24);
    assert.deepEqual(
        { at: result.tracks[1].items[0].at, duration: result.tracks[1].items[0].duration },
        { at: 24, duration: 0 },
    );
    assert.deepEqual(result.tracks[1].items[0].source, edit.tracks[1].items[0].source);
});

test('retime は v2 と 1 以上の整数 fps だけを受け付ける', () => {
    assert.throws(() => retime(baseEdit([]), 23.976), /1 以上の整数/);
    assert.throws(() => retime(baseEdit([]), 0), /1 以上の整数/);
    assert.throws(() => retime({ version: 1, cuts: [] }, 30), /v0\/v1 は対象外/);
});

test('retime は量子化を伴う非可逆変換である', () => {
    const original = baseEdit([
        { id: 'a', at: 2, duration: 1, source: { kind: 'media', src: 'a', in: 0, out: 1 } },
    ]);
    const roundTrip = retime(retime(original, 24), 30);
    assert.notDeepEqual(roundTrip.tracks[0].items, original.tracks[0].items);
});
