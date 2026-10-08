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
  // origin/main 2589c836 で採った入力。2843f6227 で疑似要素アニメを WAAPI クローンへ引き継ぐ共通スクリプトが変わった。
  assert.equal(createHash('sha256').update(sheet({ scale: 1.25, rotate: 30 })).digest('hex'),
    '9a47270dcf7a4929ad02cec5eddecd5eec429e50c134f652625119fee6677882');
});
