import assert from 'node:assert/strict';
import test from 'node:test';
import { activateItemTransformKeyframe, evaluatedItemTransform, writeItemTransformAt } from '../lib/transform-keyframe-edit.js';
import { resolvePreviewItemWrite } from '../lib/edit-v2-item-write.js';

const item = (kind = 'html') => ({ id: kind, at: 0, duration: 180,
  transform: { x: -38.4, y: 39.6, scale: 1.12, scaleX: 1.305, scaleY: 1.08, rotate: 24.73 },
  source: kind === 'media' ? { kind: 'media', src: 'still', in: 0, out: 6 }
    : { kind: 'html', path: 'overlays/card.html' } });
const pose = (value, t) => evaluatedItemTransform(value, t);

test('toggle-on preserves HTML anisotropic size and media position/angle at both seeded points', () => {
  for (const kind of ['html', 'media']) {
    let value = item(kind);
    const before = pose(value, 30);
    value = activateItemTransformKeyframe(value, 30, 'x');
    assert.deepEqual(pose(value, 30), before);
    assert.deepEqual(pose(value, 0), before);
    value = activateItemTransformKeyframe(value, 30, 'scale');
    for (const time of [0, 30]) for (const field of ['x', 'y', 'scaleX', 'scaleY', 'rotate']) {
      assert.equal(pose(value, time)[field], before[field]);
    }
    assert.equal(value.keyframes.length, 2);
    assert.ok(value.keyframes.find(point => point.t === 30).transform.x === before.x);
  }
});

test('HTML overall scale preserves axis ratio; width edits one axis in unitless storage', () => {
  let value = activateItemTransformKeyframe(item(), 30, 'scale');
  value = writeItemTransformAt(value, 30, { scale: 1.26 });
  const at30 = pose(value, 30);
  assert.ok(Math.abs(at30.scaleX / at30.scaleY - 1.305 / 1.08) < 1e-9);
  assert.ok(Math.abs(Math.sqrt(at30.scaleX * at30.scaleY) - 1.26) < 1e-9);
  value = writeItemTransformAt(value, 60, { scaleX: 1.41 });
  assert.equal(value.keyframes.find(point => point.t === 60).transform.scaleX, 1.41);
  assert.equal(value.transform.scaleX, 1.305);
  assert.equal(pose(value, 60).scaleY, at30.scaleY);
});

test('overall scale at an axis-keyed time updates both axes at that time', () => {
  let value = activateItemTransformKeyframe(item(), 30, 'scaleX');
  value = writeItemTransformAt(value, 60, { scale: 1.3 });
  const point = value.keyframes.find(entry => entry.t === 60);
  assert.ok(point.transform.scaleX > 1.305);
  assert.ok(point.transform.scaleY > 1.08);
  assert.ok(Math.abs(Math.sqrt(point.transform.scaleX * point.transform.scaleY) - 1.3) < 1e-9);
  assert.equal(value.transform.scale, 1.12);
});

test('enabled field writes at, between, and outside points without changing the static base', () => {
  let value = item();
  value.keyframes = [
    { t: 30, transform: { x: -45, y: -18, scale: .8, rotate: -12 } },
    { t: 90, transform: { x: 62, y: 33, scale: 1.25, rotate: 28 } }
  ];
  const base = structuredClone(value.transform);
  for (const [t, next] of [[30, -19], [60, 53], [120, 77]]) {
    value = writeItemTransformAt(value, t, { x: next });
    assert.equal(value.keyframes.find(point => point.t === t).transform.x, next);
    assert.equal(pose(value, t).x, next);
  }
  assert.deepEqual(value.transform, base);
  value = writeItemTransformAt(value, 60, { y: 41, rotate: 35 });
  assert.equal(pose(value, 60).y, 41);
  assert.equal(pose(value, 60).rotate, 35);
});

test('HTML and media evaluators use their respective easing rules', () => {
  const html = item();
  html.keyframes = [{ t: 30, transform: { x: 0 } }, { t: 90, transform: { x: 100 }, easing: 'hold' }];
  assert.equal(pose(html, 60).x, 0);
  const media = item('media');
  media.keyframes = [{ t: 30, transform: { x: 0 } }, { t: 90, transform: { x: 100 }, easing: 'ease-in-out' }];
  assert.equal(pose(media, 60).x, 50);
});

test('preview patch updates the playhead point, and one snapshot undo restores the exact item', () => {
  const html = activateItemTransformKeyframe(item(), 30, 'x');
  const edit = { version: 2, output: { width: 640, height: 360, fps: 30 }, sources: [],
    tracks: [{ id: 'v', lane: 'visual', items: [html] }] };
  const before = JSON.stringify(edit);
  const result = resolvePreviewItemWrite(before, {
    kind: 'overlay', itemId: 'html', playheadSeconds: 2,
    patch: { transform: { x: 77 } }
  });
  const after = JSON.parse(result.candidateText);
  assert.equal(after.tracks[0].items[0].keyframes.find(point => point.t === 60).transform.x, 77);
  assert.equal(after.tracks[0].items[0].transform.x, -38.4);
  const history = { before, after: result.candidateText };
  assert.deepEqual(JSON.parse(history.before).tracks[0].items[0], html);
  assert.notDeepEqual(JSON.parse(history.after).tracks[0].items[0], html);
});

test('media preview edit fills a complete point and retains it after a seek round trip', () => {
  let value = activateItemTransformKeyframe(item('media'), 30, 'x');
  value = writeItemTransformAt(value, 60, { x: 51, y: 22, scale: 1.4, rotate: 31 });
  assert.equal(pose(value, 60).x, 51);
  assert.equal(pose(value, 90).x, 51);
  assert.equal(pose(value, 60).rotate, 31);
  assert.equal(value.keyframes.find(point => point.t === 60).transform.y, 22);
  assert.equal(value.transform.x, -38.4);
});
