import assert from 'node:assert/strict'; import test from 'node:test';
import { wordContextMenuGroups } from '../lib/browser/daihon/daihon-word-context-menu.js';
const groups = wordContextMenuGroups({ rangeCount: 2, wordCount: 4, text: '選択', nextWordText: '次',
  presets: [{ id: 'neon', name: 'Neon' }], splitAvailable: false, mergeAvailable: false, itemCaptionsAvailable: false });
test('declares five groups in mock order and multi-range heading', () => {
  assert.deepEqual(groups.map(group => group.title), ['2 範囲を一括「選択」', '強調', '挿入', '行', 'マーク']);
  assert.match(groups[0].title, /2 範囲を一括/); assert.equal(groups[4].colors.length, 6);
});
test('declares four insertion coming-soon items and two T4 placeholders', () => {
  assert.equal(groups[2].items.filter(item => item.action?.kind === 'coming-soon').length, 4);
  assert.equal(groups[3].items.filter(item => item.action?.kind === 'coming-soon').length, 2);
});
