import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyPreviewModelUpdate } from '../lib/common/preview-model-diff.js';

const base = () => ({
    sourceUris: ['main=file:///project/source.mp4'],
    assetUris: ['file:///project/layer.mov', 'file:///project/bgm.wav'],
    overlayUris: ['file:///project/overlay.html'],
    output: { width: 1920, height: 1080, fps: 30 },
    overlayRuntimeAssets: ['three', 'three-text', 'three-runtime', 'runtime', 'interaction', 'css', 'kernel', 'font'],
    captions: [{ id: 'c1', start: 0, end: 1, text: 'before' }],
    summary: {
        output: { width: 1920, height: 1080, fps: 30 },
        overlays: [{ id: 'title', html: '<div>title</div>' }],
        indicators: [],
        cuts: [{ src: 'main', in: 0, out: 5, at: 0, track: 0, opacity: 1 }],
        layers: [{ id: 'pip', src: 'stream://layer', kind: 'video', isImage: false, proxyMissing: false,
            t: 0, duration: 5, track: 0, transform: { x: 0, y: 0, scale: 1 }, opacity: 1 }],
        audio: { bgm: { src: 'stream://bgm', gainDb: -8 }, sfx: [], narration: [] },
        tracks: { cuts: [{}], layers: [{}], audio: [{}] },
        timelineTracks: [{ kind: 'cuts', ref: 0 }, { kind: 'layers', ref: 0 }]
    }
});

test('初回だけは全再構築になる', () => {
    assert.equal(classifyPreviewModelUpdate(undefined, base()), 'rebuild');
});

test('同一モデルは更新メッセージも不要になる', () => {
    const model = base();
    assert.equal(classifyPreviewModelUpdate(model, structuredClone(model)), 'none');
});

test('cut/layer の時刻・track・transform・opacity・crop と tracks/audio 配置は差分更新になる', () => {
    const previous = base();
    const next = structuredClone(previous);
    Object.assign(next.summary.cuts[0], { in: 1, out: 7, at: 2, track: 2, opacity: 0.7,
        transform: { x: 20, y: -10, scale: 1.2 } });
    Object.assign(next.summary.layers[0], { t: 3, duration: 2, track: 4, opacity: 0.5,
        transform: { x: 100, y: 40, scale: 0.8 }, crop: { x: 0.1, y: 0.2, w: 0.7, h: 0.6 } });
    next.summary.timelineTracks.reverse();
    next.summary.tracks.layers[0].hidden = true;
    next.summary.audio.bgm.gainDb = -12;
    next.summary.audio.sfx.push({ id: 'hit', src: 'stream://bgm', t: 4, track: 1, gainDb: -3 });
    assert.equal(classifyPreviewModelUpdate(previous, next), 'incremental');
});

test('ソース URI の増減、fps、解像度、overlay runtime 資産は全再構築になる', () => {
    for (const mutate of [
        model => model.sourceUris.push('alt=file:///project/alt.mp4'),
        model => { model.output.fps = 60; },
        model => { model.output.width = 1080; },
        model => { model.overlayRuntimeAssets[3] = 'runtime-v2'; }
    ]) {
        const previous = base();
        const next = structuredClone(previous);
        mutate(next);
        assert.equal(classifyPreviewModelUpdate(previous, next), 'rebuild');
    }
});

test('参照資産、overlay 内容、cut source、layer DOM 構造の変更は全再構築になる', () => {
    for (const mutate of [
        model => model.assetUris.push('file:///project/new.wav'),
        model => { model.summary.overlays[0].html = '<div>changed</div>'; },
        model => { model.captions[0].text = 'after'; },
        model => { model.summary.cuts[0].src = 'alternate'; },
        model => { model.summary.layers[0].id = 'replacement'; }
    ]) {
        const previous = base();
        const next = structuredClone(previous);
        mutate(next);
        assert.equal(classifyPreviewModelUpdate(previous, next), 'rebuild');
    }
});
