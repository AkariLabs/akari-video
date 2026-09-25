import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enableShapeStroke, shapeControlGroups, shapeHasStraightCorner, shapeNumber, shapeOptionLabel, shapeOptionValue, swapShapeEnds
} from '../lib/browser/inspector/shape-fields.js';
import { itemSections, visualSnapshot } from './helpers/perspective-transition-fixture.mjs';

test('path の外観は塗り・枠・直線角の丸みを表示する', () => {
  const [appearance] = shapeControlGroups('path', { path: { d: 'M0 0L10 0L10 10Z' }, fill: '#a6a6a6' });
  assert.deepEqual(appearance.fields.map(field => field.label),
    ['塗り', '塗りの色', '枠', '枠の色', '枠の太さ', '角の丸み']);
  assert.equal(shapeControlGroups('path', { path: { d: 'M0 0C1 1 2 2 3 3Z' } })[0].fields.some(field => field.key === 'cornerRadius'), false);
  assert.equal(shapeHasStraightCorner({ d: 'M0 0L2 0C2 1 2 2 3 3Z' }), false);
  assert.equal(shapeControlGroups('rect')[0].fields.some(field => field.key === 'cornerRadius'), false);
  assert.equal(shapeControlGroups('rounded-rect')[0].fields.some(field => field.key === 'cornerRadius'), true);
  assert.equal(shapeNumber('cornerRadius', '120'), 100);
});

test('line の線種・端パーツは保存値と表示値を往復できる', () => {
  const fields = shapeControlGroups('line', { dash: 'dash', startCap: 'triangle' })[0].fields;
  assert.equal(fields.find(field => field.key === 'dash').value, '破線');
  assert.equal(fields.find(field => field.key === 'startCap').value, '三角');
  assert.equal(shapeOptionValue('endCap', 'ひし形'), 'diamond');
  assert.equal(shapeOptionLabel('lineCap', 'round'), '丸く');
  assert.deepEqual(swapShapeEnds({ startCap: 'triangle', endCap: 'circle', startCapFilled: true, endCapFilled: false }),
    { startCap: 'circle', endCap: 'triangle', startCapFilled: false, endCapFilled: true });
});

test('吹き出しの数・しっぽの向きを契約範囲に収める', () => {
  const groups = shapeControlGroups('bubble', { tail: 'dots', count: 22 });
  assert.deepEqual(groups.map(group => group.id), ['appearance', 'bubble']);
  assert.equal(groups[1].fields.find(field => field.key === 'tail').value, '小さな丸');
  assert.equal(shapeNumber('count', '2'), 4);
  assert.equal(shapeNumber('tailAngle', '400'), 360);
});

test('外観から item-field を一回書き、始点と終点を一回で入れ替える', async () => {
  const snapshot = visualSnapshot('item', { shape: 'line', shapeParams: {
    stroke: '#000000', strokeWidth: 4, startCap: 'triangle', endCap: 'circle'
  } });
  const writes = [];
  const sections = itemSections(snapshot, async request => { writes.push(request); return { ok: true }; });
  const appearance = sections.find(section => section.id === 'appearance');
  await appearance.fields.find(field => field.name === 'shape-strokeWidth').write(snapshot, '8');
  await appearance.fields.find(field => field.name === 'shape-swap-ends').action(snapshot);
  assert.deepEqual(writes, [
    { kind: 'item-field', id: snapshot.id, path: 'source.params.strokeWidth', value: 8 },
    { kind: 'item-field', id: snapshot.id, path: 'source.params', value: {
      ...snapshot.shapeParams, startCap: 'circle', endCap: 'triangle', startCapFilled: true, endCapFilled: true
    } }
  ]);
});

test('枠なしから色にすると太さ 4 を同じ item-field 書き込みに入れる', async () => {
  const params = { fill: '#a6a6a6', stroke: 'none', strokeWidth: 0, preset: 'square' };
  assert.deepEqual(enableShapeStroke(params), { ...params, stroke: '#000000', strokeWidth: 4 });
  const snapshot = visualSnapshot('item', { shape: 'path', shapeParams: params });
  const requests = [];
  const appearance = itemSections(snapshot, async request => { requests.push(request); return { ok: true }; })
    .find(section => section.id === 'appearance');
  await appearance.fields.find(field => field.name === 'shape-strokeMode').write(snapshot, '色');
  assert.deepEqual(requests, [{ kind: 'item-field', id: snapshot.id, path: 'source.params',
    value: { ...params, stroke: '#000000', strokeWidth: 4 } }]);
});
