import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../src/browser/daihon/akari-daihon-widget.ts', import.meta.url), 'utf8');
const start = source.indexOf('    protected readSelectedRowsAloud(): void {');
assert.ok(start >= 0);
const end = source.indexOf('\n    protected ', start + 1);
const compiled = ts.transpileModule(`class ReadHarness { ${source.slice(start, end)} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;
const ReadHarness = new Function(`${compiled}; return ReadHarness;`)();

test('読み上げは選択が空なら呼ばず、2 行を選べばその ID だけを渡す', () => {
  const calls = [];
  const widget = Object.assign(new ReadHarness(), {
    selection: { selected: [] }, editUri: { toString: () => 'file:///edit.json' },
    commands: { executeCommand(...args) { calls.push(args); } }
  });
  widget.readSelectedRowsAloud();
  assert.deepEqual(calls, []);
  widget.selection.selected = ['r2', 'r4'];
  widget.readSelectedRowsAloud();
  assert.deepEqual(calls, [['akari.caption.readAloud', { captionIds: ['r2', 'r4'] }, 'file:///edit.json']]);
});
