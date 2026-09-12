import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CAPTION_CHIP_PLAYING_CLASS,
  CAPTION_CHIP_SELECTED_CLASS,
  captionChipClasses,
  captionChipState
} from '../lib/browser/timeline-selection-model.js';

test('字幕チップは selected と playing を独立した状態と class で表す', () => {
  const selected = captionChipState('c-1', { selectedIds: ['c-1'], playingId: 'c-2' });
  assert.deepEqual(selected, { selected: true, playing: false });
  assert.deepEqual(captionChipClasses(selected), [CAPTION_CHIP_SELECTED_CLASS]);

  const playing = captionChipState('c-1', { selectedIds: [], playingId: 'c-1' });
  assert.deepEqual(playing, { selected: false, playing: true });
  assert.deepEqual(captionChipClasses(playing), [CAPTION_CHIP_PLAYING_CLASS]);

  const both = captionChipState('c-1', { selectedIds: ['c-1'], playingId: 'c-1' });
  assert.deepEqual(both, { selected: true, playing: true });
  assert.deepEqual(captionChipClasses(both), [
    CAPTION_CHIP_SELECTED_CLASS, CAPTION_CHIP_PLAYING_CLASS
  ]);
});

test('⌥ 全体モードは実選択に無い字幕も selected にする', () => {
  assert.deepEqual(captionChipState('c-2', {
    selectedIds: ['c-1'], playingId: null, altAll: true
  }), { selected: true, playing: false });
});
