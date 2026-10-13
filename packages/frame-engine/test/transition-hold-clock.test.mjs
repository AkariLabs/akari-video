import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { readInternalEdit } from '../../edit-store/lib/index.js';
import { buildResolvedTimelinePlan, evaluationPlanFromResolvedTimeline } from '../dist/index.js';

const cases = JSON.parse(readFileSync(new URL('../../edit-store/test/transition-plan-cases.json', import.meta.url), 'utf8')).hold;
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: ${actual} != ${expected}`);
const output = { width: 320, height: 180, colorSpace: 'bt709-limited' };
const video = { async decode() { throw new Error('evaluation must not decode'); } };
const frames = (seconds, fps) => Math.round(seconds * fps);
const projectedCuts = (entry, fill = true) => {
  const document = {
    version: 2, output: { width: 320, height: 180, fps: entry.fps },
    sources: [...new Set(entry.cuts.map(cut => cut.src))].map(id => ({ id, path: `${id}.mp4` })),
    tracks: [{ id: 'main', lane: 'visual', items: entry.cuts.map((cut, index) => ({
      id: `c${index + 1}`, at: frames(cut.at, entry.fps),
      duration: frames((cut.out - cut.in) / (cut.speed ?? 1) + (cut.freeze?.duration_sec ?? 0), entry.fps),
      source: { kind: 'media', src: cut.src, in: cut.in, out: cut.out,
        ...(cut.speed ? { speed: cut.speed } : {}),
        ...(cut.freeze ? { freeze: cut.freeze } : {}),
        ...(cut.transitionOut ? { transition_out: fill ? cut.transitionOut
          : { ...cut.transitionOut, fill: undefined } } : {}) }
    })) }]
  };
  return readInternalEdit(document).tracks[0].items.map(item => ({
    ...item.declaration, transitionOut: item.declaration.transition_out
  }));
};
const sourceSeconds = (plan, id) => {
  const layer = plan.base.find(value => value.id === `cut-${id}`)
    ?? plan.layers.find(value => value.id === `cut-${id}`);
  return layer?.sourceTimeUs / 1e6;
};

for (const entry of cases) {
  test(`frame engine preserves raw ends with and without fill: ${entry.name}`, () => {
    for (const fill of [true, false]) {
      const timeline = buildResolvedTimelinePlan(projectedCuts(entry, fill), { fps: entry.fps });
      for (let index = 1; index < entry.cuts.length; index += 1) {
        const raw = entry.cuts[index];
        // Without fill, the projected extension of this cut's own filled boundary may differ.
        if (!fill && raw.transitionOut?.fill) continue;
        const rawEnd = raw.at + (raw.out - raw.in) / (raw.speed ?? 1)
          + (raw.freeze?.duration_sec ?? 0);
        const extension = raw.transitionOut
          ? (entry.expected.projected[index].out - raw.out) / (raw.speed ?? 1) : 0;
        near(timeline.cuts[index].end, rawEnd + extension, `${fill} cut end ${index}`);
      }
      near(timeline.totalDuration, entry.expected.totalSeconds, `${fill} total duration`);
    }
  });

  test(`frame engine keeps the incoming source clock: ${entry.name}`, () => {
    const cuts = projectedCuts(entry);
    const warnings = [];
    const timeline = buildResolvedTimelinePlan(cuts, { fps: entry.fps, onWarning: warning => warnings.push(warning) });
    const sources = new Map(entry.cuts.map(cut => [cut.src, video]));
    assert.equal(warnings.some(warning => warning.includes('transitionHold')), false);
    near(timeline.totalDuration, entry.expected.totalSeconds, 'total duration');
    const noHold = buildResolvedTimelinePlan(cuts.map(cut => ({ ...cut, transitionHold: undefined })), { fps: entry.fps });
    for (const sample of entry.expected.samples) {
      const current = evaluationPlanFromResolvedTimeline(timeline, Math.round(sample.t * 1e6), sources, output);
      near(sourceSeconds(current, 0), sample.outgoing, `outgoing at ${sample.t}`);
      near(sourceSeconds(current, 1), sample.incoming, `incoming at ${sample.t}`);
      if (sample.t >= cuts[1].at && (cuts[1].transitionHold?.headSeconds ?? 0) > 0) {
        const ordinary = evaluationPlanFromResolvedTimeline(noHold, Math.round(sample.t * 1e6), sources, output);
        near(sourceSeconds(current, 1), sourceSeconds(ordinary, 1), `ordinary clock at ${sample.t}`);
      }
    }
    const hold = cuts[1].transitionHold?.headSeconds ?? 0;
    if (hold > 0) {
      const before = cuts[1].at - hold / 2;
      const current = evaluationPlanFromResolvedTimeline(timeline, Math.round(before * 1e6), sources, output);
      near(sourceSeconds(current, 1), cuts[1].in, 'held first frame');
      near(Math.max(0, before - timeline.cuts[1].at), 0, 'local seconds');
      near(timeline.cuts[1].at, cuts[1].at, 'placement at');
    }
  });
}

test('the held head keeps cut keyframes at local zero and leaves upper layers on their own clock', () => {
  const entry = cases.find(value => value.expected.projected[1].hold === 1);
  assert.ok(entry);
  const cuts = projectedCuts(entry);
  cuts[1] = { ...cuts[1], keyframes: [
    { t: 0, crop: { x: 0, y: 0, w: 0.5, h: 0.5 } },
    { t: 1, crop: { x: 0.5, y: 0, w: 0.5, h: 0.5 } },
  ] };
  const layer = { id: 'upper', kind: 'video', src: 'upper', t: 4, duration: 2, in: 2 };
  const timeline = buildResolvedTimelinePlan(cuts, { fps: entry.fps, layers: [layer] });
  const plain = buildResolvedTimelinePlan(cuts.map(cut => ({ ...cut, transitionHold: undefined })),
    { fps: entry.fps, layers: [layer] });
  const sources = new Map([...entry.cuts.map(cut => [cut.src, video]), ['upper', video]]);
  const before = evaluationPlanFromResolvedTimeline(timeline, 4500000, sources, output);
  const at = evaluationPlanFromResolvedTimeline(timeline, 5000000, sources, output);
  const after = evaluationPlanFromResolvedTimeline(timeline, 5500000, sources, output);
  assert.equal(before.base[1].visual.layerStyle.crop.x, 0);
  assert.equal(at.base[1].visual.layerStyle.crop.x, 0);
  assert.equal(after.base[0].visual.layerStyle.crop.x, 0.25);
  const upper = plan => plan.layers.find(value => value.id === 'upper').sourceTimeUs;
  near(upper(before), upper(evaluationPlanFromResolvedTimeline(plain, 4500000, sources, output)),
    'upper layer clock');
});
