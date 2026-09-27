import assert from 'node:assert/strict';
import test from 'node:test';
import { cutSections, itemSections, layerSections, photoMaskFields, visualSnapshot } from './helpers/perspective-transition-fixture.mjs';

const lookNames = ['photo-flip-h', 'photo-flip-v', 'photo-crop-open',
  'photo-frame-width', 'photo-frame-color', 'photo-frame-radius'];
const maskNames = ['mask', 'photo-mask-generate', 'photo-mask-remove'];
const brushNames = ['photo-brush-mode', 'photo-brush-size', 'photo-brush-hardness', 'photo-brush-start'];

test('photo layer keeps look rows in video appearance and local mask/brush writes available', async () => {
  const writes = [];
  const requestWrite = async request => { writes.push(request); return { ok: true }; };
  const snapshot = visualSnapshot('layer', { photo: true, mask: 'mask-a',
    maskSourceOptions: [{ id: 'mask-a', label: 'mask.png' }], flip: { h: true }, src: 'photo.jpg' });
  const sections = layerSections(snapshot, requestWrite);
  const appearance = sections.find(section => section.id === 'appearance').fields;
  const transform = sections.find(section => section.id === 'transform').fields;
  const tools = photoMaskFields(snapshot, requestWrite);
  assert.equal(sections.some(section => section.id === 'edit-photo'), false);
  assert.deepEqual(appearance.filter(field => lookNames.includes(field.name)).map(field => field.name), lookNames);
  assert.equal(transform.some(field => field.name?.startsWith('photo-')), false);
  assert.deepEqual(tools.map(field => field.name), [...maskNames, ...brushNames]);
  assert.equal(tools.find(field => field.name === 'photo-mask-generate').actionLabel, '背景を消す（この Mac で）');
  assert.equal(tools.find(field => field.name === 'photo-brush-start').actionLabel, '消しゴム');
  assert.equal(appearance.find(field => field.name === 'photo-flip-h').getValue(), 'する');
  await tools.find(field => field.name === 'photo-mask-generate').action(snapshot);
  await tools.find(field => field.name === 'photo-mask-remove').action(snapshot);
  await tools.find(field => field.name === 'photo-brush-start').action(snapshot);
  await appearance.find(field => field.name === 'photo-flip-v').write(snapshot, 'する');
  assert.deepEqual(writes.map(write => write.path), ['photo-mask', 'mask', 'photo-brush-toggle', 'flip.v']);
});

test('photo item keeps only look rows in video appearance', () => {
  const snapshot = visualSnapshot('item', { photo: true, src: 'photo.jpg',
    maskSourceOptions: [{ id: 'mask-a', label: 'mask.png' }] });
  const sections = itemSections(snapshot, async () => ({ ok: true }));
  const photoRows = sections.flatMap(section => section.fields.filter(field =>
    field.name === 'mask' || field.name?.startsWith('photo-')).map(field => [section.id, field.name]));
  assert.deepEqual(photoRows, lookNames.map(name => ['appearance', name]));
  assert.deepEqual(photoMaskFields(snapshot, async () => ({ ok: true })).map(field => field.name),
    [...maskNames, ...brushNames]);
});

test('photo frame and crop action write to the same selected media item', async () => {
  const writes = [];
  const snapshot = visualSnapshot('layer', { photo: true, frame: { cornerRadius: 40,
    stroke: { color: '#ff8040', width: 8 } }, maskSourceOptions: [], src: 'photo.jpg' });
  const photo = layerSections(snapshot, async request => { writes.push(request); return { ok: true }; })
    .find(section => section.id === 'appearance').fields;
  assert.equal(photo.find(field => field.name === 'photo-frame-radius').getValue(), '40');
  await photo.find(field => field.name === 'photo-crop-open').action(snapshot);
  await photo.find(field => field.name === 'photo-frame-width').write(snapshot, '8');
  assert.deepEqual(writes.map(write => write.path), ['photo-crop-open', 'frame.stroke.width']);
  assert.ok(writes.every(write => write.id === snapshot.id));
});

test('still-image cut offers crop and frame in video appearance', async () => {
  const writes = [];
  const snapshot = { kind: 'cut', index: 0, itemId: 'photo-cut', sourcePath: 'assets/photo.png',
    sourceIn: 0, sourceOut: 1, outputStart: 0, outputEnd: 1, trackName: '映像', clipName: '写真' };
  const photo = cutSections(snapshot, async request => { writes.push(request); return { ok: true }; })
    .find(section => section.id === 'appearance').fields;
  await photo.find(field => field.name === 'photo-crop-open').action(snapshot);
  await photo.find(field => field.name === 'photo-frame-radius').write(snapshot, '40');
  assert.deepEqual(writes.map(write => [write.id, write.path]),
    [['photo-cut', 'photo-crop-open'], ['photo-cut', 'frame.cornerRadius']]);
});

test('cut photo brush sends the same item-field path with the cut itemId', async () => {
  const writes = [];
  const snapshot = { ...visualSnapshot('item', { photo: true, maskSourceOptions: [] }), id: 'photo-cut' };
  const brush = photoMaskFields(snapshot, async request => { writes.push(request); return { ok: true }; })
    .find(field => field.name === 'photo-brush-start');
  await brush.action(snapshot);
  assert.deepEqual(writes.map(write => [write.id, write.path]), [['photo-cut', 'photo-brush-toggle']]);
});
