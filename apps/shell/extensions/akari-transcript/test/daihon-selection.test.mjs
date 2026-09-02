import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    EMPTY_SELECTION,
    applyDragRange,
    applySelectionClick,
    clearSelection,
    planSelectionUpdate,
    pruneSelection,
    selectAll
} = require('../lib/common/daihon-selection.js');

const order = ['a', 'b', 'c', 'd', 'e'];
const click = (state, targetId, modifiers = {}) => applySelectionClick(
    state, order, targetId, { shift: false, meta: false, ...modifiers }
);

test('単独クリックは対象だけを選択して anchor にする', () => {
    assert.deepEqual(click({ selected: ['a', 'c'], anchorId: 'a' }, 'd'), {
        selected: ['d'], anchorId: 'd'
    });
});

test('⌘クリックは対象を順序どおり追加する', () => {
    assert.deepEqual(click({ selected: ['b', 'd'], anchorId: 'd' }, 'a', { meta: true }), {
        selected: ['a', 'b', 'd'], anchorId: 'a'
    });
});

test('⌘クリックは選択済み対象を解除する', () => {
    assert.deepEqual(click({ selected: ['b', 'd'], anchorId: 'b' }, 'd', { meta: true }), {
        selected: ['b'], anchorId: 'd'
    });
});

test('Shift クリックは anchor から昇順の範囲へ置換する', () => {
    assert.deepEqual(click({ selected: ['b'], anchorId: 'b' }, 'e', { shift: true }), {
        selected: ['b', 'c', 'd', 'e'], anchorId: 'b'
    });
});

test('Shift クリックは anchor から降順でも order 順の範囲へ置換する', () => {
    assert.deepEqual(click({ selected: ['d'], anchorId: 'd' }, 'b', { shift: true }), {
        selected: ['b', 'c', 'd'], anchorId: 'd'
    });
});

test('anchor 無しの Shift クリックは単独選択として扱う', () => {
    assert.deepEqual(click({ selected: ['a'], anchorId: null }, 'c', { shift: true }), {
        selected: ['c'], anchorId: 'c'
    });
});

test('order に無い id のクリックは無視する', () => {
    const state = { selected: ['a'], anchorId: 'a' };
    assert.equal(click(state, 'missing'), state);
});

test('ドラッグは anchor を維持して範囲へ置換する', () => {
    assert.deepEqual(applyDragRange({ selected: ['a'], anchorId: 'a' }, order, 'd', 'b'), {
        selected: ['b', 'c', 'd'], anchorId: 'd'
    });
});

test('pruneSelection は消えた id と anchor を落とす', () => {
    assert.deepEqual(pruneSelection({ selected: ['a', 'c'], anchorId: 'c' }, ['a', 'b']), {
        selected: ['a'], anchorId: null
    });
});

test('pruneSelection は変化が無ければ同じ参照を返す', () => {
    const state = { selected: ['a', 'c'], anchorId: 'c' };
    assert.equal(pruneSelection(state, order), state);
});

test('selectAll は全行を order 順に選択する', () => {
    assert.deepEqual(selectAll(order), { selected: order, anchorId: null });
});

test('clearSelection は EMPTY_SELECTION を返す', () => {
    assert.equal(clearSelection(), EMPTY_SELECTION);
    assert.deepEqual(clearSelection(), { selected: [], anchorId: null });
});

test('planSelectionUpdate は付け外しが必要な id だけを返す', () => {
    assert.deepEqual(planSelectionUpdate(
        { selected: ['a', 'c'], anchorId: 'c' },
        { selected: ['b', 'c', 'e'], anchorId: 'e' }
    ), { add: ['b', 'e'], remove: ['a'] });
});
