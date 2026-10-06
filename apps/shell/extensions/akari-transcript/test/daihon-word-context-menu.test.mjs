import assert from 'node:assert/strict'; import test from 'node:test';
import { wordContextMenuGroups, openWordContextMenu } from '../lib/browser/daihon/daihon-word-context-menu.js';
const groups = wordContextMenuGroups({ rangeCount: 2, wordCount: 4, text: '選択', nextWordText: '次',
  splitAvailable: false, mergeAvailable: false,
  mergeNextAvailable: true, wordInsertAvailable: false, itemCaptionsAvailable: false });
test('declares operation groups in order and multi-range heading', () => {
  assert.deepEqual(groups.map(group => group.title), ['2 範囲を一括「選択」', '行', 'マーク']);
  assert.match(groups[0].title, /2 範囲を一括/); assert.equal(groups[2].colors.length, 6);
});
test('hides unavailable actions and keeps next-row merge', () => {
  assert.equal(groups.flatMap(group => group.items).some(item => /Coming soon|辞書|Freeze/u.test(item.label)), false);
  assert.equal(groups.some(group => group.title === '挿入'), false);
  assert.equal(groups[1].items.length, 2);
  assert.deepEqual(groups[1].items.find(item => item.action?.kind === 'merge-next')?.action, { kind: 'merge-next' });
});
test('word context menu has no appearance edits', () => {
  assert.equal(groups.some(group => group.title === '強調' || group.presets?.length), false);
  assert.equal(groups.flatMap(group => group.items).some(item =>
    item.action?.kind === 'preset' || item.action?.kind === 'preset-clear' || item.label === '強調を外す'), false);
});
test('右クリックの DOM に空の見出しと未提供の操作を出さない', () => {
  const oldDocument = globalThis.document, oldWindow = globalThis.window;
  const node = () => ({ children: [], style: {}, classList: { add() {} },
    appendChild(child) { this.children.push(child); }, addEventListener() {}, offsetWidth: 180, offsetHeight: 240 });
  const body = node();
  globalThis.document = { createElement: node, body };
  globalThis.window = { innerWidth: 800, innerHeight: 600 };
  try {
    const menu = openWordContextMenu({ x: 30, y: 40, groups, onAction() {} });
    assert.equal(body.children[0], menu);
    const labels = menu.children.flatMap(group => group.children.length ? group.children.map(item => item.textContent) : [group.textContent]);
    assert.equal(labels.includes('挿入'), false);
    assert.equal(labels.some(label => /Coming soon|辞書|Freeze/u.test(label ?? '')), false);
  } finally {
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
  }
});
