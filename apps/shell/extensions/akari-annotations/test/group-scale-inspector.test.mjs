import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { itemSections, visualSnapshot } from './helpers/perspective-transition-fixture.mjs';
import { writeNestedPreviewLayer } from '../lib/browser/inspector/nested-preview-layer.js';

const widget = readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');

test('canvas inspector exposes one size field and emits a uniform scale write', async () => {
  const writes = [];
  const snapshot = visualSnapshot('item', { itemKind: 'group', sourceKind: 'group',
    transform: { scale: 1 } });
  const fields = itemSections(snapshot, async request => {
    writes.push(request);
    return { ok: true };
  }).find(section => section.id === 'transform').fields;
  assert.equal(fields.some(field => field.name === 'transform-scaleX' || field.name === 'transform-scaleY'), false);
  await fields.find(field => field.name === 'transform-scale').write(snapshot, '140');
  assert.deepEqual(writes, [{ kind: 'item-field', id: snapshot.id,
    path: 'transform.scale', value: 1.4 }]);
});

test('canvas item-field axis requests are normalized before static and keyframe writes', () => {
  const write = widget.slice(widget.indexOf('    protected async handleInspectorWriteV2('),
    widget.indexOf('    protected selectionKey(', widget.indexOf('    protected async handleInspectorWriteV2(')));
  assert.match(write, /raw\.source\?\.kind === 'group'[\s\S]*delete transform\.scaleX;[\s\S]*delete transform\.scaleY;/u);
  assert.match(write, /request\.path === 'transform\.scaleX' \|\| request\.path === 'transform\.scaleY'[\s\S]*\? 'scale'/u);
});

test('nested media layer writer does not take the canvas group overlay route', () => {
  const document = { version: 2, output: { width: 640, height: 360, fps: 30 }, sources: [],
    tracks: [{ id: 'visual', lane: 'visual', items: [{ id: 'canvas', at: 0, duration: 180,
      source: { kind: 'group' }, transform: { scale: 1 }, items: [] }] }] };
  const before = JSON.stringify(document);
  assert.equal(writeNestedPreviewLayer(document, { kind: 'overlay', itemId: 'canvas',
    patch: { transform: { scale: 1.4 } } }), undefined);
  assert.equal(JSON.stringify(document), before);
});
