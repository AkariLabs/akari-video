import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

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
