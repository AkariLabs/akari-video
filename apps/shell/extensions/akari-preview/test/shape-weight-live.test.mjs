import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { shapeMarkup } from '../../../../../packages/edit-store/lib/shape-markup.js';

const require = createRequire(import.meta.url);
const { PreviewContextBar } = require('../lib/browser/preview-context-bar.js');

test('weight range input sends the selected shape markup live before change', () => {
  const messages = [];
  const source = { kind: 'shape', shape: 'arrow', params: {
    width: 100, height: 80, stroke: '#123abc', strokeWidth: 4, endCap: 'chevron'
  } };
  const state = { selectedId: 'arrow-1', kind: 'line', item: {
    source, transform: { scaleX: 2, scaleY: 1 }
  }, output: { width: 1920, height: 1080 } };
  const twin = { value: '4' };
  const view = Object.create(PreviewContextBar.prototype);
  Object.assign(view, { state, pop: { querySelector: () => twin },
    host: { sendMessage: message => messages.push(message) } });

  view.onPopInput({ target: { dataset: { field: 'weight' }, type: 'range', value: '40' } });

  assert.equal(twin.value, '40');
  assert.deepEqual(messages, [{ type: 'akari-preview-live-transform',
    target: { kind: 'item', id: 'arrow-1' }, field: 'shape', value: 0,
    shapeHtml: shapeMarkup({ ...source, params: { ...source.params, strokeWidth: 40 } },
      'arrow-1', 1920, state.item.transform) }]);
});
