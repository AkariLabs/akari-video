import test from 'node:test';
import assert from 'node:assert/strict';
import { libraryTextStyleSample } from '../lib/common/textstyle-sample.js';
import { resolveCaptionRichStrokes, resolveCaptionStyleForOutput } from '../../../../../packages/edit-store/lib/caption-display.js';

test('specimen uses the caption resolver for gradient, layered strokes and shadow at card scale', () => {
    const style = { size_px: 96, reference_height_px: 1080, weight: 900,
        fill: { type: 'gradient', angle_deg: 180, stops: [{ at: 0, color: '#8ef4ff' }, { at: 100, color: '#19cdf2' }] },
        strokes: [{ color: '#05284a', width_px: 9.6, offset_x: 4.32, offset_y: 5.76 },
            { color: '#ffffff', width_px: 6.72 }],
        shadow: { color: '#000000', opacity: 0.5, distance_px: 8, angle_deg: 45, blur_px: 4 } };
    const sample = libraryTextStyleSample(style);
    const height = 1080 * 20 / 96;
    const output = { width: height * 16 / 9, height };
    assert.deepEqual(sample.vars, resolveCaptionStyleForOutput(style, output).vars);
    assert.deepEqual(sample.strokes, resolveCaptionRichStrokes(style, output));
    assert.match(sample.vars['--caption-rich-fill-image'], /linear-gradient\(180deg/u);
    assert.equal(sample.vars['--caption-font-size'], '20px');
    assert.match(sample.vars['--caption-text-shadow'], /px/u);
});
