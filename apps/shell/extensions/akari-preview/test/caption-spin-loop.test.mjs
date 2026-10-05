import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { CAPTION_ONE_SHOT_LOOP_IDS as frameIds } from '../../../../../packages/frame-engine/dist/timeline/caption-motion.js';
import { CAPTION_ONE_SHOT_LOOP_IDS as renderIds, buildCaptionAnimation } from '../../../../../packages/render-cut/src/captions.mjs';
import { harness } from './caption-animator-webview-harness.mjs';

const require = createRequire(import.meta.url);
const { PREVIEW_CAPTION_ONE_SHOT_LOOP_IDS: previewIds } = require('../lib/common/caption-text-animation-recipes.js');
const plain = value => JSON.parse(JSON.stringify(value));

test('one-shot loop classification and CSS match in all three layers', () => {
    assert.deepEqual([...frameIds], [...renderIds]);
    assert.deepEqual([...previewIds], [...frameIds]);
    const app = harness();
    for (const id of [...frameIds, 'float', 'heartbeat', 'news-ticker']) {
        for (const loop of [{ id }, { id, duration_sec: 0.8, ease: 'linear' }]) {
            const declaration = { loop };
            const expected = buildCaptionAnimation(declaration, 3);
            app.context.declaration = declaration;
            app.context.duration = 3;
            const actual = app.run('buildPreviewCaptionAnimation(declaration, duration)');
            assert.deepEqual(plain(actual), expected, id);
            if (frameIds.includes(id)) {
                assert.match(actual.animationCss, /0s 1 normal both paused$/u);
                assert.doesNotMatch(actual.animationCss, /infinite/u);
            } else {
                assert.match(actual.animationCss, /infinite both paused$/u);
            }
        }
    }
});
