import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildCutSummaryFields,
    buildLayerSummaryBase,
    normalizeLayerCropForSummary,
    normalizeLayerKeyframesForSummary,
    normalizeLayerPerspectiveForSummary
} from '../lib/common/edit-summary-fields.js';

// 2026-08-06 field-test bug (shell-summary-field-gap): edit.json's layers[].crop /
// layers[].perspective were correctly rendered by the webview (updateStageScale already
// implements crop pivot / clip-path / matrix3d -- unit-covered by layer-crop-anchor.test.mjs and
// layer-perspective-visual.test.mjs), but never reached the preview summary in the first place:
// EditSummaryLayer didn't declare the fields, and loadPreviewModel's per-layer `base` object
// never read value.crop / value.perspective. Every save -> file watch -> queueRefresh HTML
// rebuild silently reset PiP layers to an uncropped, unperspective-corrected box, even though the
// same edit.json rendered correctly in the Web UI and ffmpeg export.
//
// These tests exercise buildLayerSummaryBase / buildCutSummaryFields -- the exact functions
// akari-preview-open-handler.ts's loadPreviewModel() calls to build the summary it injects into
// the webview -- with a realistic edit.json entry, and assert the crop/perspective/framing/freeze
// fields actually land in the result. This is "wiring" coverage (data reaching the summary), not
// rendering-math coverage: it does not re-derive any CSS transform / matrix3d, only checks that
// the JSON field survives the edit.json -> summary hop.
const noopWarn = () => {};
const identityTransform = value => ({
    x: Number.isFinite(value?.x) ? value.x : 0,
    y: Number.isFinite(value?.y) ? value.y : 0,
    scale: Number.isFinite(value?.scale) && value.scale > 0 ? value.scale : 1,
    rotate: Number.isFinite(value?.rotate) ? value.rotate : 0
});

test('buildLayerSummaryBase: crop and perspective from a realistic edit.json layer reach the summary base', () => {
    const layer = {
        id: 'l-pip-1',
        t: 0,
        duration: 4,
        kind: 'video',
        src: 'assets/webcam.mp4',
        transform: { x: 120, y: -40, scale: 0.4, rotate: 0 },
        crop: { x: 0.1, y: 0.05, w: 0.6, h: 0.7 },
        perspective: { corners: [[0, 0], [1, 0], [0, 1], [1, 1]] }
    };
    const result = buildLayerSummaryBase(layer, 'layers[0]', identityTransform, new Map([['normal', 'normal']]), noopWarn);
    assert.equal(result.ok, true);
    assert.deepEqual(result.base.crop, { x: 0.1, y: 0.05, w: 0.6, h: 0.7 });
    assert.deepEqual(result.base.perspective, { corners: [[0, 0], [1, 0], [0, 1], [1, 1]] });
});

test('buildLayerSummaryBase: a layer with neither crop nor perspective omits both keys (no false defaults leak in)', () => {
    const layer = { id: 'l-plain', t: 0, duration: 2, kind: 'baked', src: 'assets/telop.mov' };
    const result = buildLayerSummaryBase(layer, 'layers[0]', identityTransform, new Map(), noopWarn);
    assert.equal(result.ok, true);
    assert.equal('crop' in result.base, false);
    assert.equal('perspective' in result.base, false);
});

test('buildLayerSummaryBase: an out-of-range crop (x+w>1) is dropped to "no crop" and warns, not written through unnormalized', () => {
    const layer = {
        id: 'l-bad-crop', t: 0, duration: 2, kind: 'video', src: 'assets/webcam.mp4',
        crop: { x: 0.8, y: 0, w: 0.5, h: 1 }
    };
    const warnings = [];
    const result = buildLayerSummaryBase(layer, 'layers[0]', identityTransform, new Map(), (message, detail) => warnings.push({ message, detail }));
    assert.equal(result.ok, true);
    assert.equal('crop' in result.base, false);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0].message, /\.crop を無視しました/);
});

test('buildLayerSummaryBase: a degenerate perspective quad (near-zero area) is dropped and warns', () => {
    const layer = {
        id: 'l-bad-persp', t: 0, duration: 2, kind: 'video', src: 'assets/webcam.mp4',
        perspective: { corners: [[0.5, 0.5], [0.5, 0.5], [0.5, 0.5], [0.5, 0.5]] }
    };
    const warnings = [];
    const result = buildLayerSummaryBase(layer, 'layers[0]', identityTransform, new Map(), (message, detail) => warnings.push({ message, detail }));
    assert.equal(result.ok, true);
    assert.equal('perspective' in result.base, false);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0].message, /\.perspective を無視しました/);
});

test('buildLayerSummaryBase: still rejects a structurally invalid layer (unrelated to crop/perspective)', () => {
    const result = buildLayerSummaryBase({ t: 0, duration: 2, kind: 'video', src: 'x.mp4' }, 'layers[0]', identityTransform, new Map(), noopWarn);
    assert.equal(result.ok, false);
});

// contract-2026-08-09-transform-keyframes-v0.md. Same "silently reset to the un-animated state on
// every save -> file watch -> queueRefresh rebuild" bug class the 2026-08-06 header comment above
// describes for crop/perspective -- this is the regression test for keyframes specifically (the
// task brief's own "落とし穴": schema support alone does not reach the webview).
test('buildLayerSummaryBase: keyframes from a realistic edit.json layer reach the summary base', () => {
    const layer = {
        id: 'l-pip-1',
        t: 0,
        duration: 4,
        kind: 'video',
        src: 'assets/webcam.mp4',
        keyframes: [
            { t: 0, transform: { scale: 0.4 } },
            { t: 2, transform: { scale: 0.6 }, easing: 'ease-in-out' },
            { t: 4, crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } }
        ]
    };
    const result = buildLayerSummaryBase(layer, 'layers[0]', identityTransform, new Map(), noopWarn);
    assert.equal(result.ok, true);
    assert.deepEqual(result.base.keyframes, layer.keyframes);
});

test('buildLayerSummaryBase: a layer without keyframes omits the key (no false defaults leak in)', () => {
    const layer = { id: 'l-plain', t: 0, duration: 2, kind: 'baked', src: 'assets/telop.mov' };
    const result = buildLayerSummaryBase(layer, 'layers[0]', identityTransform, new Map(), noopWarn);
    assert.equal(result.ok, true);
    assert.equal('keyframes' in result.base, false);
});

test('buildLayerSummaryBase: keyframes with fewer than 2 usable points is dropped and warns', () => {
    const layer = {
        id: 'l-bad-kf', t: 0, duration: 2, kind: 'video', src: 'assets/webcam.mp4',
        keyframes: [{ t: 0, transform: { scale: 1 } }]
    };
    const warnings = [];
    const result = buildLayerSummaryBase(layer, 'layers[0]', identityTransform, new Map(), (message, detail) => warnings.push({ message, detail }));
    assert.equal(result.ok, true);
    assert.equal('keyframes' in result.base, false);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0].message, /\.keyframes を無視しました/);
});

test('normalizeLayerKeyframesForSummary: a non-array is rejected', () => {
    assert.equal(normalizeLayerKeyframesForSummary({ t: 0 }), undefined);
});

test('normalizeLayerKeyframesForSummary: 2 usable points pass through verbatim (deep per-point validation deferred to computeLayerKeyframesVisual)', () => {
    const keyframes = [{ t: 0, transform: { scale: 1 } }, { t: 1, transform: { scale: 2 } }];
    assert.equal(normalizeLayerKeyframesForSummary(keyframes), keyframes);
});

test('normalizeLayerCropForSummary: boundary values (full-frame crop) are accepted', () => {
    assert.deepEqual(normalizeLayerCropForSummary({ x: 0, y: 0, w: 1, h: 1 }), { x: 0, y: 0, w: 1, h: 1 });
});

test('normalizeLayerCropForSummary: w=0 (empty crop) is rejected (exclusiveMinimum per #/$defs/layerCrop)', () => {
    assert.equal(normalizeLayerCropForSummary({ x: 0, y: 0, w: 0, h: 1 }), undefined);
});

test('normalizeLayerPerspectiveForSummary: wrong corner count is rejected', () => {
    assert.equal(normalizeLayerPerspectiveForSummary({ corners: [[0, 0], [1, 0], [1, 1]] }), undefined);
});

test('buildCutSummaryFields: framing and freeze from a realistic edit.json cut reach the summary fields', () => {
    const cut = {
        src: 'main',
        in: 2,
        out: 8,
        framing: { crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } },
        freeze: { at_sec: 3, duration_sec: 1.5 }
    };
    const result = buildCutSummaryFields(cut, 'main', id => id === 'main', identityTransform, noopWarn);
    assert.equal(result.ok, true);
    assert.deepEqual(result.fields.framing, { crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } });
    assert.deepEqual(result.fields.freeze, { at_sec: 3, duration_sec: 1.5 });
});

test('buildCutSummaryFields: cut-level crop, perspective, and keyframes reach the summary fields', () => {
    const cut = {
        src: 'main',
        in: 0,
        out: 4,
        transform: { x: 12, y: -8, scale: 0.75, rotate: 3 },
        crop: { x: 0.1, y: 0.2, w: 0.7, h: 0.6 },
        perspective: { corners: [[0.05, 0], [0.95, 0.1], [0, 1], [1, 0.9]] },
        keyframes: [
            { t: 0, transform: { x: 0, scale: 0.75 }, crop: { x: 0.1, y: 0.2, w: 0.7, h: 0.6 } },
            { t: 2, transform: { x: 100, scale: 1 }, crop: { x: 0.2, y: 0.1, w: 0.6, h: 0.8 } },
            { t: 4, transform: { x: 200, scale: 1.25 }, crop: { x: 0.3, y: 0, w: 0.5, h: 1 } }
        ]
    };
    const result = buildCutSummaryFields(cut, 'main', id => id === 'main', identityTransform, noopWarn);
    assert.equal(result.ok, true);
    assert.deepEqual(result.fields.crop, cut.crop);
    assert.deepEqual(result.fields.perspective, cut.perspective);
    assert.equal(result.fields.keyframes, cut.keyframes);
});

test('buildCutSummaryFields: invalid cut-level layer-style fields are omitted and warned', () => {
    const warnings = [];
    const result = buildCutSummaryFields({
        src: 'main', in: 0, out: 2,
        crop: { x: 0.8, y: 0, w: 0.5, h: 1 },
        perspective: { corners: [[0.5, 0.5], [0.5, 0.5], [0.5, 0.5], [0.5, 0.5]] },
        keyframes: [{ t: 0, transform: { x: 0 } }]
    }, 'main', id => id === 'main', identityTransform, (message, detail) => warnings.push({ message, detail }));
    assert.equal(result.ok, true);
    assert.equal('crop' in result.fields, false);
    assert.equal('perspective' in result.fields, false);
    assert.equal('keyframes' in result.fields, false);
    assert.deepEqual(warnings.map(({ message }) => message.match(/cut\.(crop|perspective|keyframes)/)?.[1]), [
        'crop', 'perspective', 'keyframes'
    ]);
});

test('buildCutSummaryFields: unknown cut.src falls back to the primary source and flags unresolvedSrc', () => {
    const cut = { src: 'ghost', in: 0, out: 1 };
    const result = buildCutSummaryFields(cut, 'main', id => id === 'main', identityTransform, noopWarn);
    assert.equal(result.ok, true);
    assert.equal(result.fields.src, 'main');
    assert.equal(result.unresolvedSrc, true);
});

test('buildCutSummaryFields: invalid in/out is rejected', () => {
    const result = buildCutSummaryFields({ src: 'main', in: 5, out: 5 }, 'main', () => true, identityTransform, noopWarn);
    assert.equal(result.ok, false);
});

test('buildCutSummaryFields: schema のトランジション 5 種をすべて summary へ保持する', () => {
    for (const type of ['dissolve', 'fade-black', 'fade-white', 'reveal-down', 'reveal-up']) {
        const result = buildCutSummaryFields({
            src: 'main', in: 0, out: 2, transition_out: { type, duration: 0.5 }
        }, 'main', id => id === 'main', identityTransform, noopWarn);
        assert.equal(result.ok, true, type);
        assert.deepEqual(result.fields.transitionOut, { type, duration: 0.5 });
    }
});

// End-to-end shape test mirroring loadPreviewModel's actual loop: given a small edit.json-like
// object, run every layers[]/cuts[] entry through the same builder functions the extension calls,
// and assert the resulting summary carries every field the webview reads for PiP display.
test('a realistic edit.json (2 PiP layers with crop+perspective, 1 cut with framing+freeze) round-trips into summary-shaped arrays', () => {
    const edit = {
        layers: [
            {
                id: 'l-1', t: 0, duration: 5, kind: 'video', src: 'assets/cam-a.mp4',
                transform: { x: 400, y: -300, scale: 0.3 },
                crop: { x: 0.2, y: 0, w: 0.6, h: 1 },
                perspective: { corners: [[0, 0.1], [1, 0], [0, 1], [0.9, 0.9]] }
            },
            {
                id: 'l-2', t: 0, duration: 5, kind: 'baked', src: 'assets/telop.mov'
            }
        ],
        cuts: [
            { src: 'main', in: 0, out: 10, framing: { keyframes: [{ t: 0, crop: { x: 0, y: 0, w: 1, h: 1 } }, { t: 10, crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } }] }, freeze: { at_sec: 4, duration_sec: 2 } }
        ]
    };

    const layers = edit.layers
        .map((value, index) => buildLayerSummaryBase(value, `layers[${index}]`, identityTransform, new Map([['normal', 'normal']]), noopWarn))
        .filter(result => result.ok)
        .map(result => result.base);
    const cuts = edit.cuts
        .map(value => buildCutSummaryFields(value, 'main', id => id === 'main', identityTransform, noopWarn))
        .filter(result => result.ok)
        .map(result => result.fields);

    assert.equal(layers.length, 2);
    assert.deepEqual(layers[0].crop, { x: 0.2, y: 0, w: 0.6, h: 1 });
    assert.deepEqual(layers[0].perspective, { corners: [[0, 0.1], [1, 0], [0, 1], [0.9, 0.9]] });
    assert.equal('crop' in layers[1], false);
    assert.equal('perspective' in layers[1], false);

    assert.equal(cuts.length, 1);
    assert.ok(cuts[0].framing);
    assert.equal(cuts[0].framing.keyframes.length, 2);
    assert.deepEqual(cuts[0].freeze, { at_sec: 4, duration_sec: 2 });
});
