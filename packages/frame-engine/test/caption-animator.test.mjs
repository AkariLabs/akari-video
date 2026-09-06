import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeAnimators, animatorParamsAt, animatorUnitOrder, captionAnimatorStateAt,
  animatorUnitsOf, animatorEase,
} from '../dist/timeline/caption-animator.js';
import { buildResolvedTimelinePlan, KNOWN_CUT_KEYS, KNOWN_LAYER_KEYS, KNOWN_KEYFRAME_KEYS } from '../dist/timeline/plan.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
const declaration = (overrides = {}) => ({ id: 'a', basis: 'chars', shape: 'ramp', start: 0, end: 1, offset: 0, amount: { x: 1 }, ...overrides });
const sample = (overrides = {}, unit = 0, count = 4, width = 1920) =>
  captionAnimatorStateAt(normalizeAnimators([declaration(overrides)]), {}, unit, count, width);
const identity = { translateX: 0, translateY: 0, scale: 1, rotateDeg: 0, opacityDelta: 0, letterSpacing: 0, blurPx: 0 };

test('ramp uses unit centers with default linear easing', () => {
  assert.deepEqual([0, 1, 2, 3].map(u => sample({}, u).translateX), [0.125, 0.375, 0.625, 0.875]);
});
for (const [shape, expected] of [
  ['ramp', 0.25], ['ramp-down', 0.75], ['triangle', 0.5],
  ['round', Math.SQRT1_2], ['smooth', 0.15625], ['square', 1],
]) test(`${shape} has its specified quarter-range weight`, () => close(sample({ shape }, 0, 2).translateX, expected));

test('square is zero outside its half-open range, including end', () => {
  assert.deepEqual([0, 1, 2, 3].map(u => sample({ shape: 'square', start: 0.375, end: 0.625 }, u).translateX), [0, 1, 0, 0]);
});
test('offset translates both selector endpoints', () => {
  assert.deepEqual([0, 1, 2, 3].map(u => sample({ offset: 0.25 }, u).translateX), [0, 0.125, 0.375, 0.625]);
  close(sample({ offset: -0.25 }).translateX, 0.375);
});
test('empty and reversed selectors have no influence for every shape', () => {
  for (const shape of ['ramp', 'ramp-down', 'triangle', 'round', 'smooth', 'square']) {
    assert.deepEqual(sample({ shape, start: 0.5, end: 0.5 }), identity);
    assert.deepEqual(sample({ shape, start: 1, end: 0 }), identity);
  }
});
test('round and triangle vanish outside the selector', () => {
  for (const shape of ['round', 'triangle']) {
    assert.equal(sample({ shape, start: 0.25, end: 0.75 }, 0).translateX, 0);
    assert.equal(sample({ shape, start: 0.25, end: 0.75 }, 3).translateX, 0);
  }
});
test('seed 1 produces a deterministic permutation without global randomness', () => {
  const order = animatorUnitOrder(12, 1);
  assert.deepEqual(animatorUnitOrder(12, 1), order);
  assert.deepEqual([...order].sort((a, b) => a - b), animatorUnitOrder(12));
  assert.notDeepEqual(order, animatorUnitOrder(12));
  assert.notDeepEqual(order, animatorUnitOrder(12, 2));
  assert.deepEqual(animatorUnitOrder(0, 1), []);
});
test('randomized evaluation uses the shuffled rank', () => {
  const order = animatorUnitOrder(4, 1);
  for (let u = 0; u < 4; u++) close(sample({ randomize: { seed: 1 } }, u).translateX, (order[u] + 0.5) / 4);
});
test('scale increments multiply across animators', () => {
  const animators = normalizeAnimators([
    declaration({ amount: { scale: 0.5 } }),
    declaration({ id: 'b', shape: 'ramp-down', amount: { scale: 0.5 } }),
  ]);
  close(captionAnimatorStateAt(animators, {}, 0, 4, 1920).scale, (1 + 0.5 * 0.125) * (1 + 0.5 * 0.875));
});
test('translation rotation spacing and blur add, with output pixel scaling', () => {
  const amount = { x: 24, y: -12, rotate: 90, letterSpacing: 4, blur: 8 };
  const animators = normalizeAnimators([declaration({ amount }), declaration({ id: 'b', amount })]);
  assert.deepEqual(captionAnimatorStateAt(animators, {}, 0, 1, 960), {
    ...identity, translateX: 12, translateY: -6, rotateDeg: 90, letterSpacing: 2, blurPx: 4,
  });
});
test('opacity remains an additive delta for the consumer to clamp after adding 1', () => {
  const animators = normalizeAnimators(['a', 'b', 'c'].map(id => declaration({ id, amount: { opacity: -1 } })));
  const { opacityDelta } = captionAnimatorStateAt(animators, {}, 0, 1, 1920);
  assert.equal(opacityDelta, -1.5);
  assert.equal(Math.max(0, Math.min(1, 1 + opacityDelta)), 0);
});
test('absent or empty animators and invalid units are identity', () => {
  for (const animators of [undefined, null, []]) assert.deepEqual(captionAnimatorStateAt(animators, {}, 0, 4, 1920), identity);
  assert.deepEqual(sample({}, 0, 0), identity);
  assert.deepEqual(sample({}, -1, 4), identity);
});
test('normalization fills defaults and clamps only schema-bounded amounts', () => {
  const [a] = normalizeAnimators([{ id: 'a', start: -3, end: 4, offset: -2, amount: { opacity: 2, x: 3000, scale: -2, blur: -4, y: NaN } }]);
  assert.deepEqual(a, { id: 'a', basis: 'chars', shape: 'ramp', start: 0, end: 1, offset: -1,
    ease: 'linear', amount: { x: 3000, y: 0, scale: -2, rotate: 0, opacity: 1, blur: -4, letterSpacing: 0 } });
  assert.equal(normalizeAnimators([{ id: 'b', offset: 2, amount: { opacity: -4 } }])[0].offset, 1);
  assert.equal(normalizeAnimators([{ id: 'b', amount: { opacity: -4 } }])[0].amount.opacity, -1);
  for (const value of [undefined, null, {}, [null, {}, { id: ' ' }]]) assert.deepEqual(normalizeAnimators(value), []);
});
test('unknown shapes and bases are dropped with warnings', () => {
  const codes = [];
  assert.deepEqual(normalizeAnimators([declaration({ shape: 'future' }), declaration({ basis: 'future' })], code => codes.push(code)), []);
  assert.deepEqual(codes, ['animator.unknown-shape', 'animator.unknown-basis']);
});
test('duplicate ids use the last declaration and warn', () => {
  const warnings = [];
  const result = normalizeAnimators([declaration(), declaration({ offset: 0.5 })], (...args) => warnings.push(args));
  assert.equal(result.length, 1);
  assert.equal(result[0].offset, 0.5);
  assert.equal(warnings[0][0], 'animator.duplicate-id');
  assert.match(warnings[0][1], /last declaration wins/);
});
test('segments normalizes to words and warns', () => {
  const codes = [];
  assert.equal(normalizeAnimators([declaration({ basis: 'segments' })], code => codes.push(code))[0].basis, 'words');
  assert.deepEqual(codes, ['animator.segments-fallback']);
});
const points = [ { t: 0, animator: { a: { offset: -0.3 } } }, { t: 15, animator: { a: { offset: 1 } } } ];
test('keyframe offsets interpolate in item-relative frames at the given fps', () => {
  const animators = normalizeAnimators([declaration()]);
  close(animatorParamsAt(animators, points, 0.25, 30).a.offset, 0.35);
  close(animatorParamsAt(animators, points, 0.125, 60).a.offset, 0.35);
});
test('keyframe endpoints clamp before the first and after the last point', () => {
  const a = normalizeAnimators([declaration()]);
  assert.equal(animatorParamsAt(a, points, -10, 30).a.offset, -0.3);
  assert.equal(animatorParamsAt(a, points, 10, 30).a.offset, 1);
});
test('missing points and absent ids preserve declarations without mutation', () => {
  const a = normalizeAnimators([declaration({ offset: 0.2 })]);
  const before = structuredClone(a);
  for (const p of [undefined, [], [{ t: 0, animator: { a: { offset: 1 } } }], [{ t: 0, animator: { b: { offset: 1 } } }, { t: 15 }]]) {
    assert.deepEqual(animatorParamsAt(a, p, 0.2, 30), { a: { start: 0, end: 1, offset: 0.2 } });
  }
  assert.deepEqual(a, before);
});
test('incoming easing and hold switch exactly at the target frame', () => {
  const a = normalizeAnimators([declaration()]);
  const eased = structuredClone(points);
  eased[0].easing = 'hold';
  eased[1].easing = 'in-quad';
  close(animatorParamsAt(a, eased, 0.25, 30).a.offset, -0.3 + 1.3 * 0.25);
  eased[1].easing = 'hold';
  assert.equal(animatorParamsAt(a, eased, 0.499, 30).a.offset, -0.3);
  assert.equal(animatorParamsAt(a, eased, 0.5, 30).a.offset, 1);
});
test('start end and offset support per-property incoming easing', () => {
  const p = [ { t: 0, animator: { a: { start: 0, end: 0.5, offset: 0 } } },
    { t: 30, animator: { a: { start: 1, end: 1, offset: 1 } }, easing: { 'animator.a.start': 'hold', 'animator.a.end': 'in-quad', animator: 'linear' } } ];
  assert.deepEqual(animatorParamsAt(normalizeAnimators([declaration()]), p, 0.5, 30).a, { start: 0, end: 0.625, offset: 0.5 });
});
test('keyframe overshoot stays within selector parameter ranges', () => {
  const p = [{ t: 0, animator: { a: { start: -3, end: 0, offset: -4 } } },
    { t: 30, animator: { a: { start: 3, end: 4, offset: 5 } }, easing: 'out-back' }];
  assert.deepEqual(animatorParamsAt(normalizeAnimators([declaration()]), p, 0.8, 30).a, { start: 1, end: 1, offset: 1 });
});
test('sparse keyframe endpoints hold the latest declaration instead of bridging the gap', () => {
  const p = [{ t: 0, animator: { a: { offset: -0.3 } } }, { t: 10, opacity: 0.5 },
    { t: 20, animator: { a: { offset: 1 } } }, { t: 30, animator: { a: { start: 0.5 } } }];
  const a = normalizeAnimators([declaration()]);
  for (const frame of [0, 5, 10, 15, 19]) assert.equal(animatorParamsAt(a, p, frame / 30, 30).a.offset, -0.3);
  for (const frame of [20, 25, 30, 40]) assert.equal(animatorParamsAt(a, p, frame / 30, 30).a.offset, 1);
  assert.equal(animatorParamsAt(a, p, 0, 30).a.start, 0.5);
  assert.equal(animatorParamsAt(a, p, 0, 30).a.end, 1);
});
test('all easing vocabulary has finite values and exact endpoints', () => {
  const names = ['linear', 'ease-in-out', 'in-quad', 'out-quad', 'in-out-quad', 'in-cubic', 'out-cubic',
    'in-out-cubic', 'in-quart', 'out-quart', 'in-out-quart', 'in-expo', 'out-expo', 'in-out-expo',
    'in-back', 'out-back', 'in-out-back', 'out-bounce', 'out-elastic', 'hold', 'cubic-bezier(0.42,0,0.58,1)'];
  for (const name of names) {
    assert.equal(animatorEase(0, name), 0, name);
    assert.equal(animatorEase(1, name), 1, name);
    for (const p of [0.1, 0.25, 0.5, 0.8]) assert.ok(Number.isFinite(animatorEase(p, name)), name);
  }
  close(animatorEase(0.25, 'ease-in-out'), 0.0625);
  close(animatorEase(0.5, 'cubic-bezier(0,0,1,1)'), 0.5);
  assert.ok(animatorEase(0.8, 'out-back') > 1);
  for (const name of ['future', 'cubic-bezier(2,0,1,1)', 'cubic-bezier(,0,1,1)']) assert.equal(animatorEase(0.25, name), 0.25);
});
const tokens = [ { tokenIndex: 8, lineIndex: 0 }, { tokenIndex: 8, lineIndex: 0 },
  { tokenIndex: 12, lineIndex: 0 }, { tokenIndex: 12, lineIndex: 1 }, { tokenIndex: 20, lineIndex: 1 } ];
for (const [basis, count, indices] of [ ['chars', 5, [0, 1, 2, 3, 4]], ['words', 3, [0, 0, 1, 1, 2]],
  ['lines', 2, [0, 0, 0, 1, 1]], ['segments', 3, [0, 0, 1, 1, 2]] ]) {
  test(`${basis} assigns dense units to caption tokens`, () => {
    const units = animatorUnitsOf(basis, tokens);
    assert.equal(units.count, count);
    assert.deepEqual(tokens.map(units.unitIndexOf), indices);
    assert.equal(units.unitIndexOf({}), -1);
    assert.equal(animatorUnitsOf(basis, []).count, 0);
  });
}
test('prototype-like ids remain ordinary animator ids', () => {
  const a = normalizeAnimators([declaration({ id: '__proto__' })]);
  const params = animatorParamsAt(a, [], 0, 30);
  assert.equal(Object.hasOwn(params, '__proto__'), true);
  assert.equal(captionAnimatorStateAt(a, params, 0, 4, 1920).translateX, 0.125);
});
test('plan recognizes animator keys and warns once per non-text item', () => {
  for (const keys of [KNOWN_CUT_KEYS, KNOWN_LAYER_KEYS, KNOWN_KEYFRAME_KEYS]) assert.ok(keys.has('animator'));
  const warnings = [];
  const keyframes = [{ t: 0, animator: { a: { offset: 0 } } }, { t: 1, animator: { a: { offset: 1 } } }];
  buildResolvedTimelinePlan([{ id: 'c', src: 's', in: 0, out: 1, animator: [declaration()], keyframes }], {
    layers: [{ id: 'l', t: 0, duration: 1, kind: 'video', src: 's', animator: [], keyframes },
      { id: 'k', t: 0, duration: 1, kind: 'video', src: 's', keyframes }],
    onWarning: message => warnings.push(message),
  });
  assert.equal(warnings.length, 3);
  for (const warning of warnings) assert.match(warning, /animator is ignored on non-text items/);
});
