import assert from 'node:assert/strict';
import test from 'node:test';
import {
    isMaskCandidatePath, maskSourceOptionsForSources, maskOptionLabels,
    maskOptionLabel, maskSourceIdForLabel, createMaskWriteRequest
} from '../lib/browser/inspector/mask-fields.js';
import { updateTreeV2Item } from '../lib/common/edit-v2-mutations.js';
import { readInspectorAdjustSnapshot } from '../lib/browser/inspector/adjust-fields.js';
import { layerSnapshotChromaKey, legacyTransformOpFor } from '../lib/browser/inspector/field-mappings.js';
import { isCutFramingWriteRequest } from '../lib/browser/inspector/framing-fields.js';
import { isCutFreezeWriteRequest } from '../lib/browser/inspector/freeze-fields.js';
import { layerSections, itemSections, timelineMethod, visualSnapshot } from './helpers/perspective-transition-fixture.mjs';

const sources = new Map([
    ['main', { path: 'assets/main.mp4' }],
    ['maskgrad', { path: 'assets/mask.mp4' }],
    ['still', { path: 'assets/card.png' }],
    ['audio', { path: 'assets/music.mp3' }]
]);
const options = maskSourceOptionsForSources(sources);

test('mask 候補は動画拡張子だけを抽出し、ファイル名と source id を保持する', () => {
    for (const extension of ['mp4', 'mov', 'webm', 'm4v', 'mkv']) {
        assert.equal(isMaskCandidatePath(`assets/マスク.${extension}`), true);
        assert.equal(isMaskCandidatePath(`assets/mask.${extension.toUpperCase()}`), true);
    }
    for (const path of ['card.png', 'card.jpg', 'music.wav', 'clip.mp4.html', 'mp4', 'folder.mp4/image.png']) {
        assert.equal(isMaskCandidatePath(path), false, path);
    }
    assert.deepEqual(options, [{ id: 'main', label: 'main.mp4' }, { id: 'maskgrad', label: 'mask.mp4' }]);
    assert.deepEqual(maskSourceOptionsForSources(new Map([['mask', { path: 'assets\\mask.MOV' }]])),
        [{ id: 'mask', label: 'mask.MOV' }]);
});

test('mask 同名ファイルは id 付きラベルで一意になり正しい id に戻る', () => {
    const duplicates = [
        { id: 'a', label: 'mask.mp4' }, { id: 'b', label: 'mask.mp4' },
        { id: 'c', label: 'mask.mp4 (a)' }, { id: 'd', label: 'なし' }
    ];
    const labels = maskOptionLabels(duplicates);
    assert.equal(new Set(labels).size, labels.length);
    assert.equal(labels[1], 'mask.mp4 (a)');
    assert.equal(labels[2], 'mask.mp4 (b)');
    duplicates.forEach((option, index) => {
        assert.equal(maskSourceIdForLabel(duplicates, labels[index + 1]), option.id);
        assert.equal(maskOptionLabel(duplicates, option.id), labels[index + 1]);
    });
});

test('mask「なし」は null、不明ラベルは拒否し、不明 id の表示は保持する', () => {
    assert.deepEqual(maskOptionLabels([]), ['なし']);
    assert.equal(maskSourceIdForLabel(options, 'なし'), null);
    assert.equal(maskOptionLabel(options, undefined), 'なし');
    assert.equal(maskOptionLabel(options, 'missing'), 'missing');
    assert.throws(() => maskSourceIdForLabel(options, 'missing'));
    assert.throws(() => createMaskWriteRequest(visualSnapshot(), 'なし'), /media item/);
});

test('layer / item の mask 行は label を id / null のリクエストに変換する', async () => {
    for (const [kind, factory] of [['layer', layerSections], ['item', itemSections]]) {
        const snapshot = visualSnapshot(kind, { mask: 'maskgrad', maskSourceOptions: options });
        const requests = [];
        const row = factory(snapshot, async request => { requests.push(request); return { ok: true }; })
            .find(section => section.id === 'appearance').fields.at(-1);
        assert.equal(row.getValue(snapshot), 'mask.mp4');
        assert.equal(row.getEditValue(snapshot), 'mask.mp4');
        assert.deepEqual(await row.write(snapshot, 'mask.mp4'), { ok: true });
        assert.deepEqual(await row.write(snapshot, 'なし'), { ok: true });
        await row.reset(snapshot);
        assert.deepEqual(requests, ['maskgrad', null, null].map(value => ({
            kind: 'item-field', id: snapshot.id, path: 'mask', value
        })));
    }
});

test('mask が sources に無い場合も raw id を select に表示し、未知の選択は保存しない', async () => {
    for (const factory of [layerSections, itemSections]) {
        const snapshot = visualSnapshot('layer', { mask: 'missing', maskSourceOptions: options });
        const row = factory(snapshot, async () => assert.fail('unknown write'))
            .find(section => section.id === 'appearance').fields.at(-1);
        assert.equal(row.getValue(snapshot), 'missing');
        assert.equal(row.options.at(-1), 'missing');
        assert.equal((await row.write(snapshot, 'missing')).ok, false);
    }
});

const handleWrite = timelineMethod('handleInspectorWriteV2', {
    updateTreeV2Item, legacyTransformOpFor, isCutFramingWriteRequest, isCutFreezeWriteRequest
});
function context(source = { kind: 'media', src: 'main' }) {
    return {
        sourceMap: sources, commits: 0,
        editDocument: { version: 2, sources: Array.from(sources, ([id, value]) => ({ id, path: value.path })),
            tracks: [{ id: 'video', lane: 'visual', items: [{
                id: 'visual-1', at: 0, duration: 150, source
            }] }] },
        rawKeyframeItem() { return this.editDocument.tracks[0].items[0]; },
        async commitEditMutation(label, mutate) {
            this.label = label; this.editDocument = mutate(this.editDocument); this.commits++;
        },
        hideNotice() {}, showNotice() {}, footer: {}, errorMessage: error => error.message
    };
}
const request = { kind: 'item-field', id: 'visual-1', path: 'mask', value: 'maskgrad' };

test('mask 保存と「なし」は動画・静止画どちらでも item 直下のキーを追加・削除する', async () => {
    for (const src of ['main', 'still']) {
        const state = context({ kind: 'media', src });
        const originalSource = structuredClone(state.rawKeyframeItem().source);
        assert.deepEqual(await handleWrite.call(state, request), { ok: true });
        assert.equal(state.rawKeyframeItem().mask, 'maskgrad');
        assert.equal(state.label, 'クリップのマスクを変更');
        assert.deepEqual(await handleWrite.call(state, { ...request, value: null }), { ok: true });
        assert.equal(Object.hasOwn(state.rawKeyframeItem(), 'mask'), false);
        assert.deepEqual(state.rawKeyframeItem().source, originalSource);
        assert.equal(state.commits, 2);
    }
});

test('mask sources に無い id と不正な値は保存前に拒否する', async () => {
    const state = context();
    assert.deepEqual(await handleWrite.call(state, { ...request, value: 'missing' }), {
        ok: false, message: 'sources に無い id です'
    });
    for (const value of [23, {}, undefined]) assert.equal((await handleWrite.call(state, { ...request, value })).ok, false);
    assert.equal(state.commits, 0);
});

test('mask は自分自身のソースを選べる', async () => {
    const state = context();
    assert.deepEqual(await handleWrite.call(state, { ...request, value: 'main' }), { ok: true });
    assert.equal(state.rawKeyframeItem().mask, 'main');
});

test('mask は media 以外と legacy 文書への書き込みを拒否する', async () => {
    for (const kind of ['telop', 'html', 'group']) {
        const state = context({ kind });
        assert.equal((await handleWrite.call(state, request)).ok, false);
        assert.equal(state.commits, 0);
    }
    assert.deepEqual(await handleWrite.call({ legacyReadOnly: true, cutItemIds: [] }, request), {
        ok: false, message: 'この項目の編集は edit.json v2 のみ対応です。'
    });
});

const treeSnapshot = timelineMethod('treeItemSnapshot', { readInspectorAdjustSnapshot, maskSourceOptionsForSources });
const layerSnapshot = timelineMethod('snapshotForSelection', {
    readInspectorAdjustSnapshot, maskSourceOptionsForSources, layerSnapshotChromaKey,
    resolveTimelineClipName: item => item.id
});
test('layer / tree snapshot は raw media item だけに mask と動画候補を載せる', () => {
    for (const kind of ['media', 'telop', 'html', 'group']) {
        const raw = { id: 'visual-1', at: 0, duration: 150, mask: 'maskgrad', source: { kind, src: 'still' } };
        const state = {
            sourceMap: sources, fps: 30, expandedTimelineTreeRows: [],
            layers: [{ id: raw.id, kind: 'video', t: 0, duration: 5 }],
            rawV2Item: () => raw, rawKeyframeItem: () => raw, trackDisplayNameForItem: () => 'Video'
        };
        const snapshots = [
            treeSnapshot.call(state, { kind: 'item', id: raw.id, itemKind: kind, trackId: 'video' }, raw),
            layerSnapshot.call(state, { kind: 'layer', id: raw.id })
        ];
        for (const snapshot of snapshots) {
            assert.equal(Object.hasOwn(snapshot, 'mask'), kind === 'media');
            assert.equal(Object.hasOwn(snapshot, 'maskSourceOptions'), kind === 'media');
            if (kind === 'media') {
                assert.equal(snapshot.mask, 'maskgrad');
                assert.deepEqual(snapshot.maskSourceOptions, options);
            }
        }
    }
});
