import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { readInternalEdit } from '@akari-video/edit-store';
import { buildResolvedTimelinePlan, evaluationPlanFromResolvedTimeline } from '../dist/index.js';

const cases = JSON.parse(readFileSync(new URL('../../edit-store/test/transition-projection-characterization-cases.json', import.meta.url), 'utf8'));
const output = { width: 320, height: 180, colorSpace: 'bt709-limited' };
const round = value => typeof value === 'number' ? Math.round((value + Number.EPSILON) * 1e9) / 1e9 : value;
const makeEdit = c => ({
  version: 2,
  output: { width: 1280, height: 720, fps: c.fps },
  sources: c.items.map(item => ({ id: item.id, path: item.path ?? `${item.id}.mp4` })),
  tracks: [{ id: 'visual-main', lane: 'visual', items: c.items.map(item => ({
    id: item.id, at: item.at, duration: item.duration,
    ...(item.locked ? { locked: true } : {}),
    ...(item.opacity !== undefined ? { opacity: item.opacity } : {}),
    ...(item.blend !== undefined ? { blend: item.blend } : {}),
    ...(item.keyframes ? { keyframes: item.keyframes } : {}),
    ...(item.motion ? { motion: item.motion } : {}),
    source: { kind: 'media', src: item.id, in: item.in, out: item.out,
      ...(item.transition !== undefined ? { transition_out: { type: 'dissolve', duration: item.transition } } : {}),
      ...(item.freeze ? { freeze: item.freeze } : {}) }
  })) }]
});
const observedAt = (timeline, sources, t) => {
  const plan = evaluationPlanFromResolvedTimeline(timeline, Math.round(t * 1e6), sources, output);
  return {
    t,
    base: plan.base.map(layer => ({
      id: layer.id, sourceTimeUs: layer.sourceTimeUs,
      ...(layer.visual?.opacity !== undefined ? { opacity: round(layer.visual.opacity) } : {})
    })),
    transition: plan.transition ? { type: plan.transition.type, progress: round(plan.transition.progress) } : null
  };
};
const actualAt = (id, t) => {
  const c = cases.find(candidate => candidate.id === id);
  const edit = makeEdit(c);
  const declarations = readInternalEdit(edit).tracks[0].items
    .filter(item => item.legacy.collection === 'cuts')
    .map(item => item.declaration);
  const sources = new Map(edit.sources.flatMap(source => [
    [source.id, { decode: async () => { throw new Error('not used'); } }],
    [source.path, { decode: async () => { throw new Error('not used'); } }]
  ]));
  return observedAt(buildResolvedTimelinePlan(declarations, { fps: c.fps }), sources, t);
};
const marks = {
  'd-freeze-b': ' [変わりうる: B の既存のフリーズの位置]',
  'g-short-middle': ' [変わりうる: 両端の窓のぶつかり]',
  'j-subframe': ' [変わりうる: 1 コマ未満の窓]',
  'k-no-head': ' [変わりうる: 効かない境目の宣言]'
};

for (const c of cases) {
  test(`${c.id}: FE の要求時刻と進行度${marks[c.id] ?? ''}`, () => {
    const edit = makeEdit(c);
    const internal = readInternalEdit(edit);
    const declarations = internal.tracks[0].items
      .filter(item => item.legacy.collection === 'cuts')
      .map(item => item.declaration);
    const sources = new Map(edit.sources.flatMap(source => [
      [source.id, { decode: async () => { throw new Error('not used'); } }],
      [source.path, { decode: async () => { throw new Error('not used'); } }]
    ]));
    const timeline = buildResolvedTimelinePlan(declarations, { fps: c.fps });
    assert.deepEqual(c.expected.fe.map(sample => observedAt(timeline, sources, sample.t)), c.expected.fe);
  });
}

test('共通の中央 2 件の手計算 sourceSeconds と一致する', () => {
  for (const [id, expected] of [
    ['a-center', [[5_500_000, 2_500_000], [6_000_000, 3_000_000], [6_500_000, 3_500_000]]],
    ['b-speed-both', [[9_000_000, 2_750_000], [10_000_000, 3_000_000], [11_000_000, 3_250_000]]]
  ]) {
    const c = cases.find(candidate => candidate.id === id);
    const edit = makeEdit(c);
    const declarations = readInternalEdit(edit).tracks[0].items.map(item => item.declaration);
    const sources = new Map(edit.sources.map(source => [source.id, { decode: async () => { throw new Error('not used'); } }]));
    const timeline = buildResolvedTimelinePlan(declarations, { fps: 30 });
    assert.deepEqual([3.5, 4, 4.5].map(t =>
      evaluationPlanFromResolvedTimeline(timeline, t * 1e6, sources, output).base.map(layer => layer.sourceTimeUs)
    ), expected);
  }
});

test('B の既存フリーズは宣言で出力位置が 0.5 秒早まる [変わりうる: B の既存のフリーズの位置]', () => {
  const sample = (id, t) => actualAt(id, t).base.at(-1).sourceTimeUs;
  // 宣言あり: 出力 5.5〜6.5 秒は素材 2.5 秒。宣言なし: 出力 6〜7 秒は素材 3 秒。
  assert.deepEqual([5.4, 5.5, 6, 6.5, 6.6].map(t => sample('d-freeze-b', t)),
    [2_400_000, 2_500_000, 2_500_000, 2_500_000, 2_600_000]);
  assert.deepEqual([5.5, 6, 6.5, 7, 7.1].map(t => sample('d-freeze-b-no-transition', t)),
    [2_500_000, 3_000_000, 3_000_000, 3_000_000, 3_100_000]);
});

test('キーフレームの時計は投影後の at から進む', () => {
  assert.deepEqual([3.5, 4, 4.5, 4.6].map(t => actualAt('a-center', t).base.at(-1).opacity),
    [0, 0.125, 0.25, 0.275]);
});

test('B の入場 fade の時計は投影後の at から進む', () => {
  const edit = makeEdit({ fps: 30, items: [
    { id: 'a', at: 0, duration: 120, in: 2, out: 6, transition: 1 },
    { id: 'b', at: 120, duration: 120, in: 2, out: 6,
      motion: { in: { preset: 'fade', duration: 30 } } }
  ] });
  const declarations = readInternalEdit(edit).tracks[0].items.map(item => item.declaration);
  assert.equal(declarations[1].at, 3.5);
  assert.deepEqual(declarations[1].motion, { in: { preset: 'fade', duration: 30 } });
  const timeline = buildResolvedTimelinePlan(declarations, { fps: 30 });
  const sources = new Map(edit.sources.map(source => [source.id, { decode: async () => { throw new Error('not used'); } }]));
  assert.deepEqual([3.4, 3.5, 3.75, 4, 4.25, 4.5, 4.6].map(t => {
    const point = observedAt(timeline, sources, t);
    return [point.base.map(layer => [layer.id, layer.sourceTimeUs, layer.opacity]), point.transition];
  }), [
    [[['cut-0', 5_400_000, 1]], { type: 'hard-cut', progress: 0 }],
    [[['cut-0', 5_500_000, 1], ['cut-1', 1_500_000, 0]], { type: 'dissolve', progress: 0 }],
    [[['cut-0', 5_750_000, 1], ['cut-1', 1_750_000, 0.25]], { type: 'dissolve', progress: 0.25 }],
    [[['cut-0', 6_000_000, 1], ['cut-1', 2_000_000, 0.5]], { type: 'dissolve', progress: 0.5 }],
    [[['cut-0', 6_250_000, 1], ['cut-1', 2_250_000, 0.75]], { type: 'dissolve', progress: 0.75 }],
    [[['cut-0', 6_500_000, 1], ['cut-1', 2_500_000, 1]], { type: 'dissolve', progress: 1 }],
    [[['cut-1', 2_600_000, 1]], { type: 'hard-cut', progress: 0 }]
  ]);
});

test('A の後ろが足りなくても窓で元の out を越える時刻を要求する', () => {
  assert.deepEqual([4, 4.45, 4.5].map(t => actualAt('a-center', t).base[0].sourceTimeUs),
    [6_000_000, 6_450_000, 6_500_000]);
});

test('g の重なる 2 窓では先の窓を返す [変わりうる: 両端の窓のぶつかり]', () => {
  assert.deepEqual([2, 2.1, 2.2].map(t => {
    const point = actualAt('g-short-middle', t);
    return [point.base.map(layer => layer.id), point.transition];
  }), [
    [['cut-0', 'cut-1'], { type: 'dissolve', progress: 0.5 }],
    [['cut-0', 'cut-1'], { type: 'dissolve', progress: 0.75 }],
    [['cut-0', 'cut-1'], { type: 'dissolve', progress: 1 }]
  ]);
});
