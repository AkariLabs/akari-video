import assert from 'node:assert/strict';
import test from 'node:test';
import { cutSections, layerSections, visualSnapshot } from './helpers/perspective-transition-fixture.mjs';

test('photo inspector exposes the local mask, brush, and flip writes', async () => {
  const writes = [];
  const requestWrite = async request => { writes.push(request); return { ok: true }; };
  const snapshot = visualSnapshot('layer', { photo: true, mask: 'mask-a',
    maskSourceOptions: [{ id: 'mask-a', label: 'mask.png' }], flip: { h: true }, src: 'photo.jpg' });
  const sections = layerSections(snapshot, requestWrite);
  const appearance = sections.find(section => section.id === 'appearance').fields;
  const transform = sections.find(section => section.id === 'transform').fields;
  const generate = appearance.find(field => field.name === 'photo-mask-generate');
  const remove = appearance.find(field => field.name === 'photo-mask-remove');
  const brush = appearance.find(field => field.name === 'photo-brush-start');
  assert.equal(generate.actionLabel, '背景を消す（この Mac で）');
  assert.equal(brush.actionLabel, '消しゴム');
  assert.equal(transform.find(field => field.name === 'photo-flip-h').getValue(), 'する');
  await generate.action(snapshot);
  await remove.action(snapshot);
  await brush.action(snapshot);
  await transform.find(field => field.name === 'photo-flip-v').write(snapshot, 'する');
  assert.deepEqual(writes.map(write => write.path), ['photo-mask', 'mask', 'photo-brush-toggle', 'flip.v']);
});

test('photo frame and crop action write to the same selected media item', async () => {
  const writes = [];
  const snapshot = visualSnapshot('layer', { photo: true, frame: { cornerRadius: 40,
    stroke: { color: '#ff8040', width: 8 } }, maskSourceOptions: [], src: 'photo.jpg' });
  const sections = layerSections(snapshot, async request => { writes.push(request); return { ok: true }; });
  const crop = sections.find(section => section.id === 'crop').fields;
  const appearance = sections.find(section => section.id === 'appearance').fields;
  assert.equal(appearance.find(field => field.name === 'photo-frame-radius').getValue(), '40');
  await crop.find(field => field.name === 'photo-crop-open').action(snapshot);
  await appearance.find(field => field.name === 'photo-frame-width').write(snapshot, '8');
  assert.deepEqual(writes.map(write => write.path), ['photo-crop-open', 'frame.stroke.width']);
  assert.ok(writes.every(write => write.id === snapshot.id));
});

test('still-image cut offers the crop action and frame controls', async () => {
  const writes = [];
  const snapshot = { kind: 'cut', index: 0, itemId: 'photo-cut', sourcePath: 'assets/photo.png',
    sourceIn: 0, sourceOut: 1, outputStart: 0, outputEnd: 1, trackName: '映像', clipName: '写真' };
  const sections = cutSections(snapshot, async request => { writes.push(request); return { ok: true }; });
  await sections.find(section => section.id === 'crop').fields[0].action(snapshot);
  await sections.find(section => section.id === 'appearance').fields
    .find(field => field.name === 'photo-frame-radius').write(snapshot, '40');
  assert.deepEqual(writes.map(write => [write.id, write.path]),
    [['photo-cut', 'photo-crop-open'], ['photo-cut', 'frame.cornerRadius']]);
});
