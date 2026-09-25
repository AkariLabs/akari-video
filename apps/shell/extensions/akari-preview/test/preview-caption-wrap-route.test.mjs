import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { persistCaptionPlateTransform } from '../lib/common/caption-plate-handles.js';
import { duplicatePreviewCaptionSource } from '../lib/common/preview-duplicate-fallback.js';

const compiled = readFileSync(new URL('../lib/browser/akari-preview-open-handler.js', import.meta.url), 'utf8');
const start = compiled.indexOf('    async handleCaptionWrite(');
const end = compiled.indexOf('    isCaptionWriteRequest(', start);
assert.ok(start >= 0 && end > start);
const Host = vm.runInNewContext('(class {' + compiled.slice(start, end) + '})', {
  caption_plate_handles_1: { persistCaptionPlateTransform },
  preview_duplicate_fallback_1: { duplicatePreviewCaptionSource },
  buffer_1: { BinaryBuffer: { fromString: text => text } }
});

test('caption edge width reaches the undo command and refreshes preview after success', async () => {
  const host = new Host();
  const commands = [], refreshes = [], responses = [];
  host.commandRegistry = { getCommand: () => ({}),
    executeCommand: async (...args) => { commands.push(args); return true; } };
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

test('caption edge writes linted width and placement with the timeline closed', async () => {
  const source = JSON.stringify({ captions: [{ id: 'c-0001', text: '長い文字列' }] });
  const host = new Host();
  const writes = [], linted = [], refreshed = [], responses = [], history = [];
  host.readText = async () => source;
  host.commandRegistry = { getCommand: () => ({}), executeCommand: async () => false };
  host.previewService = { lintEditCandidate: async request => { linted.push(request); return { pass: true }; } };
  host.fileService = { writeFile: async (_uri, text) => {
    assert.equal(linted.length, 1, 'edit-lint must finish before the direct write');
    writes.push(text);
  } };
  host.markRecentWrite = () => {};
  host.notifyCaptionWrite = (...args) => history.push(args);
  host.refreshCaptionsAfterHistoryWrite = uri => refreshed.push(uri);
  const widget = { akariPreviewCaptionsUri: { toString: () => 'file:///project/captions.json' },
    akariPreviewEditUri: { toString: () => 'file:///project/edit.json' },
    sendMessage: response => responses.push(response) };
  await host.handleCaptionWrite(widget, { requestId: 'closed', captionId: 'c-0001',
    patch: { plateTransform: { captionIds: ['c-0001'], wrapWidthPct: 21.56,
      cuePosition: { captionId: 'c-0001', value: { anchor: 'tl', position: { x: .2844, y: .6481 } } } } } });
  assert.equal(linted.length, 1, JSON.stringify(responses));
  assert.equal(linted[0].editUri, 'file:///project/captions.json');
  assert.equal(writes.length, 1);
  assert.equal(linted[0].candidateText, writes[0]);
  assert.deepEqual(JSON.parse(writes[0]).captions[0].text_style, {
    wrap_width_pct: 21.56, text_anchor: 'tl', position: { x: .2844, y: .6481 }
  });
  assert.equal(history.length, 1);
  assert.deepEqual(refreshed, ['file:///project/captions.json']);
  assert.equal(responses[0].ok, true);
});

test('caption width does not write a candidate rejected by edit-lint', async () => {
  const host = new Host();
  const writes = [], responses = [];
  host.readText = async () => JSON.stringify({ captions: [{ id: 'c-0001', text: '文字' }] });
  host.commandRegistry = { getCommand: () => undefined };
  host.previewService = { lintEditCandidate: async () => ({ pass: false, errors: ['invalid caption'] }) };
  host.fileService = { writeFile: async (...args) => writes.push(args) };
  await host.handleCaptionWrite({ akariPreviewCaptionsUri: { toString: () => 'file:///project/captions.json' },
    akariPreviewEditUri: { toString: () => 'file:///project/edit.json' },
    sendMessage: response => responses.push(response) },
  { requestId: 'bad', captionId: 'c-0001', patch: { plateTransform: {
    captionIds: ['c-0001'], wrapWidthPct: 25,
    cuePosition: { captionId: 'c-0001', value: { anchor: 'tl', position: { x: .2, y: .7 } } }
  } } });
  assert.equal(writes.length, 0);
  assert.equal(responses[0].ok, false);
  assert.equal(responses[0].error, 'invalid caption');
});

test('Alt drag of placed text duplicates one cue through lint when the timeline is closed', async () => {
  const source = JSON.stringify({ captions: [{ id: 'c-0001', text: '元の文字' }] });
  const host = new Host();
  const writes = [], linted = [], responses = [], refreshed = [];
  host.readText = async () => source;
  host.commandRegistry = { getCommand: () => ({}), executeCommand: async () => false };
  host.previewService = { lintEditCandidate: async candidate => { linted.push(candidate); return { pass: true }; } };
  host.fileService = { writeFile: async (_uri, text) => {
    assert.equal(linted.length, 1);
    writes.push(text);
  } };
  host.markRecentWrite = () => {};
  host.notifyCaptionWrite = () => {};
  host.refreshCaptionsAfterHistoryWrite = uri => refreshed.push(uri);
  await host.handleCaptionWrite({ akariPreviewCaptionsUri: { toString: () => 'file:///project/captions.json' },
    akariPreviewEditUri: { toString: () => 'file:///project/edit.json' },
    sendMessage: response => responses.push(response) },
  { requestId: 'copy', captionId: 'c-0001', patch: { duplicate: {
    anchor: 'tl', position: { x: .3, y: .7 }
  } } });
  assert.equal(writes.length, 1);
  assert.equal(linted[0].candidateText, writes[0]);
  const cues = JSON.parse(writes[0]).captions;
  assert.equal(cues.length, 2);
  assert.equal(cues[0].id, 'c-0001');
  assert.equal(cues[0].text_style, undefined);
  assert.equal(cues[1].id, 'c-0002');
  assert.deepEqual(cues[1].text_style, { text_anchor: 'tl', position: { x: .3, y: .7 } });
  assert.deepEqual(refreshed, ['file:///project/captions.json']);
  assert.equal(responses[0].ok, true);
});
