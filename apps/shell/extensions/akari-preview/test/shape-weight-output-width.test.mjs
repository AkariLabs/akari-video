import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PreviewContextBar } = require('../lib/browser/preview-context-bar.js');

test('preview live line weight uses project output width at 1080p and 4K', () => {
  for (const width of [1920, 3840]) {
    const messages = [];
    const view = Object.create(PreviewContextBar.prototype);
    Object.assign(view, { state: { selectedId: 'line', kind: 'line',
      item: { source: { kind: 'shape', shape: 'line', params: {
        width: 160, height: 40, strokeWidth: 4 } }, transform: { scale: 1 } },
      output: { width, height: width * 9 / 16 } },
      pop: { querySelector: () => null }, host: { sendMessage: value => messages.push(value) } });
    view.onPopInput({ target: { dataset: { field: 'weight' }, type: 'range', value: '10' } });
    assert.equal(messages.length, 1);
    assert.match(messages[0].shapeHtml, new RegExp(`stroke-width="${10 * width / 1920}"`));
  }
});
