import assert from 'node:assert/strict';
import test from 'node:test';
import { buildResolvedTimelinePlan, collectPlanPlaceholderCards, placeholderCardMetrics,
  evaluationPlanFromResolvedTimeline } from '../dist/index.js';

const group = (id, name, at, duration, items = [], intent = name) => ({
  id, name, at, duration, source: { kind: 'group', canvas: { origin: 'plan', intent } }, items
});
const output = { width: 1920, height: 1080, colorSpace: 'bt709-limited' };
const placeholderText = { defaultName: 'Placeholder', replaceHint: 'Add media to replace' };
const at = (timeline, second, sources = new Map()) =>
  evaluationPlanFromResolvedTimeline(timeline, second * 1e6, sources, output);

test('card text scales with the short side in portrait and landscape', () => {
  const portrait = placeholderCardMetrics(1080, 1920);
  const landscape = placeholderCardMetrics(1920, 1080);
  for (const metrics of [portrait, landscape]) {
    assert.ok(metrics.titleSize >= 90);
    assert.ok(metrics.hintSize >= 34);
    assert.ok(metrics.hintBottomY + metrics.hintSize / 2 <
      (metrics === portrait ? 1920 : 1080) - metrics.inset);
  }
  for (const size of ['titleSize', 'intentSize', 'hintSize']) {
    assert.equal(portrait[size], landscape[size]);
  }
});

test('planned card follows the earliest back track and changes with time', () => {
  const tracks = [
    { id: 'visual', lane: 'visual', items: [
      group('hook', 'Hook', 0, 90), group('body', 'Recording', 90, 990),
      group('end', 'Reaction', 1080, 270)] },
    { id: 'playbook-placeholders-audio', lane: 'visual', items: [group('sound', 'Sound', 0, 1350)] },
    { id: 'front', lane: 'visual', items: [group('front', 'Front', 0, 1350)] },
  ];
  const cards = collectPlanPlaceholderCards(tracks, 30);
  const timeline = buildResolvedTimelinePlan([], { fps: 30, placeholders: cards, placeholderText });
  assert.equal(timeline.totalDuration, 45);
  for (const [time, id] of [[0, 'hook'], [2, 'hook'], [10, 'body'], [30, 'body'], [44, 'end']]) {
    assert.equal(at(timeline, time).base[0]?.id, `placeholder:${id}`);
  }
  assert.equal(at(timeline, 45).base.length, 0);
});

test('overlapping cards on one track select the earlier start regardless of declaration order', () => {
  const cards = collectPlanPlaceholderCards([{ id: 'visual', lane: 'visual', items: [
    group('later', 'Later', 30, 150), group('earlier', 'Earlier', 0, 180)
  ] }], 30);
  const timeline = buildResolvedTimelinePlan([], { fps: 30, placeholders: cards, placeholderText });
  assert.equal(at(timeline, 2).base[0]?.id, 'placeholder:earlier');
});

test('rendered media or image suppresses the backdrop at that time', () => {
  const cards = collectPlanPlaceholderCards([{ id: 'visual', lane: 'visual',
    items: [group('slot', 'Slot', 0, 300)] }], 30);
  const source = { decode: async () => { throw new Error('unused'); } };
  const image = { load: async () => { throw new Error('unused'); }, destroy() {} };
  const sources = new Map([['clip.mp4', source], ['photo.png', image]]);
  const video = buildResolvedTimelinePlan([{ id: 'video', src: 'clip.mp4', in: 0, out: 2, at: 3 }],
    { fps: 30, placeholders: cards, placeholderText });
  assert.equal(at(video, 2, sources).base[0]?.id, 'placeholder:slot');
  assert.equal(at(video, 4, sources).base.some(layer => layer.id === 'placeholder:slot'), false);
  const still = buildResolvedTimelinePlan([], { fps: 30, placeholders: cards, placeholderText,
    layers: [{ id: 'photo', kind: 'baked', src: 'photo.png', t: 6, duration: 2 }] });
  assert.equal(at(still, 7, sources).base.some(layer => layer.id === 'placeholder:slot'), false);
  const filtered = buildResolvedTimelinePlan([], { fps: 30, placeholders: cards, placeholderText,
    layers: [{ id: 'filter', kind: 'filter', t: 8, duration: 1, filter: { type: 'invert' } }] });
  assert.equal(at(filtered, 8.5).base.some(layer => layer.id === 'placeholder:slot'), false);
});

test('a group with a drawable descendant has no placeholder', () => {
  const photo = { id: 'photo', at: 0, duration: 30,
    source: { kind: 'media', src: 'photo.png', in: 0, out: 1 } };
  const cards = collectPlanPlaceholderCards([{ id: 'visual', lane: 'visual',
    items: [group('slot', 'Slot', 0, 300, [photo])] }], 30);
  assert.deepEqual(cards, []);
  const nested = group('outer', 'Outer', 0, 300, [group('inner', 'Inner', 30, 90, [photo])]);
  assert.deepEqual(collectPlanPlaceholderCards([{ id: 'visual', lane: 'visual', items: [nested] }], 30), []);
  const hiddenPhoto = { ...photo, hidden: true };
  assert.equal(collectPlanPlaceholderCards([{ id: 'visual', lane: 'visual',
    items: [group('slot', 'Slot', 0, 300, [hiddenPhoto])] }], 30).length, 1);
  assert.deepEqual(collectPlanPlaceholderCards([{ id: 'visual', lane: 'visual', hidden: true,
    items: [group('slot', 'Slot', 0, 300)] }], 30), []);
});
