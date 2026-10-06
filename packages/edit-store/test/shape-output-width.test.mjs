import assert from 'node:assert/strict';
import test from 'node:test';
import { readInternalEdit, projectLegacyEdit, shapeMarkup } from '../lib/index.js';

const source = (shape, strokeWidth, v1 = false) => ({ kind: 'shape', shape,
  params: { width: 160, height: 40, strokeWidth,
    ...(v1 ? { dash: 'solid', startCap: 'none', endCap: 'triangle' } : {}) } });
const stroke = html => Number(html.match(/stroke-width="([\d.]+)"/)?.[1]);
const lowered = (shape, width, value, v1 = false) => {
  const edit = { version: 2, output: { width, height: width * 9 / 16, fps: 30 }, sources: [],
    tracks: [{ id: 'v', lane: 'visual', items: [{ id: 'line', at: 0, duration: 30,
      source: source(shape, value, v1) }] }] };
  return projectLegacyEdit(readInternalEdit(edit)).overlays[0].payload.html;
};

test('legacy and v1 line preview markup use the declared output width, including the export lowering path', () => {
  for (const v1 of [false, true]) for (const value of [4, 10]) {
    assert.equal(stroke(lowered('line', 1920, value, v1)), value);
    assert.equal(stroke(lowered('line', 3840, value, v1)), value * 2);
    assert.equal(stroke(shapeMarkup(source('line', value, v1), 'line', 3840)), value * 2);
  }
  assert.equal(stroke(lowered('arrow', 3840, 4)), 8);
  assert.equal(stroke(shapeMarkup(source('rect', 4), 'rect', 3840)), 4);
});

test('stored line thickness and the missing-width fallback stay unchanged at 1080p', () => {
  assert.equal(stroke(shapeMarkup(source('line', 4))), 4);
  assert.equal(stroke(shapeMarkup({ kind: 'shape', shape: 'line', params: { dash: 'solid' } })), 4);
});
