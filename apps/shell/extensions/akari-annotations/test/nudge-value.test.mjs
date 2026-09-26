import test from 'node:test';
import assert from 'node:assert/strict';
import { itemFrameAtPlayhead, nudgeBaseValue, nextNudgeValue } from '../lib/common/nudge-value.js';

const animated = () => ({
    source: { kind: 'shape', shape: 'rect', params: {} },
    transform: { x: 0, y: 10 },
    duration: 150,
    keyframes: [{ t: 0, transform: { x: 0, y: 0 } }, { t: 120, transform: { x: 240, y: 120 } }]
});

test('位置が動きを持つ item は見えている値が基準（静的値ではない）', () => {
    const item = animated();
    // t=60 の見えている値は 0→240 / 0→120 の中間。静的 x=0 ではない
    assert.equal(nudgeBaseValue(item, 60, 'transform.x'), 120);
    assert.equal(nudgeBaseValue(item, 60, 'transform.y'), 60);
    assert.deepEqual(nextNudgeValue({ item, frame: 60, id: 'a', path: 'transform.x', direction: 1, step: 1 }),
        { id: 'a', path: 'transform.x', value: 121 });
});

test('動きが無ければ静的値が基準（位置以外の点しか無くても）', () => {
    const plain = { ...animated(), keyframes: undefined };
    assert.equal(nudgeBaseValue(plain, 60, 'transform.x'), 0);
    assert.equal(nextNudgeValue({ item: plain, frame: 60, id: 'a', path: 'transform.x', direction: -1, step: 10 }).value, -10);
    const sizeOnly = { ...animated(),
        keyframes: [{ t: 0, transform: { scale: 0.5 } }, { t: 100, transform: { scale: 1 } }] };
    assert.equal(nudgeBaseValue(sizeOnly, 60, 'transform.x'), 0);
});

test('同じ item・軸の続きは前回値から足す（keydown 連打）', () => {
    const item = animated();
    const first = nextNudgeValue({ item, frame: 60, id: 'a', path: 'transform.x', direction: 1, step: 1 });
    const second = nextNudgeValue({ item, frame: 60, id: 'a', path: 'transform.x', direction: 1, step: 1, previous: first });
    assert.equal(second.value, 122);
    // 軸が変わったら見えている値から
    assert.equal(nextNudgeValue({ item, frame: 60, id: 'a', path: 'transform.y', direction: 1, step: 1, previous: second }).value, 61);
    // item が変わったら見えている値から
    assert.equal(nextNudgeValue({ item, frame: 60, id: 'b', path: 'transform.x', direction: 1, step: 1, previous: second }).value, 121);
    // 10px まとめ（Shift）
    assert.equal(nextNudgeValue({ item, frame: 60, id: 'a', path: 'transform.x', direction: 1, step: 10, previous: second }).value, 132);
});

test('出力の秒 → item 内フレーム（開始秒を引いて 0..duration に丸める）', () => {
    assert.equal(itemFrameAtPlayhead({ playheadSeconds: 4, itemStartSeconds: 2, durationFrames: 150, fps: 30 }), 60);
    assert.equal(itemFrameAtPlayhead({ playheadSeconds: 1, itemStartSeconds: 2, durationFrames: 150, fps: 30 }), 0);
    assert.equal(itemFrameAtPlayhead({ playheadSeconds: 9, itemStartSeconds: 2, durationFrames: 150, fps: 30 }), 150);
    assert.equal(itemFrameAtPlayhead({ playheadSeconds: undefined, itemStartSeconds: 2, durationFrames: 150, fps: 30 }), 0);
});
