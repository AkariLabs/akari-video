import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyPreviewModelUpdate, previewModelUpdateAction } from '../lib/common/preview-model-diff.js';
import { previewTrackedResourceSets, samePageOverlayReferences } from '../lib/common/motion-bag-preview-update.js';

const html = 'file:///project/overlays/title.html';
const bag = 'file:///project/motion/shape-1.json';
const edit = 'file:///project/edit.json';
const base = () => ({
    sourceUris: [], assetUris: [], overlayUris: [html], motionBagUris: [],
    output: { width: 1920, height: 1080, fps: 30 }, overlayRuntimeAssets: ['runtime'],
    captions: [], emphasisWords: [],
    summary: { output: { width: 1920, height: 1080, fps: 30 },
        cuts: [], overlays: [], audio: {}, tracks: {}, timelineTracks: [],
        layers: [{ id: 'shape-1', kind: 'shape', transform: { x: 0 }, keyframes: [] }] }
});

test('袋 URI の追加・中身の更新・削除は差分更新に残る', () => {
    const inline = base();
    const moved = structuredClone(inline);
    moved.overlayUris.push(bag);
    moved.motionBagUris.push(bag);
    moved.summary.layers[0].keyframes = [{ t: 0, transform: { x: 0 } }, { t: 80, transform: { x: 80 } }];
    assert.equal(samePageOverlayReferences(inline, moved), true);
    assert.equal(classifyPreviewModelUpdate(inline, moved), 'incremental');
    assert.equal(previewModelUpdateAction(classifyPreviewModelUpdate(inline, moved), true), 'frame-engine-incremental');

    const changed = structuredClone(moved);
    changed.summary.layers[0].keyframes.push({ t: 100, transform: { x: 100 } });
    assert.equal(classifyPreviewModelUpdate(moved, changed), 'incremental');

    const restored = structuredClone(inline);
    restored.summary.layers[0].keyframes = [{ t: 0, transform: { x: 0 } }];
    assert.equal(samePageOverlayReferences(changed, restored), true);
    assert.equal(classifyPreviewModelUpdate(changed, restored), 'incremental');
});

test('通常の HTML 断片 URI の変更は引き続き再構築する', () => {
    const previous = base();
    previous.overlayUris.push(bag);
    previous.motionBagUris.push(bag);
    for (const overlays of [[], ['file:///project/overlays/new.html'],
        [html, 'file:///project/overlays/new.html']]) {
        const next = structuredClone(previous);
        next.overlayUris = [...overlays, bag];
        assert.equal(samePageOverlayReferences(previous, next), false);
        assert.equal(classifyPreviewModelUpdate(previous, next), 'rebuild');
    }
});

test('差分更新でも追跡集合は袋の新旧参照へ更新できる', () => {
    const uri = value => ({ toString: () => value });
    const suffix = value => '/' + value.toString().split('/').slice(-2).join('/');
    const model = { editUri: uri(edit), overlayUris: [uri(html)], assetUris: [], motionBagUris: [] };
    const first = previewTrackedResourceSets(model, suffix);
    assert.equal(first.akariPreviewTrackedResources.has(bag), false);
    const added = previewTrackedResourceSets({ ...model, overlayUris: [uri(html), uri(bag)],
        motionBagUris: [uri(bag)] }, suffix);
    assert.equal(added.akariPreviewTrackedResources.has(bag), true);
    assert.equal(added.akariPreviewMotionBagResources.has(bag), true);
    assert.equal(added.akariPreviewMotionBagSuffixes.has('/motion/shape-1.json'), true);
    const removed = previewTrackedResourceSets(model, suffix);
    assert.equal(removed.akariPreviewTrackedResources.has(bag), false);
    assert.equal(removed.akariPreviewMotionBagResources.has(bag), false);
});
