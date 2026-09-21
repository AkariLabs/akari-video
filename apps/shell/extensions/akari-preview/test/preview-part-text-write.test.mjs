import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';
import { resolvePreviewItemWrite } from '../../../../../packages/edit-store/lib/edit-v2-item-write.js';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const fixture = readFileSync(new URL('../../../../../packages/render-cut/test/fixtures/object-tree-html-bag/edit.json', import.meta.url), 'utf8');
const methods = ['handleOverlayWrite', 'isOverlayWriteRequest'].map(name => {
  const start = source.search(new RegExp(`^    protected (?:async )?${name}\\(`, 'mu'));
  const end = source.indexOf('\n    }', start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end + 6);
}).join('\n');
const code = ts.transpileModule(`class Host { ${methods} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;
const Host = vm.runInNewContext(`${code}; Host`, {
  resolvePreviewItemWrite, BinaryBuffer: { fromString: value => value }, Error
});
const request = patch => ({ type: 'akari-preview-overlay-write', requestId: 'test-1', overlayId: 's01.C', patch });
const uri = value => ({ toString: () => value, resolve: child => uri(`${value}/${child}`) });
function hostFixture() {
  const host = new Host(), writes = [], responses = [], linted = [];
  host.readText = async () => fixture;
  host.recentWrites = new Map();
  host.fileService = { exists: async () => true, writeFile: async (target, text) => writes.push({ target: target.toString(), text }) };
  host.previewService = { lintEditCandidate: async input => { linted.push(input); return { pass: true }; } };
  const editUri = { ...uri('file:///fixture/edit.json'), parent: uri('file:///fixture') };
  const widget = { akariPreviewEditUri: editUri, sendMessage: message => responses.push(message) };
  return { host, widget, writes, responses, linted };
}

test('overlay request guard admits strings including empty text, rejects every non-string text', () => {
  const host = new Host();
  for (const patch of [{ text: 'new' }, { text: '' }, { html: '<b>plain</b>' }, { params: { title: 'slot' } }]) {
    assert.equal(host.isOverlayWriteRequest(request(patch)), true);
  }
  for (const text of [undefined, null, 42, false, [], {}]) {
    assert.equal(host.isOverlayWriteRequest(request({ text })), false);
  }
});
test('text handler writes only linted edit.json, with no HTML file writes', async () => {
  const { host, widget, writes, responses, linted } = hostFixture();
  await host.handleOverlayWrite(widget, request({ text: 'New C' }));
  assert.equal(linted.length, 1);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].target, 'file:///fixture/edit.json');
  assert.equal(JSON.parse(writes[0].text).tracks[3].items[0].source.text, 'New C');
  assert.equal(responses[0].ok, true);
});
test('handler rejects a bypassed non-string text request before reading or writing', async () => {
  const { host, widget, writes, responses, linted } = hostFixture();
  host.readText = async () => assert.fail('must reject before reading');
  await host.handleOverlayWrite(widget, request({ text: 42 }));
  assert.equal(responses[0].ok, false);
  assert.match(responses[0].error, /text は文字列/u);
  assert.equal(writes.length, 0); assert.equal(linted.length, 0);
});
test('part html is rejected before the host can overwrite the shared card', async () => {
  const { host, widget, writes, responses } = hostFixture();
  await host.handleOverlayWrite(widget, request({ html: '<div data-akari-part-mask="C">bad</div>' }));
  assert.equal(writes.length, 0);
  assert.equal(responses[0].ok, false);
  assert.match(responses[0].error, /部品の文字は source.text に保存します/u);
});
test('failed text lint writes neither edit.json nor HTML', async () => {
  const { host, widget, writes, responses } = hostFixture();
  host.previewService.lintEditCandidate = async () => ({ pass: false, errors: ['fixture lint failure'] });
  await host.handleOverlayWrite(widget, request({ text: 'New C' }));
  assert.equal(writes.length, 0);
  assert.equal(responses[0].ok, false);
  assert.equal(responses[0].error, 'fixture lint failure');
});
