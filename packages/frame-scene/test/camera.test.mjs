import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { focalFov, resolveScene, cameraAt, describe, resolvedHash, validateFrameScene, importCanvas3d, classifyMove } from '../src/index.mjs';

const minimal = { schema: 'akari.frame-scene', version: 0, objects: [{ id: 'desk', kind: 'shape', shape: 'box', size: [100, 50, 100], at: [0, 0, 0] }, { id: 'phone', kind: 'model', asset: 'scene3d/phone', at: [0, 0], on: 'desk', facing: 'camera' }], scenes: [{ id: 's1', camera: { pos: [0, 100, 300], look: [0, 50, 0] }, camera_to: { pos: [0, 100, 200] }, ease: 'inOut' }] };
const round2 = n => Number(n.toFixed(2));

test('focal FOV follows PerspectiveCamera.setFocalLength', () => {
  // Three.js filmHeight = 35 / max(aspect, 1); v = 2 atan(filmHeight / 2f).
  // h = 2 atan(tan(v/2) * aspect). Angles below are radians * 180 / PI.
  const cases = [
    ['16:9', 35, 31.42, 53.13],
    ['9:16', 50, 38.58, 22.28],
    ['1:1', 35, 53.13, 53.13],
    ['4:5', 35, 53.13, 43.60]
  ];
  for (const [aspect, focal, vertical, horizontal] of cases) {
    const got = focalFov(focal, aspect);
    assert.equal(round2(got.vertical), vertical, aspect);
    assert.equal(round2(got.horizontal), horizontal, aspect);
  }
});

test('A to B camera, easing, ground and facing', () => {
  const resolved = resolveScene(minimal, 's1', { assetInfo: id => id === 'scene3d/phone' ? { size_cm: [10, 20, 2] } : undefined });
  assert.equal(resolved.objects[1].at[1], 50);
  assert.equal(resolved.objects[1].rot[1], 0);
  assert.deepEqual(cameraAt(resolved, 0).pos, [0, 100, 300]);
  assert.deepEqual(cameraAt(resolved, 1).pos, [0, 100, 200]);
  assert.deepEqual(cameraAt(resolved, 0.5).pos, [0, 100, 250]);
  assert.equal(classifyMove(resolved.scene.camera, resolved.scene.camera_to).move, 'push-in');
  const moved = structuredClone(minimal); moved.objects[0].at = [100, 0, 0]; moved.objects[1].facing = 'desk';
  assert.equal(round2(resolveScene(moved, 's1').objects[1].rot[1]), 90);
});

test('prototype import validates and projects all eight boxes', () => {
  const input = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./fixtures/canvas3d-example-01.json', import.meta.url)), 'utf8'));
  const { doc, warnings } = importCanvas3d(input);
  assert.equal(validateFrameScene(doc).ok, true);
  assert.equal(warnings.length, 4);
  const assetInfo = id => {
    const source = input.objects.find(o => id === undefined ? o.shape === 'person' : id === `scene3d/${o.asset}` || id === `assets/${o.fileName}`);
    return source?.sizeM ? { size_cm: source.sizeM.map(n => n * 100) } : undefined;
  };
  const resolved = resolveScene(doc, 's1', { assetInfo });
  for (const object of describe(resolved, { assetInfo }).objects) {
    const expected = input.objects.find(o => o.id === object.id)?.inShot?.box;
    assert.ok(expected, object.id);
    for (const key of ['x', 'y', 'w', 'h']) assert.ok(Math.abs(object.box[key] - expected[key]) <= 0.02, `${object.id}.${key}: ${object.box[key]} vs ${expected[key]}`);
  }
});

test('resolved hash ignores source key order and sub-centimeter rounding noise', () => {
  const a = resolveScene(minimal, 's1');
  assert.equal(resolvedHash(a), resolvedHash(a));
  const reordered = Object.fromEntries(Object.entries(a).reverse());
  assert.equal(resolvedHash(a), resolvedHash(reordered));
  const noisy = structuredClone(a); noisy.objects[0].at[0] += 0.001;
  assert.equal(resolvedHash(a), resolvedHash(noisy));
  const annotated = structuredClone(a); annotated.scene.annotations = [{ id: 'a1', type: 'pen', x: 0.5, y: 0.5 }];
  const shifted = structuredClone(annotated); shifted.scene.annotations[0].x += 0.001;
  assert.notEqual(resolvedHash(annotated), resolvedHash(shifted));
});

test('anchor follows projected target and offscreen target is omitted', () => {
  const doc = structuredClone(minimal);
  doc.scenes[0].annotations = [{ id: 'a1', type: 'arrow', anchor: { object: 'phone' } }];
  const visible = describe(resolveScene(doc, 's1', { assetInfo: () => ({ size_cm: [10, 20, 2] }) }));
  assert.equal(visible.annotations.length, 1);
  assert.ok(visible.annotations[0].anchorPoint.x >= 0 && visible.annotations[0].anchorPoint.x <= 1);
  doc.objects[1].at = [100000, 0, 0];
  const hidden = describe(resolveScene(doc, 's1', { assetInfo: () => ({ size_cm: [10, 20, 2] }) }));
  assert.equal(hidden.annotations.length, 0);
  assert.ok(hidden.findings.some(f => f.type === 'anchor.unresolved'));
});

test('reader preserves unknown keys, strict writer rejects them', () => {
  const doc = structuredClone(minimal);
  doc.future_field = { data: 1 };
  assert.equal(validateFrameScene(doc).ok, true);
  assert.ok(validateFrameScene(doc).warnings.some(w => w.code === 'key.unknown'));
  assert.equal(doc.future_field.data, 1);
  assert.equal(validateFrameScene(doc, { strict: true }).ok, false);
});

test('asset ground, front and declared poses affect resolution', () => {
  const doc = structuredClone(minimal);
  doc.objects[0] = { id: 'desk', kind: 'model', asset: 'scene3d/desk', at: [0, 0, 0] };
  doc.objects[1].facing = 'camera';
  doc.objects.push({ id: 'person', kind: 'human', asset: 'scene3d/person', at: [0, 0], pose: 'unknown' });
  const info = id => id === 'scene3d/desk' ? { size_cm: [100, 50, 100], ground: 'center' } : id === 'scene3d/phone' ? { size_cm: [10, 20, 2], front: '-Z' } : { size_cm: [60, 170, 30], poses: ['stand', 'sit'] };
  const result = resolveScene(doc, 's1', { assetInfo: info });
  assert.equal(result.objects[1].at[1], 25);
  assert.equal(result.objects[1].rot[1], -180);
  assert.equal(result.objects[2].pose.base, 'stand');
  assert.ok(result.warnings.some(w => w.code === 'pose.base.unknown'));
});

test('move directions and limit warnings are deterministic', () => {
  const a = { pos: [0, 0, 300], look: [0, 0, 0] };
  assert.equal(classifyMove(a, { pos: [0, 0, 300], look: [100, 0, 0] }).move, 'pan-right');
  assert.equal(classifyMove(a, { pos: [100, 0, 300], look: [0, 0, 0] }).move, 'orbit-right');
  assert.equal(classifyMove(a, a).move, 'static');
  const doc = structuredClone(minimal);
  doc.scenes = Array.from({ length: 51 }, (_, i) => ({ id: `s${i}`, annotations: i === 0 ? Array.from({ length: 101 }, (_, j) => ({ id: `a${j}`, type: 'pen' })) : [] }));
  const codes = validateFrameScene(doc, { fileBytes: 512 * 1024 + 1 }).warnings.map(w => w.code);
  assert.ok(codes.includes('limit.scenes'));
  assert.ok(codes.includes('limit.annotations'));
  assert.ok(codes.includes('limit.file'));
});
