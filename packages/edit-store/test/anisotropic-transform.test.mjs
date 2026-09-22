import assert from 'node:assert/strict';
import test from 'node:test';
import { effectiveScale, normalizeTransform } from '../lib/transform.js';
import { composeTransforms, relativeTransform } from '../lib/tree-ops.js';
import { readEditV2 } from '../lib/edit-v2.js';
import { serializeEdit } from '../lib/canonical.js';
import { resolvePreviewItemWrite } from '../lib/edit-v2-item-write.js';

const doc = (transform, kind = 'html') => ({ version: 2, output: { width: 640, height: 360, fps: 30 }, sources: [],
  tracks: [{ id: 'v', lane: 'visual', items: [{ id: 'leaf', at: 0, duration: 60,
    source: kind === 'group' ? { kind } : { kind, path: 'a.html' }, transform }] }] });

test('effective scale prioritizes each axis independently without mutation', () => {
  assert.deepEqual(effectiveScale(), { x: 1, y: 1 });
  const t = { scale: 3, scaleX: 2 };
  assert.deepEqual(effectiveScale(t), { x: 2, y: 3 });
  assert.deepEqual(t, { scale: 3, scaleX: 2 });
  assert.deepEqual(normalizeTransform({ scale: 3, scaleX: 2, scaleY: 2 }), { scale: 2 });
});
test('reader accepts positive leaf axes and rejects invalid axes and group declarations', () => {
  assert.doesNotThrow(() => readEditV2(doc({ scaleX: 2, scaleY: 0.5 })));
  for (const key of ['scale', 'scaleX', 'scaleY']) for (const value of [0, -1, NaN, Infinity]) {
    assert.throws(() => readEditV2(doc({ [key]: value })));
  }
  for (const key of ['scaleX', 'scaleY']) assert.throws(() => readEditV2(doc({ [key]: 1 }, 'group')), /group/);
});
test('rotated uniform parent and anisotropic leaf round trip', () => {
  const parent = { x: 17, y: -9, scale: 2, rotate: 30 };
  const child = { x: 11, y: 7, scale: 1.2, scaleX: 1.5, scaleY: 0.75, rotate: 12 };
  const world = composeTransforms(parent, child);
  assert.equal(world.scaleX, 3); assert.equal(world.scaleY, 1.5);
  const local = relativeTransform(parent, world);
  for (const key of Object.keys(child)) assert.ok(Math.abs(local[key] - child[key]) < 1e-12, key);
  assert.deepEqual(composeTransforms({ scale: 2 }, { scaleX: 3, scaleY: 3 }), { scale: 6 });
});
test('canonical serialization folds equal axes and preserves legacy bytes', () => {
  const legacy = serializeEdit(doc({ rotate: 3, scale: 2, x: 4 }));
  assert.equal(serializeEdit(JSON.parse(legacy)), legacy);
  const value = JSON.parse(serializeEdit(doc({ scaleX: 2, scaleY: 2 })));
  assert.deepEqual(value.tracks[0].items[0].transform, { scale: 2 });
});
test('world axis patch writes local scales through a rotated parent', () => {
  const value = doc({ scale: 2, rotate: 30 }, 'group');
  value.tracks[0].items[0].id = 'parent';
  value.tracks[0].items[0].items = doc({ scaleX: 1.5, scaleY: 0.75 }).tracks[0].items;
  const result = resolvePreviewItemWrite(JSON.stringify(value), { kind: 'overlay', itemId: 'leaf',
    patch: { transform: { scaleX: 6, scaleY: 3 } } });
  const local = JSON.parse(result.candidateText).tracks[0].items[0].items[0].transform;
  assert.deepEqual(effectiveScale(local), { x: 3, y: 1.5 });
});

test('normalization targets item/keyframe transforms and leaves unrelated objects intact', () => {
  const value = doc({ scaleX: 2, scaleY: 2 });
  value.output.extra = { transform: { scaleX: 3, scaleY: 3 } };
  value.tracks[0].items[0].keyframes = [{ t: 0, transform: { scaleX: 2, scaleY: 2 } }, { t: 30, transform: { scale: 3 } }];
  const written = JSON.parse(serializeEdit(value));
  assert.deepEqual(written.tracks[0].items[0].keyframes[0].transform, { scale: 2 });
  assert.deepEqual(written.output.extra, value.output.extra);
});
