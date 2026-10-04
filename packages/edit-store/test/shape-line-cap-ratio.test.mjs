import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { shapeMarkup } = require('../lib/shape-markup.js');
const source = (kind, filled = true, strokeWidth = 4, dash = 'solid', endpoint = 'end') => ({
  kind: 'shape', shape: 'line', params: {
    width: 200, height: 40, strokeWidth, dash,
    [`${endpoint}Cap`]: kind, [`${endpoint}CapFilled`]: filled,
  },
});
const render = (kind, filled, strokeWidth, scaleX, scaleY, dash, endpoint) =>
  shapeMarkup(source(kind, filled, strokeWidth, dash, endpoint), 'cap', 1920, { scaleX, scaleY });
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];

function screenCapBounds(markup, scaleX, scaleY) {
  const body = markup.match(/<svg[^>]*><line\b[^>]*\/>/);
  assert.ok(body, 'the body line must precede the cap');
  const remaining = markup.slice(body[0].length);
  const group = remaining.match(/^<g[^>]*>/)?.[0];
  const cap = remaining.match(/<(polygon|polyline|rect|circle|line)\b[^>]*\/>/)?.[0];
  assert.ok(cap, 'the cap is a complete, separate SVG element');
  let localX = 1, localY = 1;
  if (group) {
    const transform = attr(group, 'transform');
    const match = transform.match(/scale\(([^ ]+) ([^)]+)\)/);
    assert.ok(match);
    localX = Number(match[1]);
    localY = Number(match[2]);
  }
  const xScale = localX * scaleX, yScale = localY * scaleY;
  let xs, ys;
  if (cap.startsWith('<polygon') || cap.startsWith('<polyline')) {
    const points = attr(cap, 'points').split(' ').map(point => point.split(',').map(Number));
    xs = points.map(point => point[0]);
    ys = points.map(point => point[1]);
  } else if (cap.startsWith('<rect')) {
    const x = Number(attr(cap, 'x')), y = Number(attr(cap, 'y'));
    xs = [x, x + Number(attr(cap, 'width'))];
    ys = [y, y + Number(attr(cap, 'height'))];
  } else if (cap.startsWith('<circle')) {
    const x = Number(attr(cap, 'cx')), y = Number(attr(cap, 'cy')), r = Number(attr(cap, 'r'));
    xs = [x - r, x + r];
    ys = [y - r, y + r];
  } else {
    xs = [Number(attr(cap, 'x1')), Number(attr(cap, 'x2'))];
    ys = [Number(attr(cap, 'y1')), Number(attr(cap, 'y2'))];
  }
  const outline = Number(attr(cap, 'stroke-width') ?? 0);
  return {
    width: (Math.max(...xs) - Math.min(...xs) + outline) * xScale,
    height: (Math.max(...ys) - Math.min(...ys) + outline) * yScale,
    outlineX: outline * xScale,
    outlineY: outline * yScale,
  };
}

function near(actual, expected, fraction, label) {
  assert.ok(Math.abs(actual - expected) <= expected * fraction + 0.003,
    `${label}: ${actual} differs from ${expected}`);
}

test('all six start and end caps retain screen dimensions and outline width across axis scales', () => {
  for (const kind of ['triangle', 'chevron', 'bar', 'square', 'circle', 'diamond']) {
    for (const filled of [true, false]) {
      for (const endpoint of ['start', 'end']) {
        const normal = screenCapBounds(render(kind, filled, 4, 1, 1, 'solid', endpoint), 1, 1);
        for (const scaleX of [1, 2, 4]) for (const scaleY of [1, 2, 0.5]) {
          const actual = screenCapBounds(render(kind, filled, 4, scaleX, scaleY, 'solid', endpoint), scaleX, scaleY);
          for (const key of ['width', 'height', 'outlineX', 'outlineY']) {
            near(actual[key], normal[key], 0.02, `${kind} ${endpoint} filled=${filled} ${scaleX}x${scaleY} ${key}`);
          }
        }
      }
    }
  }
});

test('doubling stroke width doubles every cap and its visible outline', () => {
  for (const kind of ['triangle', 'chevron', 'bar', 'square', 'circle', 'diamond']) {
    for (const filled of [true, false]) {
      const thin = screenCapBounds(render(kind, filled, 4, 4, 0.5), 4, 0.5);
      const thick = screenCapBounds(render(kind, filled, 8, 4, 0.5), 4, 0.5);
      for (const key of ['width', 'height', 'outlineX', 'outlineY']) {
        if (thin[key]) near(thick[key], thin[key] * 2, 0.05, `${kind} ${key}`);
      }
    }
  }
});

test('uniform scale keeps the baseline SVG byte for byte', () => {
  const normal = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="40" viewBox="0 0 200 40"><line x1="0" y1="20" x2="192.32" y2="20" fill="none" stroke="#000000" stroke-width="4" stroke-linecap="butt" stroke-dasharray="12 8"/><polygon points="200,20 187.2,13.6 187.2,26.4" fill="#000000"/></svg>';
  const doubled = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="40" viewBox="0 0 200 40"><line x1="0" y1="20" x2="196.16" y2="20" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="butt" stroke-dasharray="6 4"/><polygon points="200,20 193.6,16.8 193.6,23.2" fill="#000000"/></svg>';
  assert.equal(shapeMarkup(source('triangle', true, 4, 'dash'), 'line'), normal);
  assert.equal(shapeMarkup(source('triangle', true, 4, 'dash'), 'line', 1920, { scale: 2 }), doubled);
});

test('dotted and dashed bodies end under the complete cap', () => {
  for (const dash of ['dot', 'dash']) for (const scaleX of [1, 2, 4]) {
    const markup = render('triangle', false, 4, scaleX, 0.5, dash);
    const body = markup.match(/<line\b[^>]*\/>/)?.[0];
    assert.ok(body);
    assert.match(body, /stroke-dasharray=/);
    assert.match(markup, /<g data-line-cap="end"[^>]*><polygon[^>]*\/><\/g>/);
    const end = Number(attr(body, 'x2')) * scaleX;
    const root = 200 * scaleX - 4 * 3.2 * 0.6;
    assert.ok(end <= root + 0.005, `body extends beyond the cap root: ${end} > ${root}`);
  }
});
