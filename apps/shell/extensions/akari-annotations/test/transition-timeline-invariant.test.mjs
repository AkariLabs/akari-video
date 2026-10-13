import assert from 'node:assert/strict';
import test from 'node:test';

import {
  stringifyEditV2,
  updateItem,
} from '../lib/common/edit-v2-mutations.js';
import { decideTransitionWrite } from '../lib/common/transition-fill-write.js';
import { transitionDeclarationPatch } from '../lib/common/transition-write-plan.js';

const baseline = {
  version: 2,
  output: { width: 1280, height: 720, fps: 30 },
  sources: [{ id: 'a', path: 'a.mp4' }, { id: 'b', path: 'b.mp4' }],
  tracks: [{
    id: 'visual-main', lane: 'visual', items: [
      { id: 'a', at: 0, duration: 60, source: { kind: 'media', src: 'a', in: 0, out: 2 } },
      { id: 'b', at: 60, duration: 60, source: { kind: 'media', src: 'b', in: 1, out: 3 } },
    ],
  }],
};

const transition = (doc, value) => updateItem(doc, {
  itemId: 'a', patch: { source: { transition_out: value } },
});

test('attach, fill, and length changes leave every clip clock field untouched', () => {
  const clocks = doc => doc.tracks[0].items.map(item => ({
    at: item.at, duration: item.duration, in: item.source.in, out: item.source.out,
  }));
  const before = clocks(baseline);
  const planClips = [
    { id: 'a', startSeconds: 0, lengthSeconds: 2, headRoomSeconds: 0, tailRoomSeconds: 0 },
    { id: 'b', startSeconds: 2, lengthSeconds: 2, headRoomSeconds: 0, tailRoomSeconds: 0 },
  ];
  const attach = decideTransitionWrite({ clips: planClips, earlierId: 'a', fps: 30,
    request: { type: 'fade', duration: 0.5 } });
  assert.equal(attach.kind, 'attach');
  const added = transition(baseline, transitionDeclarationPatch(attach.patch));
  assert.deepEqual(clocks(added), before);
  const unfilled = transition(added, { type: 'fade', duration: 0.5, fill: null });
  const fill = decideTransitionWrite({ clips: planClips, earlierId: 'a', fps: 30,
    existing: unfilled.tracks[0].items[0].source.transition_out,
    request: { type: 'fade', duration: 0.5, fillOnly: true } });
  assert.equal(fill.kind, 'fill');
  const filled = transition(unfilled, transitionDeclarationPatch(fill.patch));
  assert.deepEqual(clocks(filled), before);
  const change = decideTransitionWrite({ clips: planClips, earlierId: 'a', fps: 30,
    existing: filled.tracks[0].items[0].source.transition_out,
    request: { type: 'fade', duration: 0.25 } });
  const changed = transition(filled, transitionDeclarationPatch(change.patch));
  assert.deepEqual(clocks(changed), before);
});

const withoutTransitionBytes = doc => stringifyEditV2(transition(doc, null));

test('追加→位置変更→尺変更→削除の全系列で transition_out 以外の edit.json bytes は不変', () => {
  const before = stringifyEditV2(baseline);
  const added = transition(baseline, { type: 'dissolve', duration: 1 });
  const moved = transition(added, { type: 'dissolve', duration: 1, align: 'after-cut' });
  const resized = transition(moved, { type: 'dissolve', duration: 0.5 });
  const centered = transition(resized, { type: 'dissolve', duration: 0.5, align: null });
  const removed = transition(centered, null);

  assert.equal(withoutTransitionBytes(added), before);
  assert.equal(withoutTransitionBytes(moved), before);
  assert.equal(withoutTransitionBytes(resized), before);
  assert.equal(resized.tracks[0].items[0].source.transition_out.align, 'after-cut');
  assert.equal(withoutTransitionBytes(centered), before);
  assert.equal('align' in centered.tracks[0].items[0].source.transition_out, false);
  assert.equal(stringifyEditV2(removed), before);
  for (const doc of [added, moved, resized, centered, removed]) {
    assert.deepEqual(doc.tracks[0].items.map(item => ({
      at: item.at, duration: item.duration, in: item.source.in, out: item.source.out,
    })), [
      { at: 0, duration: 60, in: 0, out: 2 },
      { at: 60, duration: 60, in: 1, out: 3 },
    ]);
  }
});
