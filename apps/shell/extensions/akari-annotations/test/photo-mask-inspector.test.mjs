import assert from 'node:assert/strict';
import test from 'node:test';
import { layerSections, visualSnapshot } from './helpers/perspective-transition-fixture.mjs';

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
