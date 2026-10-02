import assert from 'node:assert/strict';
import test from 'node:test';

import { isImageLayerSource } from '../../render-cut/src/layers.mjs';
import { isImageLayerSrc, isImageLayer } from '../public/layer-source.js';

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
