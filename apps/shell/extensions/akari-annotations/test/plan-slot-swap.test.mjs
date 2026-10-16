import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { planSlotDrop, swapPlannedSlot } = require('../lib/common/material-replacement.js');
const doc = { version: 2, output: { fps: 30 }, sources: [{ id: 'old', path: 'assets/broll/old.mp4' }], tracks: [
  { lane: 'visual', items: [{ id: 'slot', at: 0, duration: 90,
    source: { kind: 'group', canvas: { origin: 'plan', durationMode: 'fixed', intent: 'video' } },
    items: [{ id: 'child', at: 0, duration: 90, source: { kind: 'media', src: 'old', in: 0, out: 3 } }] }] }
] };
test('planned slot swaps one visual child and keeps frame bounds', () => {
  assert.equal(planSlotDrop(doc, 'slot', 'video').action, 'swap');
  assert.equal(planSlotDrop(doc, 'slot', 'audio').action, 'reject');
  const value = swapPlannedSlot(doc, { slotId: 'slot', relativePath: 'assets/broll/new.mp4', kind: 'video', actualDurationS: 2 });
  assert.equal(value.doc.tracks[0].items[0].items.length, 1);
  assert.equal(value.doc.tracks[0].items[0].items[0].duration, 90);
  assert.equal(value.short, true);
});
test('empty image slot rejects video before insertion', () => {
  const empty = structuredClone(doc);
  empty.tracks[0].items[0].name = 'Photo [image]';
  empty.tracks[0].items[0].items = [];
  assert.equal(planSlotDrop(empty, 'slot', 'video').action, 'reject');
  assert.equal(planSlotDrop(empty, 'slot', 'image').action, 'insert');
});
