import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import {
    captionTransform,
    generateResolvedCaptionOverlays
} from '../../../../../packages/render-cut/src/captions.mjs';
import { buildGpuPage } from '../../../../../packages/gpu-export/src/page-builder.mjs';

const require = createRequire(import.meta.url);
const { captionTextStyleVars } = require('../lib/browser/akari-preview-captions.js');
const { resolveCaptionDisplay } = require('../../../../../packages/edit-store/lib/index.js');

const edit = {
    version: 0,
    source: { path: 'source.mp4' },
    cuts: [{ in: 0, out: 2 }],
    output: { width: 320, height: 180, fps: 30 },
    overlays: []
};

const displayPolicy = {
    mode: 'single_line_sequential',
    algorithm: 'a4-ja-two-fragment-v1',
    unit_metric: 'ascii-half-other-one-v1',
    max_line_units: 10,
    minimum_fragment_duration_seconds: 0.1,
    locale: 'ja'
};

function captionRoot(textStyle) {
    return {
        display_policy: displayPolicy,
        captions: [{
            id: 'c-0001', start: 0, end: 2, text: '字幕', speaker: null,
            sourceRef: null, edited: true,
            ...(textStyle ? { text_style: textStyle } : {})
        }]
    };
}

test('caption scale/rotate values match across shell, render-cut, and GPU export', () => {
    const style = { scale: 1.5, rotate: -8 };
    const shellVars = captionTextStyleVars({ scale: style.scale, rotate: style.rotate });
    const resolved = resolveCaptionDisplay(captionRoot(style), edit, { output: edit.output });
    const [renderOverlay] = generateResolvedCaptionOverlays(resolved);
    const gpu = buildGpuPage({
        edit,
        captions: captionRoot(style),
        projectRoot: process.cwd(),
        duration: 2
    });
    const sprite = gpu.spriteManifest.captions[0];

    assert.deepEqual(renderOverlay.transform, captionTransform(style));
    assert.equal(Number(shellVars['--caption-scale']), renderOverlay.transform.scale);
    assert.equal(Number.parseFloat(shellVars['--caption-rotate']), renderOverlay.transform.rotate);
    assert.equal(Number(sprite.vars['--scale']), renderOverlay.transform.scale);
    assert.equal(Number.parseFloat(sprite.vars['--rotate']), renderOverlay.transform.rotate);
    assert.deepEqual(sprite.transform, renderOverlay.transform);

    const defaultShellVars = captionTextStyleVars({ scale: 1, rotate: 0 });
    const defaultResolved = resolveCaptionDisplay(captionRoot(undefined), edit, { output: edit.output });
    const [defaultRenderOverlay] = generateResolvedCaptionOverlays(defaultResolved);
    const defaultGpu = buildGpuPage({
        edit,
        captions: captionRoot(undefined),
        projectRoot: process.cwd(),
        duration: 2
    });
    const defaultSprite = defaultGpu.spriteManifest.captions[0];

    assert.equal(defaultShellVars['--caption-scale'], undefined);
    assert.equal(defaultShellVars['--caption-rotate'], undefined);
    assert.deepEqual(defaultRenderOverlay.transform, { x: 0, y: 0, scale: 1, rotate: 0 });
    assert.deepEqual(defaultSprite.transform, { x: 0, y: 0, scale: 1, rotate: 0 });
    assert.equal(defaultSprite.vars['--scale'], undefined);
    assert.equal(defaultSprite.vars['--rotate'], undefined);
});
