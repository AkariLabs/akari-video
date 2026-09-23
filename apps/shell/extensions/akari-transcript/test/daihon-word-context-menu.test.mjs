import assert from 'node:assert/strict'; import test from 'node:test';
import { readFileSync } from 'node:fs';
import { wordContextMenuGroups } from '../lib/browser/daihon/daihon-word-context-menu.js';
const groups = wordContextMenuGroups({ rangeCount: 2, wordCount: 4, text: '選択', nextWordText: '次',
  splitAvailable: false, mergeAvailable: false,
  mergeNextAvailable: true, wordInsertAvailable: false, itemCaptionsAvailable: false });
test('declares operation groups in order and multi-range heading', () => {
  assert.deepEqual(groups.map(group => group.title), ['2 範囲を一括「選択」', '挿入', '行', 'マーク']);
  assert.match(groups[0].title, /2 範囲を一括/); assert.equal(groups[3].colors.length, 6);
});
test('declares insertion placeholders and next-row merge action', () => {
  assert.equal(groups[1].items.filter(item => item.action?.kind === 'coming-soon').length, 4);
  assert.equal(groups[2].items.filter(item => item.action?.kind === 'coming-soon').length, 2);
  assert.deepEqual(groups[2].items.find(item => item.action?.kind === 'merge-next')?.action, { kind: 'merge-next' });
});
test('word context menu has no appearance edits', () => {
  assert.equal(groups.some(group => group.title === '強調' || group.presets?.length), false);
  assert.equal(groups.flatMap(group => group.items).some(item =>
    item.action?.kind === 'preset' || item.action?.kind === 'preset-clear' || item.label === '強調を外す'), false);
});
test('word click preserves pointer selection and right-click opens the word menu', () => {
  const source = readFileSync(new URL('../src/browser/daihon/akari-daihon-widget.ts', import.meta.url), 'utf8');
  const click = source.match(/span\.addEventListener\('click', event => \{[\s\S]*?this\.openRowDock\('emphasis'\);\s*\}\);/u)?.[0];
  assert.ok(click);
  assert.doesNotMatch(click, /this\.wordRanges\s*=/u);
  assert.match(source, /span\.addEventListener\('contextmenu', event => \{\s*event\.preventDefault\(\); event\.stopPropagation\(\);\s*this\.openWordMenu\(event, row, index\)/u);
});
