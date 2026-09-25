import assert from 'node:assert/strict';
import test from 'node:test';
import { itemSections, layerSections, visualSnapshot } from './helpers/perspective-transition-fixture.mjs';
import { assignSectionToTab } from '../lib/browser/inspector/tab-model.js';

test('photo inspector exposes the local mask, brush, and flip writes', async () => {
  const writes = [];
  const requestWrite = async request => { writes.push(request); return { ok: true }; };
  const snapshot = visualSnapshot('layer', { photo: true, mask: 'mask-a',
    maskSourceOptions: [{ id: 'mask-a', label: 'mask.png' }], flip: { h: true }, src: 'photo.jpg' });
  const sections = layerSections(snapshot, requestWrite);
  const correction = sections.find(section => section.id === 'edit-photo').fields;
  const appearance = sections.find(section => section.id === 'appearance').fields;
  const transform = sections.find(section => section.id === 'transform').fields;
  const generate = correction.find(field => field.name === 'photo-mask-generate');
  const remove = correction.find(field => field.name === 'photo-mask-remove');
  const brush = correction.find(field => field.name === 'photo-brush-start');
  assert.equal(assignSectionToTab('layer', 'edit-photo'), 'edit');
  assert.equal(appearance.some(field => field.name === 'mask' || field.name?.startsWith('photo-')), false);
  assert.equal(transform.some(field => field.name?.startsWith('photo-')), false);
  assert.deepEqual(correction.map(field => field.name), [
    'mask', 'photo-mask-generate', 'photo-mask-remove', 'photo-brush-mode',
    'photo-brush-size', 'photo-brush-hardness', 'photo-brush-start', 'photo-flip-h', 'photo-flip-v'
  ]);
  assert.equal(generate.actionLabel, '背景を消す（この Mac で）');
  assert.equal(brush.actionLabel, '消しゴム');
  assert.equal(correction.find(field => field.name === 'photo-flip-h').getValue(), 'する');
  await generate.action(snapshot);
  await remove.action(snapshot);
  await brush.action(snapshot);
  await correction.find(field => field.name === 'photo-flip-v').write(snapshot, 'する');
  assert.deepEqual(writes.map(write => write.path), ['photo-mask', 'mask', 'photo-brush-toggle', 'flip.v']);
});

test('photo item keeps every correction row once in edit and no photo row in video', () => {
  const snapshot = visualSnapshot('item', { photo: true, src: 'photo.jpg',
    maskSourceOptions: [{ id: 'mask-a', label: 'mask.png' }] });
  const sections = itemSections(snapshot, async () => ({ ok: true }));
  const photoRows = sections.flatMap(section => section.fields.filter(field =>
    field.name === 'mask' || field.name?.startsWith('photo-')).map(field => [section.id, field.name]));
  assert.deepEqual(photoRows, [
    ['edit-photo', 'mask'], ['edit-photo', 'photo-mask-generate'],
    ['edit-photo', 'photo-mask-remove'], ['edit-photo', 'photo-brush-mode'],
    ['edit-photo', 'photo-brush-size'], ['edit-photo', 'photo-brush-hardness'],
    ['edit-photo', 'photo-brush-start'], ['edit-photo', 'photo-flip-h'],
    ['edit-photo', 'photo-flip-v']
  ]);
});
