import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { planTrackTransitions } from '@akari-video/edit-store';
import { t, setLanguage } from '@akari-video/i18n';
import { transitionFreezeSnapshot, transitionFreezeGrowth } from '../lib/common/transition-freeze-growth.js';

const ids = ['a', 'b', 'c'];
const plan = (earlierId, laterId, incoming = 0, outgoing = 0, extra = {}) => ({
  earlierId: String(earlierId), laterId: String(laterId), state: 'ok', legacyOverlap: false,
  freezeIncomingSeconds: incoming, freezeOutgoingSeconds: outgoing,
  freezeOutgoingUnknown: false, ...extra
});
const changes = (before, after) => transitionFreezeGrowth(transitionFreezeSnapshot(before, ids), after, ids);

test('freeze growth reports incoming, outgoing, both sides, and multiple boundaries', () => {
  const before = [plan(0, 1, 0.1, 0.1), plan(1, 2, 0, 0.1)];
  assert.deepEqual(changes(before, [plan(0, 1, 0.2, 0.1), plan(1, 2, 0, 0.2)]), [
    { from: 1, to: 2, seconds: '0.30' }, { from: 2, to: 3, seconds: '0.20' }
  ]);
  assert.deepEqual(changes([plan(0, 1, 0.1, 0.1)], [plan(0, 1, 0.2, 0.2)]),
    [{ from: 1, to: 2, seconds: '0.40' }]);
});

test('freeze growth ignores decreases, equal values, rounded noise, missing and ineffective boundaries', () => {
  const before = [plan(0, 1, 0.1, 0.1)];
  assert.deepEqual(changes(before, [plan(0, 1, 0.05, 0.1)]), []);
  assert.deepEqual(changes(before, before), []);
  assert.deepEqual(changes(before, [plan(0, 1, 0.100001, 0.1)]), []);
  assert.deepEqual(changes(before, []), []);
  assert.deepEqual(changes(before, [plan(0, 1, 0.3, 0.1, { state: 'none' })]), []);
  assert.deepEqual(changes(before, [plan(0, 1, 0.3, 0.1, { legacyOverlap: true })]), []);
  assert.deepEqual(transitionFreezeGrowth(transitionFreezeSnapshot(before, ids),
    [plan(0, 1, 0.3, 0.1)], ids, ['a', 'b']), []);
});

test('an unknown outgoing side is excluded while known incoming growth remains visible', () => {
  const unknown = plan(0, 1, 0.1, 0.4, { freezeOutgoingUnknown: true });
  assert.deepEqual(changes([unknown], [plan(0, 1, 0.1, 0.5)]), []);
  assert.deepEqual(changes([unknown], [plan(0, 1, 0.2, 0.5)]),
    [{ from: 1, to: 2, seconds: '0.70' }]);
  assert.deepEqual(changes([plan(0, 1, 0.1, 0.1)],
    [plan(0, 1, 0.2, 0.5, { freezeOutgoingUnknown: true })]),
    [{ from: 1, to: 2, seconds: '0.20' }]);
});

test('growth follows the same item pair when clip indices change', () => {
  const previous = transitionFreezeSnapshot([plan(0, 1, 0.1, 0)], ['a', 'b']);
  const after = [plan(1, 2, 0.2, 0)];
  assert.deepEqual(transitionFreezeGrowth(previous, after, ['x', 'a', 'b']),
    [{ from: 2, to: 3, seconds: '0.20' }]);
});

test('changing incoming source in from 0.2 to zero reports one larger frozen boundary', () => {
  const clips = incomingIn => [
    { id: '0', startSeconds: 0, lengthSeconds: 5, headRoomSeconds: 0, tailRoomSeconds: 0,
      transitionOut: { declaredSeconds: 0.5, align: 'center', fill: true } },
    { id: '1', startSeconds: 5, lengthSeconds: 5, headRoomSeconds: incomingIn, tailRoomSeconds: 0 }
  ];
  const before = planTrackTransitions(clips(0.2), { fps: 30, tailRoom: 'ignore' });
  const after = planTrackTransitions(clips(0), { fps: 30, tailRoom: 'ignore' });
  const growth = transitionFreezeGrowth(transitionFreezeSnapshot(before, ['a', 'b']), after, ['a', 'b']);
  assert.equal(growth.length, 1);
  setLanguage('ja');
  try {
    assert.match(t('transition.fill.notice.grown', growth[0]), /止め絵が .* 秒になりました/u);
  } finally { setLanguage(undefined); }
  const widget = readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');
  assert.match(widget, /trackFreezeGrowth = request\.kind === 'cut-speed'\s+\|\| request\.kind === 'cut-source-in' \|\| request\.kind === 'cut-source-out'/u);
});
