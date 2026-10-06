import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { captionAxisPlacement, captionZonePlacement, parseCaptionInspectorPositionAction } from '../lib/common/caption-position-preset.js';
import { roundedCaptionStrokeShadows } from '../lib/common/caption-rounded-stroke.js';
import { CAPTION_FONT_SIZE_MAX, clampCaptionFontSize } from '../lib/common/caption-size-limit.js';
import { captionWrapFitPosition, captionWrapFitWidth } from '../lib/common/caption-wrap-fit.js';
import { updateCaptionTransformSource, persistCaptionPlateTransform } from '../lib/common/caption-plate-handles.js';
import { clearCaptionSideActions } from '../lib/common/caption-action-clearance.js';
import { placedCaptionPositionFromRects } from '../lib/common/caption-zone-write.js';
import { roundedCaptionStrokeShadows as exportStroke } from '../../../../../packages/render-cut/src/captions.mjs';
const require = createRequire(import.meta.url);
const { isCaptionWriteRequest } = require('../lib/browser/preview-host-message-guards.js');

test('outline shadows have a round radius equal to the old stroke outward half-width', () => {
    const preview = roundedCaptionStrokeShadows('16px #000000');
    assert.equal(preview, exportStroke('16px #000000'));
    const offsets = preview.split(',').map(entry => entry.match(/^(-?[\d.]+)px (-?[\d.]+)px/u).slice(1).map(Number));
    assert.equal(offsets.length, 32);
    assert.ok(offsets.every(([x, y]) => Math.abs(Math.hypot(x, y) - 8) < .001));
    assert.equal(roundedCaptionStrokeShadows('0px #000000'), null);
});

test('zone, axis, and inspector actions share frame-relative positions', () => {
    assert.deepEqual(parseCaptionInspectorPositionAction('cue:c-0005:zone:bottom'),
        { captionId: 'c-0005', kind: 'zone', zone: 'bottom' });
    assert.equal(parseCaptionInspectorPositionAction('cue:c-0005:x:101'), null);
    assert.deepEqual(captionZonePlacement('bottom', { width: 320, height: 64 }, { width: 1280, height: 720 }),
        { anchor: 'tl', position: { x: .375, y: .8411 } });
    assert.deepEqual(captionAxisPlacement('x', 40, { x: .375, y: .8411 }),
        { anchor: 'tl', position: { x: .4, y: .8411 } });
    assert.deepEqual(captionAxisPlacement('y', 94, { x: .15, y: .93 }, 'bc'),
        { anchor: 'bc', position: { x: .15, y: .94 } });
});

test('drag retains the pointer offset and maps 100 screen pixels to the same text displacement', () => {
    const frame = { x: 0, y: 0, width: 1280, height: 720 };
    const plate = { left: 400, right: 720, top: 530, bottom: 594 };
    const start = placedCaptionPositionFromRects(plate, frame, { anchor: 'tl', clamp: false });
    const moved = placedCaptionPositionFromRects({ ...plate, left: 500, right: 820 }, frame,
        { anchor: 'tl', clamp: false });
    assert.equal(Math.round((moved.position.x - start.position.x) * frame.width), 100);
    assert.equal(moved.position.y, start.position.y);
});

test('size control reaches above the previous limit and clamps at a finite maximum', () => {
    assert.ok(CAPTION_FONT_SIZE_MAX > 160);
    assert.equal(clampCaptionFontSize(162), 162);
    assert.equal(clampCaptionFontSize(999), CAPTION_FONT_SIZE_MAX);
    assert.equal(clampCaptionFontSize(-4), 1);
});

test('fit width includes padding and compensates the ink position', () => {
    const fit = captionWrapFitWidth(320, 20, 1280);
    assert.deepEqual(fit, { widthPx: 340, widthPct: 26.56 });
    assert.deepEqual(captionWrapFitPosition({ left: 400, top: 530 },
        { x: 510, y: 540 }, { x: 435, y: 540 }), { left: 475, top: 530 });
    assert.deepEqual(captionWrapFitWidth(320, 0, 1280), { widthPx: 320, widthPct: 25 });
});

test('background-free fit saves zero padding, width, and position in one document write', async () => {
    const patch = { plateTransform: { captionIds: ['c-0005'], wrapWidthPct: 25,
        backgroundPaddingPx: 0, cuePosition: { captionId: 'c-0005',
            value: { anchor: 'tl', position: { x: .4, y: .5 } } } } };
    assert.equal(isCaptionWriteRequest({ type: 'akari-preview-caption-write', requestId: 'fit',
        captionId: 'c-0005', patch }), true);
    assert.equal(isCaptionWriteRequest({ type: 'akari-preview-caption-write', requestId: 'fit',
        captionId: 'c-0005', patch: { plateTransform: { ...patch.plateTransform, backgroundPaddingPx: 1 } } }), false);
    const source = JSON.stringify({ captions: [{ id: 'c-0005', text_style: { wrap_width_pct: 70 } }] });
    let writes = 0, written;
    const result = await persistCaptionPlateTransform({ source, captionIds: ['c-0005'],
        patch: { wrapWidthPct: 25, backgroundPaddingPx: 0 },
        cuePosition: { captionId: 'c-0005', value: { anchor: 'tl', position: { x: .4, y: .5 } } },
        lint: async () => ({ pass: true, errors: [] }),
        write: async value => { writes++; written = value; } });
    assert.equal(result.pass, true);
    assert.equal(writes, 1);
    assert.deepEqual(JSON.parse(written).captions[0].text_style,
        { wrap_width_pct: 25, background: { padding_px: 0 }, text_anchor: 'tl', position: { x: .4, y: .5 } });
    assert.deepEqual(JSON.parse(updateCaptionTransformSource(source, ['c-0005'],
        { wrapWidthPct: 25, backgroundPaddingPx: 0 })).captions[0].text_style.background,
        { padding_px: 0 });
});

test('side actions leave the wrap-width handle clear at a short caption box', () => {
    const actions = { placement: 'side-right', top: 0, offsetX: 0,
        rotate: { left: 605, top: 163, width: 25, height: 25 },
        move: { left: 634, top: 163, width: 25, height: 25 } };
    const shifted = clearCaptionSideActions(actions, { left: 0, top: 0, width: 1006, height: 270 });
    assert.equal(shifted.rotate.left, 625);
    assert.equal(shifted.move.left, 654);
    assert.ok(shifted.rotate.left > 622); // East width handle ends at x=622.
    const crowded = clearCaptionSideActions(actions, { left: 0, top: 0, width: 661, height: 270 });
    assert.equal(crowded.rotate.left, 605); // No action may be pushed outside the pane.
});
