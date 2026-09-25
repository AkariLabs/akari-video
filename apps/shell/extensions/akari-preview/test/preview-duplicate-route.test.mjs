import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { duplicatePreviewItemSource } from '../lib/common/preview-duplicate-fallback.js';

const compiled = readFileSync(new URL('../lib/browser/akari-preview-open-handler.js', import.meta.url), 'utf8');
const start = compiled.indexOf('    async handleOverlayWrite(');
const end = compiled.indexOf('    async persistPreviewTransform(', start);
assert.ok(start >= 0 && end > start);
const Host = vm.runInNewContext('(class {' + compiled.slice(start, end) + '})', {
  preview_duplicate_fallback_1: { duplicatePreviewItemSource }, BinaryBuffer: { fromString: text => text },
  buffer_1: { BinaryBuffer: { fromString: text => text } }
});

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

test('Alt duplicate writes one linted v2 item when the undo command declines a closed timeline', async () => {
  const source = JSON.stringify({ version: 2, tracks: [{ id: 'v1', lane: 'visual', items: [
    { id: 'box-a', kind: 'shape', transform: { x: 0, y: 0 }, locked: true }
  ] }] });
  const host = new Host();
  const writes = [], linted = [], responses = [];
  host.readText = async () => source;
  host.recentWrites = new Map();
  host.queueRefresh = () => {};
  host.commandRegistry = { getCommand: () => ({}), executeCommand: async () => false };
  host.previewService = { lintEditCandidate: async request => { linted.push(request); return { pass: true }; } };
  host.fileService = { writeFile: async (_uri, text) => {
    assert.equal(linted.length, 1, 'edit-lint must finish before the direct write');
    writes.push(text);
  } };
  const uri = { toString: () => 'file:///project/edit.json' };
  const widget = { akariPreviewEditUri: uri, sendMessage: response => responses.push(response) };
  await host.handleOverlayWrite(widget, { requestId: 'closed', overlayId: 'box-a',
    patch: { duplicate: true, transform: { x: 240, y: 160 } } });
  assert.equal(linted.length, 1, JSON.stringify(responses));
  assert.equal(writes.length, 1);
  assert.equal(linted[0].candidateText, writes[0]);
  const tracks = JSON.parse(writes[0]).tracks;
  assert.equal(tracks.length, 2);
  assert.deepEqual(tracks[0].items[0].transform, { x: 0, y: 0 });
  assert.equal(tracks[0].items.length, 1);
  assert.equal(tracks[1].id, 'v2');
  assert.equal(tracks[1].items[0].id, 'box-a-copy-1');
  assert.deepEqual(tracks[1].items[0].transform, { x: 240, y: 160 });
  assert.equal(responses[0].ok, true);
});

test('closed-timeline Alt duplicate refreshes from the written edit after its watcher event is suppressed', async () => {
  const source = JSON.stringify({ version: 2, tracks: [{ id: 'v1', lane: 'visual', items: [
    { id: 'box-a', at: 0, duration: 90, source: { kind: 'shape', shape: 'rect' } }
  ] }] });
  const host = new Host();
  const steps = [], responses = [];
  host.readText = async () => source;
  host.recentWrites = new Map();
  host.commandRegistry = { getCommand: () => undefined };
  host.previewService = { lintEditCandidate: async () => ({ pass: true }) };
  host.fileService = { writeFile: async (_uri, text) => steps.push({ kind: 'write', text }) };
  host.queueRefresh = (...args) => steps.push({ kind: 'refresh', args });
  const uri = { toString: () => 'file:///project/edit.json' };
  const widget = { akariPreviewEditUri: uri, sendMessage: response => responses.push(response) };
  await host.handleOverlayWrite(widget, { requestId: 'refresh-copy', overlayId: 'box-a',
    patch: { duplicate: true, transform: { x: 120, y: 40 } } });
  assert.deepEqual(steps.map(step => step.kind), ['write', 'refresh']);
  assert.equal(host.recentWrites.has(uri.toString()), true);
  assert.equal(steps[1].args[0], widget);
  assert.equal(steps[1].args[1], uri);
  assert.deepEqual(steps[1].args.slice(2, 5), ['output', undefined, false]);
  assert.equal(steps[1].args[5], steps[0].text);
  assert.equal(JSON.parse(steps[1].args[5]).tracks[1].items[0].id, 'box-a-copy-1');
  assert.equal(responses[0].ok, true);
});

test('Alt duplicate does not write a candidate rejected by edit-lint', async () => {
  const host = new Host();
  const responses = [], writes = [];
  host.readText = async () => JSON.stringify({ version: 2, tracks: [{ lane: 'visual',
    items: [{ id: 'box-a', kind: 'shape' }] }] });
  host.recentWrites = new Map();
  host.commandRegistry = { getCommand: () => undefined };
  host.previewService = { lintEditCandidate: async () => ({ pass: false, errors: ['invalid candidate'] }) };
  host.fileService = { writeFile: async (...args) => writes.push(args) };
  await host.handleOverlayWrite({ akariPreviewEditUri: { toString: () => 'file:///project/edit.json' },
    sendMessage: response => responses.push(response) },
  { requestId: 'bad', overlayId: 'box-a', patch: { duplicate: true, transform: { x: 10 } } });
  assert.equal(writes.length, 0);
  assert.equal(responses[0].ok, false);
  assert.equal(responses[0].error, 'invalid candidate');
});
