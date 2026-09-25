import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const compiled = readFileSync(new URL('../lib/browser/akari-preview-open-handler.js', import.meta.url), 'utf8');
const start = compiled.indexOf('    async handleCaptionWrite(');
const end = compiled.indexOf('    isCaptionWriteRequest(', start);
assert.ok(start >= 0 && end > start);
const Host = vm.runInNewContext('(class {' + compiled.slice(start, end) + '})', {});

test('caption edge width reaches the undo command and refreshes preview after success', async () => {
  const host = new Host();
  const commands = [], refreshes = [], responses = [];
  host.commandRegistry = { executeCommand: async (...args) => { commands.push(args); return true; } };
  host.refreshCaptionsAfterHistoryWrite = uri => refreshes.push(uri);
  const widget = { akariPreviewCaptionsUri: { toString: () => 'file:///project/captions.json' },
    akariPreviewEditUri: { toString: () => 'file:///project/edit.json' },
    sendMessage: response => responses.push(response) };
  await host.handleCaptionWrite(widget, { requestId: 'r1', captionId: 'c-0001',
    patch: { plateTransform: { captionIds: ['c-0001'], wrapWidthPct: 32,
      cuePosition: { captionId: 'c-0001', value: { anchor: 'tl', position: { x: .2, y: .3 } } } } } });
  assert.deepEqual(JSON.parse(JSON.stringify(commands[0])), ['akari.annotations.commitPreviewTransform',
    'file:///project/edit.json', { kind: 'caption-wrap', captionId: 'c-0001',
      wrapWidthPct: 32, anchor: 'tl', position: { x: .2, y: .3 } }]);
  assert.deepEqual(refreshes, ['file:///project/captions.json']);
  assert.deepEqual(JSON.parse(JSON.stringify(responses)), [{ type: 'akari-preview-caption-write-response', requestId: 'r1', ok: true }]);
});
