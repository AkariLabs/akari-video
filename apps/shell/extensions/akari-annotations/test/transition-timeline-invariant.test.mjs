import assert from 'node:assert/strict';
import test from 'node:test';

import {
  stringifyEditV2,
  updateItem,
} from '../lib/common/edit-v2-mutations.js';

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
