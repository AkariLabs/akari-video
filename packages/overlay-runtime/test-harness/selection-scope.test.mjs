import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { descendantLeafIds, enterScope, exitScope, lineage, resolveScopedSelection } from '../src/selection-scope.mjs';

const tree = [
  { id: 'outer', parentId: null, kind: 'group' },
  { id: 'g', parentId: 'outer', kind: 'group' },
  { id: 'a', parentId: 'g', kind: 'leaf' },
  { id: 'b', parentId: 'g', kind: 'leaf' },
  { id: 'c', parentId: 'outer', kind: 'leaf' },
  { id: 'bag', parentId: null, kind: 'bag' },
  { id: 'bag#A', parentId: 'bag', kind: 'leaf' },
  { id: 'plain', parentId: null, kind: 'leaf' }
];
for (const [name, scope, hit, deep, expected] of [
  ['root ancestor', null, 'a', false, { selectId: 'outer', scopeId: null }],
  ['one scope at a time', 'outer', 'a', false, { selectId: 'g', scopeId: 'outer' }],
  ['leaf at immediate parent', 'g', 'a', false, { selectId: 'a', scopeId: 'g' }],
  ['nearest common scope', 'g', 'c', false, { selectId: 'c', scopeId: 'outer' }],
  ['outside branch', 'g', 'bag#A', false, { selectId: 'bag', scopeId: null }],
  ['deep click', null, 'a', true, { selectId: 'a', scopeId: 'g' }],
  ['direct leaf', null, 'plain', false, { selectId: 'plain', scopeId: null }]
]) test(`selection scope: ${name}`, () => assert.deepEqual(resolveScopedSelection(tree, scope, hit, { deep }), expected));

test('enter group follows hit, Enter chooses first child, leaf keeps parent', () => {
  assert.deepEqual(enterScope(tree, 'outer', 'b'), { selectId: 'g', scopeId: 'outer' });
  assert.deepEqual(enterScope(tree, 'g'), { selectId: 'a', scopeId: 'g' });
  assert.deepEqual(enterScope(tree, 'bag', 'bag#A'), { selectId: 'bag#A', scopeId: 'bag' });
  assert.deepEqual(enterScope(tree, 'a'), { selectId: 'a', scopeId: 'g' });
});
test('exit climbs once, then deselects; floor cannot be crossed', () => {
  assert.deepEqual(exitScope(tree, 'a', 'g', null), { selectId: 'g', scopeId: 'outer' });
  assert.deepEqual(exitScope(tree, 'g', 'outer', null), { selectId: 'outer', scopeId: null });
  assert.deepEqual(exitScope(tree, 'outer', null, null), { selectId: null, scopeId: null });
  assert.deepEqual(exitScope(tree, 'a', 'g', 'g'), { selectId: null, scopeId: 'g' });
  assert.deepEqual(exitScope(tree, 'plain', null, 'g'), { selectId: null, scopeId: 'g' });
});
test('empty tree and unknown leaf preserve flat selection', () => {
  assert.deepEqual(resolveScopedSelection([], null, 'plain'), { selectId: 'plain', scopeId: null });
  assert.deepEqual(resolveScopedSelection([], null, 'plain', { deep: true }), { selectId: 'plain', scopeId: null });
  assert.deepEqual(enterScope([], 'plain'), { selectId: 'plain', scopeId: null });
  assert.deepEqual(exitScope([], 'plain', null, null), { selectId: null, scopeId: null });
});
test('lineage and descendant order use the tree; cycle guard terminates', () => {
  assert.deepEqual(lineage(tree, 'a'), ['outer', 'g', 'a']);
  assert.deepEqual(descendantLeafIds(tree, 'outer'), ['a', 'b', 'c']);
  assert.deepEqual(descendantLeafIds(tree, 'bag'), ['bag#A']);
  assert.deepEqual(descendantLeafIds(tree, 'a'), ['a']);
  assert.deepEqual(lineage(tree, 'missing'), []);
  assert.deepEqual(lineage([{ id: 'cycle', parentId: 'cycle' }], 'cycle'), ['cycle']);
});
test('classic interaction copy exactly matches canonical pure functions', () => {
  const block = source => source.slice(source.indexOf('// BEGIN selection-scope'), source.indexOf('// END selection-scope'));
  const canonical = readFileSync(new URL('../src/selection-scope.mjs', import.meta.url), 'utf8');
  const classic = readFileSync(new URL('../src/interaction.js', import.meta.url), 'utf8');
  assert.ok(block(canonical).length > 100);
  assert.equal(block(classic), block(canonical));
});

test('idle floor Esc passes through; selection or deeper scope still handles it', async () => {
  const { shouldHandleScopeEscape } = await import('../src/selection-scope.mjs');
  assert.equal(shouldHandleScopeEscape(null, null, null), false);
  assert.equal(shouldHandleScopeEscape(null, 'g', 'g'), false);
  assert.equal(shouldHandleScopeEscape('a', 'g', 'g'), true);
  assert.equal(shouldHandleScopeEscape(null, 'g', null), true);
});
test('only the lazy bag matching the current scope requests expansion', async () => {
  const { lazyBagForScope } = await import('../src/selection-scope.mjs');
  const lazyTree = [...tree, { id: 'lazy', parentId: null, kind: 'bag', lazy: true },
    { id: 'lazy#A', parentId: 'lazy', kind: 'leaf', lazy: true }];
  assert.equal(lazyBagForScope(lazyTree, null), null);
  assert.equal(lazyBagForScope(lazyTree, 'bag'), null);
  assert.equal(lazyBagForScope(lazyTree, 'lazy'), 'lazy');
  assert.equal(lazyBagForScope(lazyTree, 'lazy#A'), null);
  assert.equal(lazyBagForScope(lazyTree, 'missing'), null);
});

test('additive selection toggles immediate siblings in insertion order and chooses the last survivor', async () => {
  const { toggleScopedSelection: toggle } = await import('../src/selection-scope.mjs');
  const hit = (selectId, scopeId = 'g') => ({ selectId, scopeId });
  assert.deepEqual(toggle(tree, ['a'], 'g', hit('b')), { selectedIds: ['a','b'], selectId: 'b', scopeId: 'g' });
  assert.deepEqual(toggle(tree, ['a','b'], 'g', hit('a')), { selectedIds: ['b'], selectId: 'b', scopeId: 'g' });
  assert.deepEqual(toggle(tree, ['a','b'], 'g', hit('b')), { selectedIds: ['a'], selectId: 'a', scopeId: 'g' });
  assert.deepEqual(toggle(tree, ['a'], 'g', hit('a')), { selectedIds: [], selectId: null, scopeId: 'g' });
  assert.deepEqual(toggle(tree, ['a','b'], 'g', hit('plain', null)), { selectedIds: ['plain'], selectId: 'plain', scopeId: null });
  assert.deepEqual(toggle(tree, ['a'], 'g', hit('c')), { selectedIds: ['c'], selectId: 'c', scopeId: 'g' });
  assert.deepEqual(toggle(tree, ['plain'], null, hit('a')), { selectedIds: ['a'], selectId: 'a', scopeId: 'g' });
  assert.deepEqual(toggle(tree, ['a','b'], 'g', hit(null)), { selectedIds: [], selectId: null, scopeId: 'g' });
  assert.deepEqual(toggle(tree, ['outer'], null, hit('bag', null)).selectedIds, ['outer','bag']);
});
