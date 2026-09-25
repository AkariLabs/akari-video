import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const compiled = readFileSync(new URL('../lib/browser/akari-preview-open-handler.js', import.meta.url), 'utf8');
const start = compiled.indexOf('    async handleOverlayWrite(');
const end = compiled.indexOf('    async persistPreviewTransform(', start);
assert.ok(start >= 0 && end > start);
const Host = vm.runInNewContext('(class {' + compiled.slice(start, end) + '})', {});

test('Alt duplicate overlay request reaches one undo command with the destination transform', async () => {
  const host = new Host();
  const commands = [], responses = [];
  host.commandRegistry = { getCommand: () => ({}),
    executeCommand: async (...args) => { commands.push(args); return true; } };
  const widget = { akariPreviewEditUri: { toString: () => 'file:///project/edit.json' },
    sendMessage: response => responses.push(response) };
  await host.handleOverlayWrite(widget, { requestId: 'r1', overlayId: 'box-a',
    patch: { duplicate: true, transform: { x: 240, y: 160, scale: 1, rotate: 0 } } });
  assert.deepEqual(JSON.parse(JSON.stringify(commands)), [[
    'akari.annotations.commitPreviewTransform', 'file:///project/edit.json',
    { kind: 'duplicate', itemId: 'box-a', transform: { x: 240, y: 160, scale: 1, rotate: 0 } }
  ]]);
  assert.deepEqual(JSON.parse(JSON.stringify(responses)), [
    { type: 'akari-preview-overlay-write-response', requestId: 'r1', ok: true }
  ]);
});
