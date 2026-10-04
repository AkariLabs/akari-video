import assert from 'node:assert/strict';
import test from 'node:test';
import { readHandlerSource } from './helpers/handler-source.mjs';

const source = readHandlerSource();

test('台本選択と ⌥ 全体モードを caption plate まで配線する', () => {
  for (const token of [
    'data-selected',
    'data-alt-all',
    'akari-preview-set-selected-captions',
    'akari-preview-alt-all',
    'akari.selection.altAll'
  ]) {
    assert.match(source, new RegExp(token.replaceAll('.', '\\.')));
  }
  assert.match(source, /caption\.sourceCueId \|\| caption\.id/);
  assert.match(source, /window\.akari\.reportAltAll = on => vscode\.postMessage\(\{ type: 'akari-preview-alt-all', on \}\)/);
  assert.match(source, /window\.akari\.reportAltAll\?\.\(on\)/);
  assert.match(source, /window\.addEventListener\('blur', \(\) => setCaptionAltAll\(false\)\)/);
});
