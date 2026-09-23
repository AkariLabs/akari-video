import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { renderOverlaySheet } from '../src/rasterize.mjs';

const base = { edit: { output: { width: 640, height: 360, fps: 30 } }, projectRoot: '/tmp/rotate-scale-fixture', duration: 2 };
const sheet = transform => renderOverlaySheet({ ...base, overlays: [{ id: 'leaf', start: 0, duration: 2, html: '<div>rectangle</div>', transform }] });
const css = html => html.match(/\.akari-overlay-container \{[^\n]+/u)?.[0];

test('axis overlay sheet rotates after scaling the element axes', () => {
  assert.match(css(sheet({ scaleX: 2, rotate: 30 })), /translate\([^;]+\) rotate\(var\(--rotate, 0deg\)\) scale\(var\(--scale-x, var\(--scale, 1\)\), var\(--scale-y, var\(--scale, 1\)\)\)/u);
});

test('legacy output keeps the original CSS bytes', () => {
  const legacy = css(sheet({ scale: 1.25, rotate: 30 }));
  assert.match(legacy, /translate\(var\(--x, 0px\), var\(--y, 0px\)\) scale\(var\(--scale, 1\)\) rotate\(var\(--rotate, 0deg\)\)/u);
  // SHA-256 measured from origin/main 2589c836 for this exact input.
  assert.equal(createHash('sha256').update(sheet({ scale: 1.25, rotate: 30 })).digest('hex'),
    'c55d539aab8c2ebfd1a1137e271a905a6dc1f91d5b773706e464d610b33862b0');
});
