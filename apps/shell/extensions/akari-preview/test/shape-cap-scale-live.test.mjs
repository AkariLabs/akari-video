import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { shapeMarkup } from '../../../../../packages/edit-store/lib/shape-markup.js';
import { windowValues } from '../lib/common/context-bar-view.js';

const require = createRequire(import.meta.url);
const { PreviewContextBar } = require('../lib/browser/preview-context-bar.js');

test('cap scale range previews during input and writes once on change', () => {
  const messages = [], writes = [];
  const source = { kind: 'shape', shape: 'arrow', params: {
    width: 200, height: 80, stroke: '#123abc', strokeWidth: 10, endCap: 'triangle'
  } };
  const state = { selectedId: 'arrow-1', kind: 'line', item: { source }, output: { width: 1920, height: 1080 } };
  const twin = { value: '1' };
  const view = Object.create(PreviewContextBar.prototype);
  Object.assign(view, { state, pop: { querySelector: () => twin, querySelectorAll: () => [twin] },
    host: { sendMessage: message => messages.push(message) }, run: request => { writes.push(request); } });
  assert.equal(windowValues(state).endCapScale, 1);
  const controls = view.popHtml('ends', state);
  assert.match(controls, /type="range" data-field="startCapScale" min="0\.5" max="3" step="0\.1"/);
  assert.match(controls, /type="range" data-field="endCapScale" min="0\.5" max="3" step="0\.1"/);
  const input = { dataset: { field: 'endCapScale' }, type: 'range', value: '2', min: '.5', max: '3' };
  view.onPopInput({ target: input });
  assert.equal(twin.value, '2');
  assert.deepEqual(messages, [{ type: 'akari-preview-live-transform',
    target: { kind: 'item', id: 'arrow-1' }, field: 'shape', value: 0,
    shapeHtml: shapeMarkup({ ...source, params: { ...source.params, endCapScale: 2 } }, 'arrow-1', 1920) }]);
  assert.deepEqual(writes, []);
  view.onPopChange({ target: input });
  assert.deepEqual(writes, [{ action: 'write', path: 'source.params.endCapScale', value: 2 }]);
});
