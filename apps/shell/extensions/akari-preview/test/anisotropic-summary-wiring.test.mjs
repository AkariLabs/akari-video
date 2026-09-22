import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { previewTransformAxes } from '../src/common/preview-transform.ts';
import { buildItemKeyframeSummaryFields, resolvePreviewItemKeyframes } from '../src/common/item-keyframes-summary.ts';

const handler = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');

test('transform() spreads only finite positive axis overrides alongside unchanged legacy fields', () => {
  assert.match(handler, /protected transform\(value: any\): OverlayTransform\s*\{\s*return \{\s*x: this\.finiteNumber\(value\?\.x, 0\),\s*y: this\.finiteNumber\(value\?\.y, 0\),\s*scale: this\.finiteNumber\(value\?\.scale, 1\),\s*\.\.\.previewTransformAxes\(value\),\s*rotate: this\.finiteNumber\(value\?\.rotate, 0\)/u);
  assert.deepEqual(previewTransformAxes({ scaleX: 2, scaleY: 0.5 }), { scaleX: 2, scaleY: 0.5 });
  assert.deepEqual(previewTransformAxes({ scaleX: 2 }), { scaleX: 2 });
  for (const value of [undefined, null, {}, { scale: 2 }, { scaleX: 0, scaleY: -1 }, { scaleX: NaN, scaleY: Infinity }, { scaleX: '2' }]) {
    assert.deepEqual(previewTransformAxes(value), {});
    const legacy = { x: 0, y: 0, scale: 2, rotate: 0 };
    assert.deepEqual({ ...legacy, ...previewTransformAxes(value) }, legacy);
  }
});

test('static summaries, initial webview state and incremental messages carry the axes to the runtime', () => {
  assert.match(handler, /transform: this\.transform\(value\?\.transform\)/u);
  assert.ok((handler.match(/v => this\.transform\(v\)/gu) ?? []).length >= 2, 'cut and layer summary callbacks');
  assert.match(handler, /summary: model\.summary/u);
  assert.match(handler, /window\.akari\.state = \{ editPath: initial\.editPath, summary: initial\.summary/u);
  assert.match(handler, /window\.akari\.runtime\.mount\(summary\)/u);
  assert.match(handler, /widget\.sendMessage\(\{ type: 'akari-preview-model-update', summary \}\)/u);
  assert.match(handler, /window\.akari\.runtime\.applyAxisSummary\?\.\(summary\)/u);
});

test('inline and sidecar keyframe transforms survive summary serialization without dropping axes', async () => {
  for (const sidecar of [false, true]) {
    const points = [{ t: 0, transform: { scale: 1 } }, { t: sidecar ? 60 : 2, transform: { scaleX: 2, scaleY: 0.5 } }];
    const item = { id: 'leaf', source: { kind: 'html' }, children: [],
      declaration: sidecar ? {} : { keyframes: points }, ...(sidecar ? { keyframesRef: { path: 'motion/leaf.json' } } : {}) };
    await resolvePreviewItemKeyframes({ output: { fps: 30 }, tracks: [{ items: [item] }] }, {
      readText: async () => JSON.stringify({ items: { leaf: points } }),
    });
    const fields = JSON.parse(JSON.stringify(buildItemKeyframeSummaryFields(item.declaration)));
    assert.deepEqual(fields.keyframes, [{ t: 0, transform: { scale: 1 } }, { t: 60, transform: { scaleX: 2, scaleY: 0.5 } }]);
  }
});
