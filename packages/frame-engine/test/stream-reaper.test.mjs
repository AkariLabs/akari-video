import assert from 'node:assert/strict';
import test from 'node:test';
import { StreamReaper, planStreamsBySource } from '../dist/index.js';

/** LookaheadFrameSource / ClipSessionPool の解放だけを模した最小のソース。 */
function fakeSource() {
  const live = new Set();
  return {
    live,
    decode() { throw new Error('not used'); },
    open(streamId) { live.add(streamId); },
    liveStreamIds() { return [...live]; },
    releaseStream(streamId) { return live.delete(streamId); },
  };
}

function videoLayer(source, id) {
  return { kind: 'video', id, source, sourceTimeUs: 0, visual: {} };
}

function plan({ base = [], layers = [] } = {}) {
  return { timeUs: 0, base, layers, output: { width: 16, height: 16, colorSpace: 'bt709-limited' } };
}

test('planStreamsBySource は evaluate.ts の decode 要求と同じ streamId を返す', () => {
  const source = fakeSource();
  const mask = fakeSource();
  const result = planStreamsBySource(plan({
    base: [videoLayer(source, 'cut-1'), { kind: 'image', id: 'cut-2', image: {}, sourceTimeUs: 0, visual: {} }],
    layers: [
      { kind: 'matte', id: 'pip', source, sourceTimeUs: 0, mask: { kind: 'greyscale', source: mask, sourceTimeUs: 0 } },
      { kind: 'filter', id: 'lut', filter: { type: 'invert' }, corners: [], opacity: 1 },
    ],
  }));
  assert.deepEqual([...result.get(source)].sort(), ['cut-1', 'layer-pip']);
  assert.deepEqual([...result.get(mask)], ['layer-pip-mask']);
  // 静止画 cut と filter 層は decode を要求しないので stream を持たない
  assert.equal(result.size, 2);
});

test('通り過ぎたカットのセッションは grace を過ぎたら解放される', () => {
  const source = fakeSource();
  const reaper = new StreamReaper([source], { graceFrames: 2 });
  source.open('cut-1');
  reaper.reap(plan({ base: [videoLayer(source, 'cut-1')] }), 0);
  source.open('cut-2');
  const atSwitch = reaper.reap(plan({ base: [videoLayer(source, 'cut-2')] }), 1);
  // 直後は grace 内なので cut-1 は生きたまま
  assert.equal(atSwitch.released, 0);
  assert.deepEqual(source.liveStreamIds(), ['cut-1', 'cut-2']);
  assert.equal(reaper.reap(plan({ base: [videoLayer(source, 'cut-2')] }), 2).released, 0);
  const reaped = reaper.reap(plan({ base: [videoLayer(source, 'cut-2')] }), 3);
  assert.equal(reaped.released, 1);
  assert.equal(reaped.liveStreams, 1);
  assert.deepEqual(source.liveStreamIds(), ['cut-2']);
});

test('トランジション中の送出カットは plan に載っている間ずっと残る', () => {
  const source = fakeSource();
  const reaper = new StreamReaper([source], { graceFrames: 0 });
  source.open('cut-1');
  source.open('cut-2');
  for (let frame = 0; frame < 10; frame += 1) {
    const result = reaper.reap(
      plan({ base: [videoLayer(source, 'cut-1'), videoLayer(source, 'cut-2')] }),
      frame,
    );
    assert.equal(result.released, 0);
  }
  assert.deepEqual(source.liveStreamIds(), ['cut-1', 'cut-2']);
});

test('セッション数は単調に増えず、カット本数に比例しない', () => {
  const source = fakeSource();
  const reaper = new StreamReaper([source], { graceFrames: 1 });
  let peak = 0;
  for (let cut = 0; cut < 60; cut += 1) {
    const streamId = `cut-${cut}`;
    source.open(streamId);
    for (let frame = 0; frame < 30; frame += 1) {
      const result = reaper.reap(plan({ base: [videoLayer(source, streamId)] }), cut * 30 + frame);
      peak = Math.max(peak, result.liveStreams);
    }
  }
  assert.ok(peak <= 2, `live sessions peaked at ${peak}`);
  assert.equal(reaper.liveStreams(), 1);
  assert.equal(reaper.released(), 59);
});

test('reaper を通さずに作られた stream は初見のフレームから測る（即時解放しない）', () => {
  const source = fakeSource();
  const reaper = new StreamReaper([source], { graceFrames: 0 });
  source.open('warmup');
  assert.equal(reaper.reap(plan(), 100).released, 0);
  assert.equal(reaper.reap(plan(), 101).released, 1);
});
