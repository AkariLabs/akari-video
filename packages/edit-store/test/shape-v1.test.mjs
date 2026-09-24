import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { bubblePath as catalogBubblePath } from '../../../presets/shapes/bubble-path.mjs';

const require = createRequire(import.meta.url);
const { shapeMarkup } = require('../lib/shape-markup.js');
const { fitShapePath, roundShapePath, serializeShapePath, shapePathBounds, parseShapePath, hasShapeCorners } =
  require('../lib/shape-geometry.js');
const { bubblePath } = require('../lib/shape-bubble.js');
const { shapeSourceFromPreset } = require('../lib/shape-preset.js');
const { validateShapeSource } = require('../lib/shape-source-validation.js');

const path = {
  kind: 'shape',
  shape: 'path',
  params: {
    width: 200,
    height: 100,
    path: { d: 'M3 3L97 3L97 97L3 97Z', vb: [100, 100] },
    preset: 'basic-square',
  },
};

test('path is copied as a value, trims catalog padding, and rejects unsupported commands', () => {
  const result = shapeMarkup(path, 'item-1');
  assert.match(result, /d="M0 0L200 0L200 100L0 100L0 0Z"/);
  assert.equal(result, shapeMarkup({ ...path, params: { ...path.params, preset: 'another-id' } }, 'item-1'));
  assert.throws(() => parseShapePath('M0 0Q5 5 10 10'), /unsupported/);
});

test('rounded catalog entry copies its base geometry and remains independent of the shelf', () => {
  const base = {
    id: 'basic-square',
    category: 'basic',
    name: '四角',
    vb: [100, 100],
    d: 'M3 3L97 3L97 97L3 97Z',
    kind: 'fill',
    defaults: { fill: '#a6a6a6' },
  };
  const rounded = {
    ...base,
    id: 'basic-rounded-square',
    d: 'M10 10L90 10L90 90L10 90Z',
    rounded_from: { base: 'basic-square', radius: 36 },
  };
  const source = shapeSourceFromPreset(rounded, new Map([[base.id, base], [rounded.id, rounded]]));
  assert.equal(source.shape, 'path');
  assert.equal(source.params.path.d, base.d);
  assert.equal(source.params.cornerRadius, 36);
  base.d = 'M0 0L1 1';
  assert.equal(source.params.path.d, 'M3 3L97 3L97 97L3 97Z');
});

test('100 percent corner on a square rounds to a circle; stretched corner remains 50 px', () => {
  assert.equal(hasShapeCorners('M0 0L100 0L100 100L0 100Z'), true);
  assert.equal(hasShapeCorners('M0 0C20 0 80 0 100 0C100 20 100 80 100 100Z'), false);
  assert.equal(hasShapeCorners('M0 0L100 100'), false);
  const square = roundShapePath(fitShapePath('M0 0L100 0L100 100L0 100Z', 100, 100), 50);
  const stretched = roundShapePath(fitShapePath('M0 0L100 0L100 100L0 100Z', 200, 100), 50);
  assert.deepEqual(shapePathBounds(square), { x: 0, y: 0, width: 100, height: 100 });
  assert.match(serializeShapePath(square), /M50 0L50 0C77\.615 0 100 22\.385 100 50/);
  assert.match(serializeShapePath(stretched), /M50 0L150 0C177\.615 0 200 22\.385 200 50/);
  const transformed = shapeMarkup(
    {
      kind: 'shape',
      shape: 'path',
      params: {
        width: 100,
        height: 100,
        cornerRadius: 100,
        path: { d: 'M0 0L100 0L100 100L0 100Z', vb: [100, 100] },
      },
    },
    'stretch',
    1920,
    { scaleX: 2, scaleY: 1 },
  );
  assert.match(transformed, /M25 0L75 0C88\.808 0 100 22\.385 100 50/);
  const pathSquare = shapeMarkup({
    kind: 'shape',
    shape: 'path',
    params: {
      width: 100,
      height: 100,
      path: { d: 'M0 0L100 0L100 100L0 100Z', vb: [100, 100] },
      cornerRadius: 100,
    },
  }, 'rounded-path-v1');
  assert.match(pathSquare, /M50 0L50 0C77\.615 0 100 22\.385 100 50/);
  const legacy = shapeMarkup({
    kind: 'shape',
    shape: 'rounded-rect',
    params: { width: 100, height: 80, cornerRadius: 12 },
  });
  assert.equal(
    legacy,
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80" viewBox="0 0 100 80"><rect x="0" y="0" width="100" height="80" rx="12" ry="12" fill="#f97316" stroke="none" stroke-width="0"/></svg>',
  );
});

test('a v0 rect keeps its exact SVG even with an unused cornerRadius', () => {
  const source = { kind: 'shape', shape: 'rect', params: { width: 100, height: 80, cornerRadius: 12 } };
  assert.equal(
    shapeMarkup(source),
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80" viewBox="0 0 100 80"><rect x="0" y="0" width="100" height="80" fill="#f97316" stroke="none" stroke-width="0"/></svg>',
  );
  const marked = shapeMarkup({ ...source, params: { ...source.params, preset: 'basic-square' } }, 'marked');
  assert.match(marked, /d="M0 0L100 0L100 80L0 80L0 0Z"/);
  assert.doesNotMatch(marked, /C\d/);
});

test('dot marks are square with the declared gap; end parts point inward', () => {
  const result = shapeMarkup({
    kind: 'shape',
    shape: 'line',
    params: {
      width: 200,
      height: 40,
      strokeWidth: 4,
      dash: 'dot',
      lineCap: 'round',
      startCap: 'triangle',
      endCap: 'triangle',
    },
  }, 'dots');
  assert.match(result, /stroke-dasharray="4 8"/);
  assert.match(result, /stroke-linecap="butt"/);
  assert.match(result, /points="0,20 12\.8,13\.6 12\.8,26\.4"/);
  assert.match(result, /points="200,20 187\.2,13\.6 187\.2,26\.4"/);
  const half = shapeMarkup(
    { kind: 'shape', shape: 'line', params: { width: 200, height: 40, dash: 'dot', strokeWidth: 4 } },
    'dots',
    960,
  );
  assert.match(half, /stroke-width="2"/);
  assert.match(half, /stroke-dasharray="2 4"/);
});

test('line strokes, dashes, and end parts compensate item scale without vector-effect', () => {
  const source = {
    kind: 'shape',
    shape: 'line',
    params: { width: 200, height: 40, strokeWidth: 4, dash: 'dash', endCap: 'triangle' },
  };
  const normal = shapeMarkup(source, 'line');
  assert.match(normal, /stroke-width="4"/);
  assert.match(normal, /stroke-dasharray="12 8"/);
  assert.match(normal, /points="200,20 187\.2,13\.6 187\.2,26\.4"/);
  const doubled = shapeMarkup(source, 'line', 1920, { scale: 2 });
  assert.match(doubled, /stroke-width="2"/);
  assert.match(doubled, /stroke-dasharray="6 4"/);
  assert.match(doubled, /points="200,20 193\.6,16\.8 193\.6,23\.2"/);
  const stretched = shapeMarkup(source, 'line', 1920, { scaleX: 2, scaleY: 1 });
  assert.match(stretched, /stroke-width="2\.828"/);
  assert.match(stretched, /stroke-dasharray="8\.485 5\.657"/);
  assert.doesNotMatch(normal + doubled + stretched, /vector-effect/);
});

test('closed shapes and bubbles share the visible-stroke dash pattern', () => {
  const square = {
    kind: 'shape',
    shape: 'path',
    params: {
      width: 100,
      height: 100,
      path: { d: 'M0 0L100 0L100 100L0 100Z', vb: [100, 100] },
      stroke: '#000000',
      strokeWidth: 4,
      dash: 'dash',
    },
  };
  const dashed = shapeMarkup(square, 'square');
  assert.match(dashed, /stroke-width="8"/);
  assert.match(dashed, /stroke-dasharray="12 8"/);
  const enlarged = shapeMarkup(square, 'square', 1920, { scale: 2 });
  assert.match(enlarged, /stroke-width="4"/);
  assert.match(enlarged, /stroke-dasharray="6 4"/);
  const dotted = shapeMarkup({ ...square, params: { ...square.params, dash: 'dot' } }, 'square');
  assert.match(dotted, /stroke-dasharray="4 8"/);
  const bubble = shapeMarkup({
    kind: 'shape',
    shape: 'bubble',
    params: { width: 100, height: 100, strokeWidth: 4, dash: 'dash' },
  }, 'bubble');
  assert.match(bubble, /stroke-dasharray="12 8"/);
  assert.doesNotMatch(dashed + enlarged + dotted + bubble, /vector-effect/);
});

test('bubble geometry is deterministic for a seed and changes with seed', () => {
  const p = {
    style: 'jagged',
    count: 20,
    depth: 45,
    jitter: 30,
    seed: 7,
    tail: 'point',
    tailAngle: 210,
    tailLength: 45,
    tailWidth: 30,
    tailCurve: 0,
  };
  assert.equal(bubblePath(240, 140, p), bubblePath(240, 140, { ...p }));
  assert.notEqual(bubblePath(240, 140, p), bubblePath(240, 140, { ...p, seed: 8 }));
});

test('all twelve bubble presets match the catalog geometry byte for byte', () => {
  const rows = readFileSync(new URL('../../../presets/shapes/index.jsonl', import.meta.url), 'utf8')
    .trimEnd().split('\n').map(JSON.parse).filter((row) => row.kind === 'bubble');
  assert.equal(rows.length, 12);
  for (const row of rows) {
    const product = bubblePath(100, 100, row.defaults);
    assert.equal(product, catalogBubblePath(100, 100, row.defaults), row.id);
    assert.equal(product, row.d, row.id);
  }
});

test('inside stroke keeps the outer viewBox and gradients use distinct item IDs', () => {
  const source = {
    kind: 'shape',
    shape: 'path',
    params: {
      width: 180,
      height: 120,
      path: { d: 'M0 0L100 0L100 100L0 100Z', vb: [100, 100] },
      fill: 'none',
      strokeWidth: 20,
      stroke: {
        type: 'linear',
        angle: 90,
        stops: [{ color: '#ff000080', offset: 0 }, { color: '#0000ff', offset: 1 }],
      },
    },
  };
  const a = shapeMarkup(source, 'a');
  const b = shapeMarkup(source, 'b');
  assert.match(a, /viewBox="0 0 180 120"/);
  assert.match(a, /stroke-width="40"/);
  assert.match(a, /clip-path="url\(#sh-[a-z0-9]+-clip\)"/);
  assert.match(a, /<linearGradient/);
  assert.match(a, /stop-opacity="0\.502"/);
  assert.notEqual(a.match(/id="(sh-[a-z0-9]+-stroke)"/)[1], b.match(/id="(sh-[a-z0-9]+-stroke)"/)[1]);
  const radial = shapeMarkup({
    ...source,
    params: {
      ...source.params,
      fill: { type: 'radial', stops: [{ color: '#ffffff', offset: 0 }, { color: '#000000', offset: 1 }] },
    },
  }, 'a');
  assert.match(radial, /<radialGradient/);
});

test('open paths keep center strokes', () => {
  const result = shapeMarkup({
    kind: 'shape',
    shape: 'path',
    params: { path: { d: 'M0 0L100 100', vb: [100, 100] }, fill: 'none', stroke: '#000000', strokeWidth: 5 },
  }, 'open');
  assert.match(result, /stroke-width="5"/);
  assert.doesNotMatch(result, /clipPath/);
});

test('even-odd holes keep the same rule in the inside-stroke clip', () => {
  const result = shapeMarkup({
    kind: 'shape',
    shape: 'path',
    params: {
      path: { d: 'M0 0L100 0L100 100L0 100ZM25 25L75 25L75 75L25 75Z', vb: [100, 100], rule: 'evenodd' },
      stroke: '#000000',
      strokeWidth: 10,
    },
  }, 'ring');
  assert.match(result, /clip-rule="evenodd"/);
  assert.match(result, /fill-rule="evenodd"/);
});

test('runtime validation accepts v1 shapes and rejects malformed paths and gradients', () => {
  assert.doesNotThrow(() => validateShapeSource(path, 'shape'));
  assert.doesNotThrow(() =>
    validateShapeSource({ kind: 'shape', shape: 'rounded-rect', params: { cornerRadius: 150 } }, 'shape')
  );
  assert.doesNotThrow(() =>
    validateShapeSource({ kind: 'shape', shape: 'rect', params: { cornerRadius: 101 } }, 'shape')
  );
  assert.throws(() =>
    validateShapeSource({
      kind: 'shape',
      shape: 'path',
      params: {
        path: { d: 'M0 0L100 0L100 100L0 100Z', vb: [100, 100] },
        cornerRadius: 101,
      },
    }, 'shape'), /cornerRadius/);
  assert.throws(
    () =>
      validateShapeSource({
        kind: 'shape',
        shape: 'path',
        params: { path: { d: 'M0 0Q1 1 2 2', vb: [100, 100] } },
      }, 'shape'),
    /M\/L\/C\/Z/,
  );
  assert.throws(
    () => validateShapeSource({ kind: 'shape', shape: 'bubble', params: { count: 49 } }, 'shape'),
    /count/,
  );
  assert.throws(
    () =>
      validateShapeSource({
        kind: 'shape',
        shape: 'path',
        params: {
          path: { d: 'M0 0L1 1', vb: [1, 1] },
          fill: { type: 'radial', stops: [{ color: '#ffffff', offset: 1 }, { color: '#000000', offset: 0 }] },
        },
      }, 'shape'),
    /offset/,
  );
});

test('every generated path can be parsed and rendered from its copied value', () => {
  const rows = readFileSync(new URL('../../../presets/shapes/index.jsonl', import.meta.url), 'utf8').trimEnd()
    .split('\n').map(JSON.parse);
  for (const row of rows.filter((r) => r.kind === 'fill' || r.kind === 'stroke')) {
    assert.doesNotThrow(() => parseShapePath(row.d), row.id);
    const source = {
      kind: 'shape',
      shape: 'path',
      params: {
        ...row.defaults,
        path: { d: row.d, vb: row.vb, ...(row.rule ? { rule: row.rule } : {}) },
        preset: row.id,
      },
    };
    assert.doesNotThrow(() => validateShapeSource(source, `shape.${row.id}`), row.id);
    assert.match(shapeMarkup(source, row.id), /^<svg /, row.id);
  }
});
