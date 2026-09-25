import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { interpolateKeyframes } from '../../overlay-runtime/src/keyframes.mjs';
import { computeLayerKeyframesVisual as webLayerVisual } from '../../preview-server/public/layer-keyframes-visual.js';

const require = createRequire(import.meta.url);
const { activateItemKeyframe, activateItemKeyframeGroup, activateItemTransformKeyframe,
  evaluatedItemTransform, evaluatedItemOpacity, writeItemTransformAt, writeItemOpacityAt,
  removeItemKeyframeGroup, removeItemKeyframePoint, normalizeItemKeyframeGroup } =
  require('../lib/transform-keyframe-edit.js');
const { resolvePreviewItemWrite } = require('../lib/edit-v2-item-write.js');
const { readEditV2 } = require('../lib/edit-v2.js');
const { evaluateItemMotion } = require('../../overlay-runtime/src/item-motion.js');
const { computeLayerKeyframesVisual: shellLayerVisual } =
  require('../../../apps/shell/extensions/akari-preview/lib/common/layer-keyframes-visual.js');

const html = () => ({ id: 'item', at: 0, duration: 150,
  source: { kind: 'html', path: 'overlays/title.html' },
  transform: { x: 12, y: 25, scale: .8, rotate: 7 }, opacity: .7 });
const realPoints = item => (item.keyframes ?? []).filter(p => p.transform || p.opacity !== undefined);
const at = (item, frame) => ({ ...evaluatedItemTransform(item, frame), opacity: evaluatedItemOpacity(item, frame) });

test('a late diamond creates one declared point and keeps the static pose in sync', () => {
  const initial = html();
  const next = activateItemTransformKeyframe(initial, 123, 'x');
  assert.deepEqual(initial.keyframes, undefined);
  assert.equal(realPoints(next).length, 1);
  assert.equal(realPoints(next)[0].t, 123);
  assert.deepEqual(realPoints(next)[0].transform, { x: 12, y: 25 });
  assert.equal(next.keyframes.length, 2); // schema-minimum empty entry, not a second value
  assert.deepEqual(next.transform, initial.transform);
  const edit = { version: 2, output: { width: 640, height: 360, fps: 30 }, sources: [],
    tracks: [{ id: 'v', lane: 'visual', items: [next] }] };
  assert.doesNotThrow(() => readEditV2(edit));
});

test('late → early → middle moves write paired X/Y points and hold through seeks', () => {
  let item = activateItemTransformKeyframe(html(), 123, 'x');
  item = writeItemTransformAt(item, 11, { x: 145, y: 90 });
  item = writeItemTransformAt(item, 70, { x: -40, y: 70 });
  assert.deepEqual(realPoints(item).map(p => p.t), [11, 70, 123]);
  for (const frame of [0, 11, 70, 123, 149]) {
    const point = at(item, frame);
    assert.ok(Math.abs(point.x - evaluateItemMotion({ ...item, fps: 30 }, frame / 30).x) < 1e-6);
    assert.ok(Math.abs(point.y - evaluateItemMotion({ ...item, fps: 30 }, frame / 30).y) < 1e-6);
  }
  for (const point of realPoints(item)) assert.deepEqual(Object.keys(point.transform).sort(), ['x', 'y']);
});

test('an unkeyed time auto-keys its animated group in one preview write', () => {
  const item = activateItemTransformKeyframe(html(), 123, 'x');
  const edit = { version: 2, output: { width: 640, height: 360, fps: 30 }, sources: [],
    tracks: [{ id: 'v', lane: 'visual', items: [item] }] };
  const before = JSON.stringify(edit);
  const result = resolvePreviewItemWrite(before, { kind: 'overlay', itemId: 'item', playheadSeconds: 3,
    patch: { transform: { x: 200 } } });
  const written = JSON.parse(result.candidateText).tracks[0].items[0];
  assert.deepEqual(realPoints(written).map(p => p.t), [90, 123]);
  assert.deepEqual(realPoints(written)[0].transform, { x: 200, y: 25 });
  assert.equal(at(written, 90).x, 200);
  assert.deepEqual(JSON.parse(before).tracks[0].items[0], item); // one snapshot undoes one write
});

test('group deletion keeps other groups and freezes the last visible group value', () => {
  let item = activateItemKeyframe(html(), 60);
  item = writeItemTransformAt(item, 60, { x: 80, y: 40 });
  item = removeItemKeyframeGroup(item, 60, 'position');
  assert.equal(realPoints(item)[0].transform.x, undefined);
  assert.equal(realPoints(item)[0].transform.y, undefined);
  assert.equal(realPoints(item)[0].transform.rotate, 7);
  assert.equal(item.transform.x, 80);
  assert.equal(item.transform.y, 40);
  item = removeItemKeyframePoint(item, 60);
  assert.equal(item.keyframes, undefined);
  assert.equal(item.opacity, .7);
});

test('legacy sparse axes are filled at each existing point’s evaluated time on the next write', () => {
  const item = { ...html(), keyframes: [
    { t: 0, transform: { x: 0 } }, { t: 30, transform: { y: 40 } },
    { t: 60, transform: { x: 100 } }] };
  const original = [0, 30, 60].map(frame => at(item, frame));
  const next = writeItemTransformAt(item, 45, { x: 75 });
  for (const [index, frame] of [0, 30, 60].entries()) {
    const point = next.keyframes.find(p => p.t === frame);
    assert.equal(point.transform.x, original[index].x);
    assert.equal(point.transform.y, original[index].y);
  }
  assert.deepEqual(item.keyframes[1].transform, { y: 40 });
  assert.equal(normalizeItemKeyframeGroup(item, 'position').keyframes[1].transform.x, original[1].x);
});

test('size and opacity axes share group points; media points remain complete', () => {
  let item = activateItemKeyframeGroup(html(), 75, 'size');
  item = writeItemTransformAt(item, 25, { scaleX: 1.2 });
  for (const point of realPoints(item)) for (const axis of ['scale', 'scaleX', 'scaleY']) {
    assert.equal(typeof point.transform[axis], 'number');
  }
  item = activateItemKeyframeGroup(item, 75, 'opacity');
  item = writeItemOpacityAt(item, 25, .3);
  assert.deepEqual(realPoints(item).map(p => p.opacity), [.3, .7]);
  const media = { ...html(), source: { kind: 'media', src: 'still', in: 0, out: 5 } };
  const keyed = activateItemTransformKeyframe(media, 75, 'x');
  assert.deepEqual(realPoints(keyed)[0].transform,
    { x: 12, y: 25, scale: .8, scaleX: .8, scaleY: .8, rotate: 7 });
});

test('five evaluators agree on complete points: 1/2/3 points, with and without easing', () => {
  for (const count of [1, 2, 3]) for (const easing of [false, true]) {
    const values = [
      { t: 0, transform: { x: -100, y: 25, scale: .5, scaleX: .5, scaleY: .5, rotate: -30 }, opacity: .2 },
      { t: 60, transform: { x: 100, y: -45, scale: 1.5, scaleX: 1.5, scaleY: 1.5, rotate: 90 }, opacity: .8 },
      { t: 120, transform: { x: 40, y: 70, scale: 1, scaleX: 1, scaleY: 1, rotate: 15 }, opacity: .5 }
    ].slice(0, count).map((point, index) => easing && index > 0 ? { ...point, easing: 'ease-in-out' } : point);
    const item = { ...html(), transform: { ...values[0].transform }, opacity: values[0].opacity,
      keyframes: count === 1 ? [values[0], { t: 1 }] : values };
    const secondsPoints = item.keyframes.map(point => ({ ...point, t: point.t / 30 }));
    for (const frame of [0, 15, 30, 60, 90, 120, 149]) {
      const motion = evaluateItemMotion({ ...item, fps: 30 }, frame / 30);
      const linear = interpolateKeyframes(item.keyframes, frame,
        { statics: { ...item.transform, opacity: item.opacity } });
      const store = at(item, frame);
      const shell = shellLayerVisual(secondsPoints, frame / 30, item.transform);
      const web = webLayerVisual(secondsPoints, frame / 30);
      for (const field of ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotate', 'opacity']) {
        const outcomes = [motion[field], linear[field], store[field],
          field === 'opacity' ? shell.opacity : shell.transform[field],
          field === 'opacity' ? web.opacity : web.transform[field]];
        for (const value of outcomes) assert.ok(Math.abs(value - outcomes[0]) < 1e-5,
          `${field} count=${count} easing=${easing} frame=${frame}: ${outcomes.join(', ')}`);
      }
    }
  }
});
