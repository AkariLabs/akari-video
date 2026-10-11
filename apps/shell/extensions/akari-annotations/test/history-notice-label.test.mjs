import { t as annotationT, setLanguage as setAnnotationLanguage } from '@akari-video/i18n';
import * as annotationI18n from '@akari-video/i18n';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

setAnnotationLanguage('ja');
globalThis.t = annotationT;
globalThis.i18n_1 = annotationI18n;
test.beforeEach(() => { setAnnotationLanguage('ja'); globalThis.t = annotationT; globalThis.i18n_1 = annotationI18n; });
test.after(() => { setAnnotationLanguage(undefined); delete globalThis.t; delete globalThis.i18n_1; });

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');
const start = source.indexOf('    protected applyHistoryExecution(execution: HistoryExecution): void {');
assert.ok(start >= 0);
const method = source.slice(start, source.indexOf('    protected clipboardSelections(', start));
const compiled = ts.transpileModule(`class HistoryHarness { ${method} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;
const HistoryHarness = new Function(`${compiled}; return HistoryHarness;`)();

test('undo and redo quote plain labels without double quoting labels already wrapped', () => {
  const widget = new HistoryHarness();
  widget.footer = { textContent: '' };
  widget.hideNotice = () => {};
  widget.revealOutputPreview = () => {};
  for (const [kind, label, expected] of [
    ['undo', 'カットを整える', '「カットを整える」を元に戻しました。'],
    ['redo', 'カットを整える', '「カットを整える」をやり直しました。'],
    ['undo', '「字幕を移動」', '「字幕を移動」を元に戻しました。'],
    ['redo', '「字幕を移動」', '「字幕を移動」をやり直しました。']
  ]) {
    widget.applyHistoryExecution({ kind, entry: { label } });
    assert.equal(widget.footer.textContent, expected);
  }
});

test('English history labels are quoted once', () => {
  setAnnotationLanguage('en');
  const widget = new HistoryHarness();
  widget.footer = { textContent: '' };
  widget.hideNotice = () => {};
  widget.revealOutputPreview = () => {};
  widget.applyHistoryExecution({ kind: 'undo', entry: { label: 'Trim cut' } });
  assert.equal(widget.footer.textContent, 'Undid “Trim cut”.');
  widget.applyHistoryExecution({ kind: 'redo', entry: { label: '“Move captions”' } });
  assert.equal(widget.footer.textContent, 'Redid “Move captions”.');
});
