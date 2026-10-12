import assert from 'node:assert/strict';
import test from 'node:test';
import { readCompiledSource } from './helpers/widget-source.mjs';

const compiled = readCompiledSource('widget').text;
const start = compiled.indexOf('    contextBarSource() {');
const end = compiled.indexOf('    setPendingPreviewKeyframes(', start);
assert.ok(start >= 0 && end > start);
const Widget = new Function('caption_context_edit_1', 'caption_store_1',
    `return class Widget { ${compiled.slice(start, end)} }`)(
    { contextCaptionId: () => undefined }, { mergeCaptionTextStyles: () => undefined });

function context(selection, pendingPreviewKeyframes) {
    return Object.assign(new Widget(), {
        location: { editUri: { toString: () => 'file:///project/edit.json' } },
        editDocument: { version: 2 },
        multiSelection: [], selection, selectionModel: { snapshot: undefined },
        captions: [], fps: 30, playheadT: 0, sourceMap: new Map(),
        pendingPreviewKeyframes
    });
}

test('contextBarSource returns no pending groups when selection and pending data are absent', () => {
    assert.deepEqual(context(undefined, undefined).contextBarSource().pendingKeyframeGroups, []);
});

test('contextBarSource returns pending groups for the matching selected item', () => {
    const groups = [{ property: 'transform', points: [] }];
    const result = context({ kind: 'layer', id: 'clip-1' }, { itemId: 'clip-1', groups }).contextBarSource();
    assert.equal(result.pendingKeyframeGroups, groups);
});

test('contextBarSource omits pending groups without the matching selection', () => {
    const pending = { itemId: 'clip-1', groups: [{ property: 'transform', points: [] }] };
    assert.deepEqual(context(undefined, pending).contextBarSource().pendingKeyframeGroups, []);
    assert.deepEqual(context({ kind: 'layer', id: 'clip-2' }, pending).contextBarSource().pendingKeyframeGroups, []);
});
