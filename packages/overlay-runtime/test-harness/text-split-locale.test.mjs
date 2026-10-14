import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('text splitting follows element language while Japanese keeps BudouX', () => {
  const window = { akari: { _budoux: { parse: text => [text] } } };
  runInNewContext(readFileSync(new URL('../src/text-split.js', import.meta.url), 'utf8'),
    { window, Intl, console });
  assert.deepEqual(Array.from(window.akari.textSplit.segment('日本語字幕', 'bunsetsu', 'ja')), ['日本語字幕']);
  assert.deepEqual(Array.from(window.akari.textSplit.segment('hello world', 'bunsetsu', 'en-US')),
    ['hello', ' ', 'world']);
});
