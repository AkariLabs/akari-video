import assert from 'node:assert/strict';
import test from 'node:test';
import { timelineMethod } from './helpers/perspective-transition-fixture.mjs';
import { updateTreeV2Item } from '../lib/common/edit-v2-mutations.js';
import { readInspectorAdjustSnapshot } from '../lib/browser/inspector/adjust-fields.js';
import { maskSourceOptionsForSources } from '../lib/browser/inspector/mask-fields.js';
import { legacyTransformOpFor } from '../lib/browser/inspector/field-mappings.js';
import { isCutFramingWriteRequest } from '../lib/browser/inspector/framing-fields.js';
import { isCutFreezeWriteRequest } from '../lib/browser/inspector/freeze-fields.js';
import { validateInspectorMotion } from '../lib/browser/inspector/motion-fields.js';

const animators = [{
    id: 'a1', basis: 'chars', shape: 'ramp', start: 0, end: 0.3, offset: 0, amount: { y: 24 }
}];
const treeSnapshot = timelineMethod('treeItemSnapshot', { readInspectorAdjustSnapshot, maskSourceOptionsForSources });
const handleWrite = timelineMethod('handleInspectorWriteV2', {
    updateTreeV2Item, legacyTransformOpFor, isCutFramingWriteRequest, isCutFreezeWriteRequest, validateInspectorMotion
});

test('tree snapshot は HTML を含め animator 配列だけを写し、非配列・未設定のキーを省略する', () => {
    for (const kind of ['captions', 'caption', 'html']) {
        const raw = { id: 'visual-1', at: 0, duration: 48, source: { kind } };
        const state = {
            fps: 24, sourceMap: new Map(), expandedTimelineTreeRows: [],
            trackDisplayNameForItem: () => 'Video'
        };
        const snapshot = () => treeSnapshot.call(state, {
            kind: 'item', id: raw.id, itemKind: kind === 'html' ? 'part' : kind, trackId: 'video'
        }, raw);
        assert.equal(Object.hasOwn(snapshot(), 'animator'), false);
        for (const value of [animators, []]) {
            raw.animator = value;
            assert.equal(Object.hasOwn(snapshot(), 'animator'), true);
            assert.deepEqual(snapshot().animator, value);
        }
        for (const value of [undefined, null, {}, 'bad', 1, false]) {
            raw.animator = value;
            assert.equal(Object.hasOwn(snapshot(), 'animator'), false);
        }
    }
});

test('書き込みブリッジは HTML を含め animator 配列を保存し、null でキーを削除する', async () => {
    for (const kind of ['captions', 'caption', 'html']) {
        const state = {
            commits: 0, editDocument: { version: 2, tracks: [{ id: 'video', lane: 'visual', items: [{
                id: 'visual-1', at: 0, duration: 150, source: { kind }
            }] }] },
            rawKeyframeItem() { return this.editDocument.tracks[0].items[0]; },
            async commitEditMutation(label, mutate) { this.label = label; this.editDocument = mutate(this.editDocument); this.commits++; },
            hideNotice() {}, showNotice() {}, footer: {}, errorMessage: error => error.message
        };
        const request = { kind: 'item-field', id: 'visual-1', path: 'animator', value: animators };
        assert.deepEqual(await handleWrite.call(state, request), { ok: true });
        assert.deepEqual(state.rawKeyframeItem().animator, animators);
        assert.equal(state.label, 'クリップのアニメーターを変更');
        assert.deepEqual(await handleWrite.call(state, { ...request, value: null }), { ok: true });
        assert.equal(Object.hasOwn(state.rawKeyframeItem(), 'animator'), false);
        assert.equal(state.label, 'クリップのアニメーターを変更');
        assert.equal(state.commits, 2);
    }
});
