import assert from 'node:assert/strict';
import test from 'node:test';

import { captionIdForTreeSelection } from '../lib/browser/timeline-selection-model.js';

test('caption item 選択は写し・明示子・出した行を既存 caption id へ結ぶ', () => {
  const projected = {
    kind: 'item', id: 'captions-bag#c-0001', itemKind: 'caption',
    parentId: 'captions-bag', trackId: 'captions-track'
  };
  assert.equal(captionIdForTreeSelection(projected), 'c-0001');
  assert.equal(captionIdForTreeSelection({ ...projected, id: 'cap-c-0001' }, 'c-0001'), 'c-0001');
  assert.equal(captionIdForTreeSelection({ ...projected, itemKind: 'telop' }), undefined);
});
