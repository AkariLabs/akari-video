import assert from 'node:assert/strict';
import test from 'node:test';
import { barItems, parseContextBarState, photoToolsAvailableFor } from '../lib/common/context-bar-view.js';

const keys = state => barItems(state).filter(item => item.kind !== 'separator').map(item => item.key);
const photo = available => parseContextBarState({
    editUri: 'file:///fixture/edit.json', selectedId: 'photo-1', kind: 'photo',
    item: { source: { kind: 'media', src: 'still.png' } }, sourcePath: 'still.png',
    parentId: null, locked: false, hasCorners: false, multi: 0, styleCopy: null,
    output: { width: 1920, height: 1080 }, lockedIds: [], photoToolsAvailable: available
});

test('写真は写真用の項目を保ち、空の枠・生成中は共通項目だけを出す', () => {
    const normal = keys(photo(true));
    assert.ok(['edit', 'cutout', 'eraser', 'photoColor', 'crop'].every(key => normal.includes(key)));
    assert.deepEqual(keys(photo(false)), ['opacity', 'anim', 'arrange', 'style']);
    for (const state of ['planned', 'generating', 'stale', 'failed']) {
        assert.equal(photoToolsAvailableFor({ generationState: state }), false, state);
    }
    assert.equal(photoToolsAvailableFor({ emptyFrame: true }), false);
    assert.equal(photoToolsAvailableFor({ generationState: 'done' }), true);
    assert.equal(photoToolsAvailableFor({}), true);
});
