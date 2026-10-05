import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { placeTextCaption } from '../lib/common/place-text.js';
import { insertCaptionLine } from '../lib/common/caption-store.js';

const widgetSource = readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');

test('new plain text uses an 80 output pixel font without changing placed looks', () => {
  assert.match(widgetSource, /const placedOptions = \{ \.\.\.options, \.\.\.placement,[\s\S]*?sizePx:[\s\S]*?\? 80 : undefined \};/u);
  const stored = options => JSON.parse(insertCaptionLine('{"captions":[]}',
    placeTextCaption(options, 0, 10, []))).captions[0].text_style;
  assert.equal(stored({ sizePx: 80 }).size_px, 80);
  assert.equal(stored({}).size_px, undefined);
  assert.equal(stored({ stylePreset: 'title-impact' }).size_px, undefined);
  assert.equal(stored({ stylePresetLook: { size_px: 54 } }).size_px, undefined);
});

test('T placement writes 80px over the project fallback but respects a placed look', async () => {
  const parsed = ts.createSourceFile('widget.ts', widgetSource, ts.ScriptTarget.Latest, true);
  const widget = parsed.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'AkariAnnotationsWidget');
  const method = widget.members.find(node => node.name?.getText(parsed) === 'placeText');
  const code = ts.transpileModule(`class Widget { ${method.getText(parsed)} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
  let defaultTextStyle = {};
  const Widget = vm.runInNewContext(`${code}; Widget`, {
    placeTextCaption, parseCaptions: () => ({ captions: [], defaultTextStyle }),
    readInternalEdit: () => ({}), toAnchorCaptions: () => [],
    timelineDurationSeconds: () => ({ seconds: 10 }), canvasDropTargets: () => [],
  });
  const writes = [], warnings = [];
  const instance = Object.assign(new Widget(), {
    location: { editUri: { toString: () => 'edit' }, captionsUri: { toString: () => 'captions' },
      root: { toString: () => 'root' } }, playheadT: 2, playhead: { style: {} }, fps: 30,
    fileService: { readFile: async () => ({ value: { toString: () => JSON.stringify({ output: { width: 1920, height: 1080 } }) } }),
      exists: async () => true },
    annotationsService: { insertCaption: async request => {
      writes.push(JSON.parse(insertCaptionLine('{"captions":[]}', request.caption)).captions[0]);
    } },
    withHistory: async (_label, action) => action(), reloadCaptions: async () => {},
    selectCaptions() {}, requestSeek: async () => {}, publishPrimaryPreviewSelection() {},
    percent: value => value, messages: { warn: value => warnings.push(value) }, errorMessage: error => String(error)
  });
  assert.equal(await instance.placeText(), 'c-0001');
  assert.equal(writes.at(-1).text_style.size_px, 80);
  assert.equal(await instance.placeText({ stylePreset: 'title-impact' }), 'c-0001');
  assert.equal(writes.at(-1).text_style.size_px, undefined);
  defaultTextStyle = { size_px: 56 };
  assert.equal(await instance.placeText(), 'c-0001');
  assert.equal(writes.at(-1).text_style.size_px, 80);
  assert.deepEqual(warnings, []);
});
