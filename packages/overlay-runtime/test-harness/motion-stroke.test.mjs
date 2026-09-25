import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { strokeToXYKeyframes, positionKeyframeRange, createStrokeFeedback } = require('../src/motion-stroke.js');

test('a drawn path becomes bounded X and Y keyframes on the item clock', () => {
  const points = [{ x: 0, y: 0, ms: 0 }, { x: 10, y: 0, ms: 100 },
    { x: 20, y: 20, ms: 250 }, { x: 40, y: 20, ms: 500 }];
  const keys = strokeToXYKeyframes(points, { fps: 30, startFrame: 20, durationFrames: 90 });
  assert.equal(keys[0].t, 20);
  assert.equal(keys.at(-1).t, 35);
  assert.deepEqual(keys.at(-1).transform, { x: 40, y: 20 });
  assert.ok(keys.some(point => point.transform.y === 20));
  assert.deepEqual(points[0], { x: 0, y: 0, ms: 0 });
});

test('position range ignores unrelated keyframes and reports seconds', () => {
  const points = [{ t: 0, opacity: .5 }, { t: 12, transform: { x: 4 } },
    { t: 27, transform: { y: 9 } }];
  assert.deepEqual(positionKeyframeRange(points, 30, 'frames'), { start: .4, end: .9 });
  assert.equal(positionKeyframeRange([{ t: 0, opacity: .5 }], 30), null);
});

test('drawing feedback displays the range and traces the drag', () => {
  const previous = { document: globalThis.document, window: globalThis.window,
    getComputedStyle: globalThis.getComputedStyle };
  const calls = [];
  const context = { scale: () => {}, beginPath: () => calls.push('begin'),
    moveTo: (x, y) => calls.push(['move', x, y]),
    lineTo: (x, y) => calls.push(['line', x, y]), stroke: () => calls.push('stroke') };
  const nodes = [];
  globalThis.document = { documentElement: {}, body: { append: (...items) => nodes.push(...items) },
    createElement: tag => ({ style: {}, textContent: '',
      getContext: () => tag === 'canvas' ? context : null,
      remove() { this.removed = true; } }) };
  globalThis.window = { devicePixelRatio: 1, innerWidth: 640, innerHeight: 360 };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '#f80' });
  try {
    const feedback = createStrokeFeedback();
    feedback.show('位置の点 0〜1 秒を置き換えます');
    feedback.draw([{ x: 1, y: 2 }, { x: 10, y: 20 }]);
    assert.equal(nodes[1].textContent, '位置の点 0〜1 秒を置き換えます');
    assert.deepEqual(calls, ['begin', ['move', 1, 2], ['line', 10, 20], 'stroke']);
    feedback.dispose();
    assert.ok(nodes.every(node => node.removed));
  } finally {
    Object.assign(globalThis, previous);
  }
});
