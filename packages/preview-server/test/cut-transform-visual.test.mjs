import assert from 'node:assert/strict';
import test from 'node:test';

import { composeCutVisualStyle } from '../public/cut-transform-visual.js';

function compose(overrides = {}) {
  return composeCutVisualStyle({
    framingVisual: null,
    transform: undefined,
    opacity: undefined,
    outputWidth: 1920,
    outputHeight: 1080,
    ...overrides,
  });
}

function applyTransform(cssTransform, point, box) {
  const functions = [...cssTransform.matchAll(/(\w+)\(([^)]*)\)/g)].map(match => ({
    name: match[1],
    args: match[2].split(',').map(value => parseFloat(value)),
  }));
  let [x, y] = point;
  for (const fn of functions.reverse()) {
    if (fn.name === 'translate') {
      x += (fn.args[0] / 100) * box.width;
      y += (fn.args[1] / 100) * box.height;
    } else if (fn.name === 'scale') {
      const sx = fn.args[0];
      const sy = fn.args.length > 1 ? fn.args[1] : sx;
      x *= sx;
      y *= sy;
    } else if (fn.name === 'rotate') {
      const radians = fn.args[0] * Math.PI / 180;
      [x, y] = [x * Math.cos(radians) - y * Math.sin(radians),
        x * Math.sin(radians) + y * Math.cos(radians)];
    } else {
      throw new Error(`unexpected transform function: ${fn.name}`);
    }
  }
  return [x, y];
}

test('no framing, transform, or opacity resets all visual styles', () => {
  assert.deepEqual(compose(), { transformOrigin: '', transform: '', opacity: '' });
});

test('framing alone preserves the existing transform byte-for-byte', () => {
  const framingVisual = { transformOrigin: '0 0', transform: 'scale(2) translate(-25%, -10%)' };
  const result = compose({ framingVisual });
  assert.equal(result.transform, framingVisual.transform);
  assert.equal(result.transformOrigin, '0 0');
  assert.equal(result.opacity, '');
});

test('x and y convert from output pixels to percentages without other transforms', () => {
  const result = compose({ transform: { x: 96, y: -54 } });
  assert.equal(result.transform, 'translate(5%, -5%)');
  assert.equal(result.transformOrigin, '0 0');
  assert.doesNotMatch(result.transform, /scale|rotate/);
});

test('scale alone is wrapped around the element center without rotation', () => {
  const result = compose({ transform: { scale: 1.5 } });
  assert.equal(result.transform, 'translate(50%, 50%) scale(1.5) translate(-50%, -50%)');
  assert.doesNotMatch(result.transform, /rotate/);
});

test('rotate alone is wrapped around the element center', () => {
  const result = compose({ transform: { rotate: -12.5 } });
  assert.equal(result.transform, 'translate(50%, 50%) rotate(-12.5deg) translate(-50%, -50%)');
  assert.doesNotMatch(result.transform, /scale/);
});

test('opacity alone leaves transform styles reset', () => {
  assert.deepEqual(compose({ opacity: 0.5 }), {
    transformOrigin: '',
    transform: '',
    opacity: '0.5',
  });
});

test('framing and cut transform tokens are composed in render order', () => {
  const framing = 'scale(2) translate(-25%, -10%)';
  const result = compose({
    framingVisual: { transformOrigin: '0 0', transform: framing },
    transform: { x: 100, y: -50, scale: 1.25, rotate: 15 },
  });
  const tokens = [
    'translate(5.208333%, -4.62963%)',
    'translate(50%, 50%)',
    'rotate(15deg)',
    'scale(1.25)',
    'translate(-50%, -50%)',
    framing,
  ];
  let previous = -1;
  for (const token of tokens) {
    const current = result.transform.indexOf(token);
    assert.ok(current > previous, `${token} should follow the preceding transform token`);
    previous = current;
  }
});

test('x and y map the output center exactly like render-cut overlay offsets', () => {
  const box = { width: 1920, height: 1080 };
  const result = compose({
    transform: { x: 100, y: -50, scale: 1, rotate: 0 },
    outputWidth: box.width,
    outputHeight: box.height,
  });
  const actual = applyTransform(result.transform, [box.width / 2, box.height / 2], box);
  assert.ok(Math.abs(actual[0] - (box.width / 2 + 100)) < 1e-3);
  assert.ok(Math.abs(actual[1] - (box.height / 2 - 50)) < 1e-3);
});
