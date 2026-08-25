import assert from 'node:assert/strict';
import test from 'node:test';

import { isImageLayerSource } from '../../../../../packages/render-cut/src/layers.mjs';
import { isStillImageSourcePath } from '../../../../../packages/edit-store/lib/index.js';

// task 2026-08-10-image-layer-parity 司令塔裁定1: akari-preview-open-handler.ts の
// isImageLayerSrc (module-scope export, defined right above the EditSummaryLayer interface) picks
// <img> vs <video> element creation by src extension, and MUST use the exact same extension set as
// render-cut's isImageLayerSource (packages/render-cut/src/layers.mjs, mirrored from plan.mjs's
// chroma_key background image detection) -- otherwise the 3 surfaces disagree on what counts as an
// image and the whole point of this task (parity) breaks.
//
// akari-preview-open-handler.ts itself cannot be imported here: it's a @theia/core
// FrontendApplicationContribution, and even just importing the compiled module pulls in
// @lumino/domutils, which touches `document` at module-load time and throws
// "ReferenceError: document is not defined" under plain `node --test` (confirmed empirically while
// writing this test). So isImageLayerSrc's regex is duplicated here verbatim (same fallback the
// task's own file-boundary note authorizes for the plan.mjs/layers.mjs pair: "共有できなければ
// 同名ロジックを置き出所をコメント") -- and the second test below cross-checks it against
// render-cut's real, live isImageLayerSource so a drift between the two surfaces' extension sets
// fails loudly here instead of silently at render time.
const IMAGE_LAYER_SRC_PATTERN = /\.(png|jpe?g|webp|bmp|gif)$/i;
const isImageLayerSrc = src => typeof src === 'string' && IMAGE_LAYER_SRC_PATTERN.test(src);

const IMAGE_EXTENSIONS = ['png', 'PNG', 'jpg', 'JPG', 'jpeg', 'JPEG', 'webp', 'bmp', 'gif', 'GIF'];
const NON_IMAGE_EXTENSIONS = ['mp4', 'mov', 'webm', 'mkv', 'avi'];

test('isImageLayerSrc (akari-preview) matches the still-image extension set (png/jpg/jpeg/webp/bmp/gif, case-insensitive) and nothing else', () => {
    for (const ext of IMAGE_EXTENSIONS) {
        assert.equal(isImageLayerSrc(`photo.${ext}`), true, ext);
    }
    for (const ext of NON_IMAGE_EXTENSIONS) {
        assert.equal(isImageLayerSrc(`clip.${ext}`), false, ext);
    }
    assert.equal(isImageLayerSrc(''), false);
    assert.equal(isImageLayerSrc(undefined), false);
});

test('isImageLayerSrc (akari-preview) agrees with render-cut isImageLayerSource on every extension (3-surface parity guard)', () => {
    for (const ext of [...IMAGE_EXTENSIONS, ...NON_IMAGE_EXTENSIONS]) {
        const src = `asset.${ext}`;
        assert.equal(
            isImageLayerSrc(src),
            isImageLayerSource(src),
            `akari-preview and render-cut disagree on .${ext}`,
        );
        assert.equal(
            isImageLayerSrc(src),
            isStillImageSourcePath(src),
            `akari-preview and edit-store disagree on .${ext}`,
        );
    }
});
