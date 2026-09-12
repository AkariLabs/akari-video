import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(extensionRoot, 'src/browser/akari-preview-open-handler.ts'), 'utf8');

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
  assert.match(source, /activeCaption\.sourceCueId \|\| activeCaption\.id/);
  assert.match(source, /window\.akari\.reportAltAll = on => vscode\.postMessage\(\{ type: 'akari-preview-alt-all', on \}\)/);
  assert.match(source, /window\.akari\.reportAltAll\?\.\(on\)/);
  assert.match(source, /window\.addEventListener\('blur', \(\) => setCaptionAltAll\(false\)\)/);
});
