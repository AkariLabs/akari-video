import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    retainedInspectorView, viewForInspectorSelection, shouldDeferInspectorEmpty,
    rememberedInspectorScroll, withoutInspectorFocus, focusForInspectorRender,
    shouldRememberInspectorScroll, inspectorHeldHeight, mergeLiveValues, visibleLiveValues
} from '../lib/browser/inspector/live-state.js';

test('same item keeps scroll, tab, focus and caret; another item starts at top', () => {
    const view = { selectionKey: 'item:a', scrollTop: 311, tabId: 'edit',
        focusField: 'transform-x', focusPart: 1, selectionStart: 2, selectionEnd: 4, inputValue: '12.34' };
    assert.deepEqual(retainedInspectorView(view, 'item:a'), view);
    assert.deepEqual(retainedInspectorView(view, 'item:b'), { selectionKey: 'item:b', scrollTop: 0 });
});

test('a temporary empty selection keeps the last real item view', () => {
    const box = { selectionKey: 'item:box-a', scrollTop: 420, tabId: 'video',
        focusField: 'field:inspector-transform-y', focusPart: 1 };
    const empty = viewForInspectorSelection(box, undefined, 'item:box-a');
    assert.deepEqual(empty, box);
    assert.deepEqual(viewForInspectorSelection(empty, 'item:box-a', 'item:box-a'), box);
    assert.deepEqual(viewForInspectorSelection(empty, 'item:box-b', 'item:box-a'),
        { selectionKey: 'item:box-b', scrollTop: 0 });
    assert.equal(shouldDeferInspectorEmpty(undefined, 'item:box-a', false, false), true);
    assert.equal(shouldDeferInspectorEmpty(undefined, 'item:box-a', false, true), false);
    assert.equal(shouldDeferInspectorEmpty('item:box-a', 'item:box-a', false, false), false);
});

test('temporary zero after a DOM rebuild does not replace the last scroll position', () => {
    assert.equal(rememberedInspectorScroll(420, 0, true, true), 420);
    assert.equal(rememberedInspectorScroll(420, 0, true, false), 420);
    assert.equal(rememberedInspectorScroll(420, 180, true, false), 420);
    assert.equal(rememberedInspectorScroll(420, 180, true, false, true), 180);
    assert.equal(rememberedInspectorScroll(0, 420, false, false), 0);
});

test('blur followed by selecting the same item does not resurrect focus or an old value', () => {
    const focused = { selectionKey: 'item:box-a', scrollTop: 420,
        focusField: 'field:inspector-transform-y', focusPart: 1, inputValue: '200' };
    const blurred = focusForInspectorRender(focused, false, false, false);
    const selected = viewForInspectorSelection(blurred, 'item:box-a', 'item:box-a');
    assert.equal(selected.scrollTop, 420);
    assert.equal(selected.focusField, undefined);
    assert.equal(selected.inputValue, undefined);
    assert.deepEqual(viewForInspectorSelection(selected, 'item:box-b', 'item:box-a'),
        { selectionKey: 'item:box-b', scrollTop: 0 });
});

test('clamp scroll events are ignored through restoration and a later user scroll is remembered', () => {
    assert.equal(inspectorHeldHeight(0, 1023, 1023, 603, 420), 1023);
    assert.equal(inspectorHeldHeight(1023, 603, 603, 603, 420), 1023);
    assert.equal(shouldRememberInspectorScroll(true, 9, 300, 0, 0), false);
    assert.equal(shouldRememberInspectorScroll(false, 67, 300, 0, 0), false);
    assert.equal(shouldRememberInspectorScroll(false, 100, 300, 90, 0), true);
    assert.equal(shouldRememberInspectorScroll(false, 400, 300, 0, 0), true);
});

test('Enter confirmation forgets the old focused field and its draft', () => {
    assert.deepEqual(withoutInspectorFocus({ selectionKey: 'item:a', scrollTop: 420,
        focusField: 'field:inspector-transform-x', focusPart: 1, inputValue: '900' }),
    { selectionKey: 'item:a', scrollTop: 420, focusField: undefined, focusPart: undefined,
        selectionStart: undefined, selectionEnd: undefined, inputValue: undefined });
});

test('one item receives partial live values and commit or cancel clears them', () => {
    const committed = { x: 10, y: 20, rotate: 0 };
    const live = mergeLiveValues(mergeLiveValues(undefined, { id: 'a', values: { x: 14 } }),
        { id: 'a', values: { y: 27 } });
    assert.deepEqual(visibleLiveValues('a', committed, live), { x: 14, y: 27, rotate: 0 });
    assert.deepEqual(visibleLiveValues('b', committed, live), committed);
    assert.deepEqual(visibleLiveValues('a', { x: 14, y: 27, rotate: 0 }), { x: 14, y: 27, rotate: 0 });
    assert.deepEqual(visibleLiveValues('a', committed), committed);
    assert.deepEqual(mergeLiveValues(live, { id: 'b', values: { rotate: 45 } }),
        { id: 'b', values: { rotate: 45 } });
});
