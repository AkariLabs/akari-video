import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { shapeMarkup } = require('../lib/shape-markup.js');
const { validateShapeSource } = require('../lib/shape-source-validation.js');
const source = (kind, w, endpoint, dash = 'solid', scale = 1, filled = true) => ({
  kind: 'shape', shape: 'line', params: {
    width: 400, height: 80, strokeWidth: w, stroke: '#123abc', dash,
    [`${endpoint}Cap`]: kind, [`${endpoint}CapScale`]: scale, [`${endpoint}CapFilled`]: filled,
  },
});
const attr = (element, name) => element.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
const elements = svg => [...svg.matchAll(/<(?:line|polygon|polyline|circle|rect)\b[^>]*\/>/g)].map(m => m[0]);
const vertices = element => attr(element, 'points').split(' ').map(pair => pair.split(',').map(Number));
const close = (actual, expected, label, tolerance = .005) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`);

test('triangle, circle, diamond and bar have 3.75w envelopes with a 12 px minimum', () => {
  for (const w of [2, 4, 10, 20]) for (const endpoint of ['start', 'end']) {
    const size = Math.max(w * 3.75, 12);
    for (const kind of ['triangle', 'circle', 'diamond', 'bar']) {
      const cap = elements(shapeMarkup(source(kind, w, endpoint))).at(-1);
      const outline = Number(attr(cap, 'stroke-width') ?? 0);
      let length, breadth;
      if (kind === 'circle') {
        length = breadth = 2 * Number(attr(cap, 'r')) + outline;
      } else if (kind === 'bar') {
        length = Number(attr(cap, 'stroke-width'));
        breadth = Number(attr(cap, 'y2')) - Number(attr(cap, 'y1'));
      } else {
        const xs = vertices(cap).map(v => v[0]);
        const ys = vertices(cap).map(v => v[1]);
        const miter = kind === 'diamond' ? outline / Math.SQRT2 : 0;
        length = Math.max(...xs) - Math.min(...xs) + 2 * miter;
        breadth = Math.max(...ys) - Math.min(...ys) + 2 * miter;
      }
      close(breadth, size, `${kind} ${w} breadth`);
      close(length, kind === 'bar' ? w : size, `${kind} ${w} length`);
    }
  }
});

test('chevron arms remain at least 3w and the visible tip stays on each endpoint', () => {
  for (const w of [2, 4, 10, 20]) for (const scale of [.5, 1, 2, 3])
    for (const endpoint of ['start', 'end']) {
      const cap = elements(shapeMarkup(source('chevron', w, endpoint, 'solid', scale))).at(-1);
      const [back, vertex, otherBack] = vertices(cap);
      const arm = Math.hypot(vertex[0] - back[0], vertex[1] - back[1]);
      assert.ok(arm >= 3 * w - .005, `${endpoint} w=${w} scale=${scale}: arm ${arm}`);
      close(otherBack[1] - vertex[1], vertex[1] - back[1], 'symmetric arms');
      const halfWidth = Math.abs(vertex[1] - back[1]);
      const run = Math.abs(vertex[0] - back[0]);
      const miter = w * arm / (2 * halfWidth);
      const tip = vertex[0] + (endpoint === 'start' ? -miter : miter);
      close(tip, endpoint === 'start' ? 0 : 400, 'chevron tip', .5);
      assert.equal(attr(cap, 'stroke-linejoin'), 'miter');
      assert.equal(attr(cap, 'fill'), 'none');
      assert.ok(2 * halfWidth + w * run / arm > 2 * w, 'arms stay visibly open');
    }
});

test('filled false triangles still paint in the line color at both endpoints', () => {
  for (const endpoint of ['start', 'end']) {
    const cap = elements(shapeMarkup(source('triangle', 10, endpoint, 'solid', 1, false))).at(-1);
    assert.equal(attr(cap, 'fill'), '#123abc');
    close(vertices(cap)[0][0], endpoint === 'start' ? 0 : 400, 'triangle tip', .5);
  }
});

test('diamond and circle body end faces lie inside the cap without a center or corner gap', () => {
  for (const kind of ['diamond', 'circle']) for (const dash of ['solid', 'dash'])
    for (const endpoint of ['start', 'end']) for (const w of [2, 4, 10, 20]) {
      const [body, cap] = elements(shapeMarkup(source(kind, w, endpoint, dash)));
      const size = Math.max(12, 3.75 * w);
      const x = Number(attr(body, endpoint === 'start' ? 'x1' : 'x2'));
      const outline = Number(attr(cap, 'stroke-width'));
      const polygon = kind === 'diamond' ? vertices(cap) : null;
      const center = kind === 'diamond' ? polygon[1][0] : Number(attr(cap, 'cx'));
      const radius = kind === 'diamond'
        ? Math.abs(polygon[2][0] - center) + outline / Math.SQRT2
        : Number(attr(cap, 'r')) + outline / 2;
      const root = center + (endpoint === 'start' ? 1 : -1) * radius;
      close(root, endpoint === 'start' ? size : 400 - size, `${kind} line-side vertex`, .5);
      const depth = endpoint === 'start' ? root - x : x - root;
      const expected = kind === 'diamond' ? Math.min(w / 2, size / 2)
        : size / 2 - Math.sqrt((size / 2) ** 2 - (w / 2) ** 2);
      // Distance zero means both end-face corners (y=40±w/2) are inside
      // the cap, the face has not retreated past its line-side vertex,
      // and the center and corner rows have no uncovered interval.
      close(depth, expected, `${kind} ${dash} ${endpoint} w=${w} insertion`, .5);
      assert.ok(depth >= -.5, 'end face cannot retreat beyond the line-side vertex');
      const availableHalfWidth = kind === 'diamond' ? Math.min(depth, 2 * radius - depth)
        : Math.sqrt(Math.max(0, radius ** 2 - (radius - depth) ** 2));
      assert.ok(availableHalfWidth >= w / 2 - .5, 'both end-face corners are inside the cap');
      assert.ok(depth >= -.5, 'center and corner rows have zero gap');
      if (dash === 'dash') assert.match(body, /stroke-dasharray=/);
      const tip = kind === 'circle'
        ? Number(attr(cap, 'cx')) + (endpoint === 'start' ? -1 : 1)
          * (Number(attr(cap, 'r')) + Number(attr(cap, 'stroke-width')) / 2)
        : vertices(cap)[endpoint === 'start' ? 0 : 2][0]
          + (endpoint === 'start' ? -1 : 1) * Number(attr(cap, 'stroke-width')) / Math.SQRT2;
      close(tip, endpoint === 'start' ? 0 : 400, `${kind} tip`, .5);
    }
});

test('a scale of 0.1 is invalid data and markup falls back to the default scale', () => {
  const invalid = source('triangle', 10, 'end', 'solid', .1);
  assert.throws(() => validateShapeSource(invalid, 'source'));
  const cap = elements(shapeMarkup(invalid)).at(-1);
  close(400 - vertices(cap)[1][0], 37.5, 'invalid scale fallback');
});
