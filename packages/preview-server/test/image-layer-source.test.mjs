import assert from 'node:assert/strict';
import test from 'node:test';

import { isImageLayerSource } from '../../render-cut/src/layers.mjs';

// task 2026-08-10-image-layer-parity 司令塔裁定1: public/app.js の isImageLayerSrc/isImageLayer
// (setupLayers が <img> vs <video> の要素種別を決めるのに使う) は render-cut 側の
// isImageLayerSource (packages/render-cut/src/layers.mjs, plan.mjs の画像判定と同一集合) と
// 完全に同じ拡張子集合で判定しなければならない -- ずれると3面パリティが壊れる。
//
// public/app.js 自身はここから import できない: トップレベルで document.getElementById(...) を
// 大量に呼ぶブラウザ専用スクリプトで、plain `node --test` からは
// "ReferenceError: document is not defined" になる（確認済み）。そのため isImageLayerSrc の
// 正規表現をここに複製する（task の file-boundary 注記が plan.mjs/layers.mjs の組で明示的に
// 許容しているのと同じフォールバック: 「共有できなければ同名ロジックを置き出所をコメント」）。
// 2つめのテストで render-cut の本物の isImageLayerSource と突き合わせ、両者の拡張子集合が
// ずれたらここが赤くなるようにする。
const IMAGE_LAYER_SRC_PATTERN = /\.(png|jpe?g|webp|bmp|gif)$/i;
function isImageLayerSrc(src) {
    return typeof src === 'string' && IMAGE_LAYER_SRC_PATTERN.test(src);
}
function isImageLayer(layer) {
    return layer.kind !== 'baked' && isImageLayerSrc(layer.src);
}

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
