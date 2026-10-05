import assert from 'node:assert/strict';
import test from 'node:test';

import { isImageLayerSource } from '../../render-cut/src/layers.mjs';
import { isImageLayerSrc, isImageLayer, layerPlaybackPath } from '../public/layer-source.js';

// task 2026-08-10-image-layer-parity 司令塔裁定1: public/layer-source.js の isImageLayerSrc/isImageLayer
// (setupLayers が <img> vs <video> の要素種別を決めるのに使う) は render-cut 側の
// isImageLayerSource (packages/render-cut/src/layers.mjs, plan.mjs の画像判定と同一集合) と
// 完全に同じ拡張子集合で判定しなければならない -- ずれると3面パリティが壊れる。
// preview-server の本物の判定を import し、render-cut と突き合わせる。

const IMAGE_EXTENSIONS = ['png', 'PNG', 'jpg', 'JPG', 'jpeg', 'JPEG', 'webp', 'bmp', 'gif', 'GIF'];
const NON_IMAGE_EXTENSIONS = ['mp4', 'mov', 'webm', 'mkv', 'avi'];

test('isImageLayerSrc (preview-server) matches the still-image extension set (png/jpg/jpeg/webp/bmp/gif, case-insensitive) and nothing else', () => {
    for (const ext of IMAGE_EXTENSIONS) {
        assert.equal(isImageLayerSrc(`photo.${ext}`), true, ext);
    }
    for (const ext of NON_IMAGE_EXTENSIONS) {
        assert.equal(isImageLayerSrc(`clip.${ext}`), false, ext);
    }
    assert.equal(isImageLayerSrc(''), false);
    assert.equal(isImageLayerSrc(undefined), false);
});

test('isImageLayerSrc (preview-server) agrees with render-cut isImageLayerSource on every extension (3-surface parity guard)', () => {
    for (const ext of [...IMAGE_EXTENSIONS, ...NON_IMAGE_EXTENSIONS]) {
        const src = `asset.${ext}`;
        assert.equal(
            isImageLayerSrc(src),
            isImageLayerSource(src),
            `preview-server and render-cut disagree on .${ext}`,
        );
    }
});

test('isImageLayer treats "baked" kind as never-image regardless of extension (layerPlaybackPath always proxies baked to .preview.webm)', () => {
    assert.equal(isImageLayer({ kind: 'video', src: 'photo.png' }), true);
    assert.equal(isImageLayer({ kind: 'baked', src: 'photo.png' }), false);
    assert.equal(isImageLayer({ kind: 'video', src: 'clip.mp4' }), false);
    assert.equal(isImageLayer({ kind: 'baked', src: 'matte.mov' }), false);
});

test('layerPlaybackPath uses a preview sidecar for baked layers and keeps video sources', () => {
    assert.equal(layerPlaybackPath({ kind: 'baked', src: 'matte.mov' }), 'matte.preview.webm');
    assert.equal(layerPlaybackPath({ kind: 'baked', src: 'matte' }), 'matte.preview.webm');
    assert.equal(layerPlaybackPath({ kind: 'video', src: 'clip.mov' }), 'clip.mov');
});

import { getVideoSource, isStillImageCutSegment } from '../public/layer-source.js';

// 期待値は移動前の app.js を評価した記録から固定する。
test('getVideoSource resolves cut sources and keeps the original fallback', () => {
    const clips = { clips: [{ id: 'cut-0', src: '/a.mp4' }, { id: 'cut-1', src: '/b.png' }, { id: 'cut-2', src: '/c.JPG' }] };
    const missingCut = { clips: [{ id: 'cut-0', src: '/a.mp4' }, { id: 'cut-2', src: '/c.webp' }] };
    const noFirstSrc = { clips: [{ id: 'cut-5' }, { id: 'cut-0', src: '/x.png' }] };
    const nonString = { clips: [{ id: 'cut-0', src: 123 }, { id: 'cut-1', src: null }] };
    const cases = [
        [[clips, 0], '/a.mp4'],
        [[clips, 1], '/b.png'],
        [[clips, 2], '/c.JPG'],
        [[clips, -1], '/a.mp4'],
        [[clips, 99], '/a.mp4'],
        [[missingCut, 1], '/a.mp4'],
        [[missingCut, 2], '/c.webp'],
        [[{ clips: [] }, 0], ''],
        [[noFirstSrc, 0], '/x.png'],
        [[noFirstSrc, 99], ''],
        [[nonString, 0], 123],
        [[nonString, 1], null],
    ];
    for (const [input, expected] of cases) assert.strictEqual(getVideoSource(...input), expected);
    const failures = [
        [{}, 0, "Cannot read properties of undefined (reading 'find')"],
        [null, 0, "Cannot read properties of null (reading 'clips')"],
    ];
    for (const [timelineData, cutIndex, message] of failures) {
        assert.throws(() => getVideoSource(timelineData, cutIndex), { name: 'TypeError', message });
    }
});

test('isStillImageCutSegment classifies cut sources and short-circuits invalid segments', () => {
    const clips = { clips: [{ id: 'cut-0', src: '/a.mp4' }, { id: 'cut-1', src: '/b.png' }, { id: 'cut-2', src: '/c.JPG' }] };
    const missingCut = { clips: [{ id: 'cut-0', src: '/a.mp4' }, { id: 'cut-2', src: '/c.webp' }] };
    const noFirstSrc = { clips: [{ id: 'cut-5' }, { id: 'cut-0', src: '/x.png' }] };
    const nonString = { clips: [{ id: 'cut-0', src: 123 }, { id: 'cut-1', src: null }] };
    const cases = [
        [[clips, undefined], false],
        [[clips, null], false],
        [[clips, { index: 0, isGap: true }], false],
        [[clips, { index: -1, isGap: false }], false],
        [[clips, { index: 0, isGap: false }], false],
        [[clips, { index: 1, isGap: false }], true],
        [[clips, { index: 2, isGap: false }], true],
        [[clips, { index: 99, isGap: false }], false],
        [[missingCut, { index: 2, isGap: false }], true],
        [[noFirstSrc, { index: 0, isGap: false }], true],
        [[{ clips: [] }, { index: 0, isGap: false }], false],
        [[nonString, { index: 0, isGap: false }], false],
        [[nonString, { index: 1, isGap: false }], false],
        [[{ clips: [{ id: 'cut-0', src: '/media/file.png' }] }, { index: 0, isGap: false }], true],
        [[{ clips: [{ id: 'cut-0', src: '/media/file.JPG' }] }, { index: 0, isGap: false }], true],
        [[{ clips: [{ id: 'cut-0', src: '/media/file.webp' }] }, { index: 0, isGap: false }], true],
        [[{ clips: [{ id: 'cut-0', src: '/media/file.mp4' }] }, { index: 0, isGap: false }], false],
        [[{ clips: [{ id: 'cut-0', src: '/media/file.svg' }] }, { index: 0, isGap: false }], false],
        [[{}, undefined], false],
        [[null, { index: -1, isGap: false }], false],
    ];
    for (const [input, expected] of cases) assert.strictEqual(isStillImageCutSegment(...input), expected);
    const failures = [
        [{}, { index: 0, isGap: false }, "Cannot read properties of undefined (reading 'find')"],
        [null, { index: 0, isGap: false }, "Cannot read properties of null (reading 'clips')"],
    ];
    for (const [timelineData, seg, message] of failures) {
        assert.throws(() => isStillImageCutSegment(timelineData, seg), { name: 'TypeError', message });
    }
});
