import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/interaction.js', import.meta.url), 'utf8');
const window = { akari: {}, addEventListener() {} };
const document = { getElementById: () => null, addEventListener() {} };
vm.runInNewContext(source, { window, document, globalThis: window });

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);
function fakeLine(angle, strokeWidth = 4, capHeight = 0) {
  const rad = angle * Math.PI / 180;
  const matrix = { a: Math.cos(rad), b: Math.sin(rad), c: -Math.sin(rad),
    d: Math.cos(rad), e: 220, f: 100 };
  const body = { tagName: 'line', getAttribute: name => ({ y1: '20', 'stroke-width': String(strokeWidth) })[name] };
  const cap = { tagName: 'polygon', hasAttribute: () => false, getScreenCTM: () => matrix,
    getBBox: () => ({ x: 150, y: 20 - capHeight / 2, width: 10, height: capHeight }) };
  const svg = { viewBox: { baseVal: { width: 160, height: 40 } },
    querySelector: () => body, getScreenCTM: () => matrix,
    children: capHeight ? [body, cap] : [body] };
  return { dataset: { role: 'shape-line' }, querySelector: () => svg };
}

test('line frame is a rotated thin rectangle with endpoints inside the end padding', () => {
  for (const angle of [0, 30, 45]) {
    const frame = window.akari.interaction.lineFrameGeometry(fakeLine(angle));
    near(frame.angle, angle);
    near(frame.width, 168);
    near(frame.height, 12);
    near(Math.hypot(frame.end.x - frame.start.x, frame.end.y - frame.start.y), 160);
    assert.ok(frame.width * frame.height < 2100);
    near(frame.left + frame.width / 2, (frame.start.x + frame.end.x) / 2);
    near(frame.top + frame.height / 2, (frame.start.y + frame.end.y) / 2);
    near(frame.endPadding, 4);
  }
});

test('caps and visible stroke widen the frame without expanding its length', () => {
  const plain = window.akari.interaction.lineFrameGeometry(fakeLine(45, 10));
  const capped = window.akari.interaction.lineFrameGeometry(fakeLine(45, 10, 50));
  near(plain.height, 16);
  assert.ok(capped.height >= 56);
  near(capped.width, plain.width);
});
