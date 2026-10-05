import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { shapeMarkup } = require('../lib/shape-markup.js');
const { validateShapeSource } = require('../lib/shape-source-validation.js');
const line = (kind, width, endpoint = 'end', extra = {}) => ({
  kind: 'shape', shape: 'line', params: { width: 400, height: 80, strokeWidth: width,
    stroke: '#123abc', [`${endpoint}Cap`]: kind, ...extra }
});
const tag = (markup, name) => markup.match(new RegExp(`<${name}\\b[^>]*\\/>`))?.[0];
const attr = (markup, name) => markup.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
const points = markup => attr(markup, 'points').split(' ').map(p => p.split(',').map(Number));

test('triangle envelope is 3.75 stroke widths with a 12 px minimum, filled and rooted', () => {
  for (const width of [2, 4, 10, 20]) for (const endpoint of ['start', 'end']) {
    const svg = shapeMarkup(line('triangle', width, endpoint));
    const cap = tag(svg, 'polygon');
    const body = tag(svg, 'line');
    const p = points(cap);
    const size = Math.max(12, width * 3.75);
    const xs = p.map(v => v[0]), ys = p.map(v => v[1]);
    const tip = endpoint === 'start' ? 0 : 400;
    assert.equal(p[0][0], tip);
    assert.equal(Math.max(...xs) - Math.min(...xs), size);
    assert.equal(Math.max(...ys) - Math.min(...ys), size);
    assert.equal(attr(cap, 'fill'), '#123abc');
    const root = endpoint === 'start' ? size : 400 - size;
    assert.ok(endpoint === 'start' ? Number(attr(body, 'x1')) >= root : Number(attr(body, 'x2')) <= root);
  }
});

test('chevron spans at least 4w and its solid or dashed body reaches the inner vertex without a notch', () => {
  for (const width of [2, 4, 10, 20]) for (const endpoint of ['start', 'end'])
    for (const dash of ['solid', 'dash']) {
      const svg = shapeMarkup(line('chevron', width, endpoint, { dash }));
      const cap = tag(svg, 'polyline');
      const body = tag(svg, 'line');
      const p = points(cap);
      const size = Math.max(12, width * 3.75, width * 4);
      assert.equal(attr(cap, 'stroke-linejoin'), 'miter');
      assert.equal(attr(cap, 'fill'), 'none');
      const run = Math.abs(p[1][0] - p[0][0]);
      const halfWidth = Math.abs(p[0][1] - p[1][1]);
      const miter = width * Math.hypot(run, halfWidth) / (2 * halfWidth);
      const rootStroke = width * halfWidth / (2 * Math.hypot(run, halfWidth));
      const visibleTip = p[1][0] + (endpoint === 'start' ? -miter : miter);
      const visibleBack = p[0][0] + (endpoint === 'start' ? rootStroke : -rootStroke);
      assert.ok(Math.abs(visibleTip - (endpoint === 'start' ? 0 : 400)) <= .5);
      assert.ok(Math.abs(visibleBack - (endpoint === 'start' ? size : 400 - size)) <= .5);
      assert.ok(Math.abs((2 * halfWidth + width * run / Math.hypot(run, halfWidth)) - size) <= .5);
      const bodyEnd = Number(attr(body, endpoint === 'start' ? 'x1' : 'x2'));
      assert.ok(Math.abs(bodyEnd - p[1][0]) <= .5, `body ${bodyEnd} must reach vertex ${p[1][0]}`);
      assert.ok(endpoint === 'start' ? bodyEnd >= 0 : bodyEnd <= 400);
      assert.ok(Math.abs(p[0][1] - p[2][1]) <= size);
    }
});

test('filled false triangle is still filled and puts its tip on the endpoint', () => {
  for (const endpoint of ['start', 'end']) {
    const svg = shapeMarkup(line('triangle', 20, endpoint, { [`${endpoint}CapFilled`]: false }));
    const cap = tag(svg, 'polygon');
    const p = points(cap);
    const tip = p[0][0];
    assert.equal(attr(cap, 'fill'), '#123abc');
    assert.ok(Math.abs(tip - (endpoint === 'start' ? 0 : 400)) <= .5);
  }
});

test('circle outer edge meets each endpoint and line ends at its inner edge', () => {
  for (const endpoint of ['start', 'end']) {
    const svg = shapeMarkup(line('circle', 10, endpoint));
    const cap = tag(svg, 'circle'), body = tag(svg, 'line');
    const cx = Number(attr(cap, 'cx')), r = Number(attr(cap, 'r'));
    const ow = Number(attr(cap, 'stroke-width'));
    assert.ok(Math.abs((endpoint === 'start' ? cx - r - ow / 2 : cx + r + ow / 2) - (endpoint === 'start' ? 0 : 400)) <= .5);
    assert.ok(endpoint === 'start' ? Number(attr(body, 'x1')) >= 25 : Number(attr(body, 'x2')) <= 375);
  }
});

test('bar, square, and diamond outer tips meet the endpoint', () => {
  for (const endpoint of ['start', 'end']) for (const kind of ['bar', 'square', 'diamond']) {
    const svg = shapeMarkup(line(kind, 20, endpoint));
    const cap = kind === 'bar' ? svg.match(/<line\b[^>]*\/>/g).at(-1)
      : tag(svg, kind === 'square' ? 'rect' : 'polygon');
    const ow = Number(attr(cap, 'stroke-width'));
    const tip = kind === 'bar'
      ? Number(attr(cap, 'x1')) + (endpoint === 'start' ? -ow / 2 : ow / 2)
      : kind === 'square'
        ? Number(attr(cap, 'x')) + (endpoint === 'start' ? -ow / 2 : Number(attr(cap, 'width')) + ow / 2)
        : points(cap)[endpoint === 'start' ? 0 : 2][0] + (endpoint === 'start' ? -ow / Math.SQRT2 : ow / Math.SQRT2);
    assert.ok(Math.abs(tip - (endpoint === 'start' ? 0 : 400)) <= .5, `${kind} ${endpoint}: ${tip}`);
  }
});

test('independent cap scales are proportional, default to one, and reject invalid values', () => {
  const widthOf = extra => {
    const p = points(tag(shapeMarkup(line('triangle', 10, 'end', extra)), 'polygon'));
    return Math.max(...p.map(v => v[0])) - Math.min(...p.map(v => v[0]));
  };
  assert.equal(widthOf({}), 37.5);
  assert.equal(widthOf({ endCapScale: 1 }), 37.5);
  assert.equal(widthOf({ endCapScale: .5 }), 18.75);
  assert.equal(widthOf({ endCapScale: 2 }), 75);
  assert.equal(widthOf({ endCapScale: 4 }), 37.5);
  assert.equal(widthOf({ endCapScale: -1 }), 37.5);
  assert.doesNotThrow(() => validateShapeSource(line('triangle', 10, 'end', { startCapScale: .5, endCapScale: 3 }), 'source'));
  assert.throws(() => validateShapeSource(line('triangle', 10, 'end', { endCapScale: 4 }), 'source'));
});
