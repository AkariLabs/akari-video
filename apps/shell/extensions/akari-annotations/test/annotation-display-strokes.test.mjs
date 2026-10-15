import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { replayableAnnotationStrokes } from '../lib/common/annotation-display-strokes.js';

const contentStroke = {
    tool: 'pen', space: 'content-rect', frame: { sourceT: 3, cutIndex: null },
    points: [[0.1, 0.2], [0.8, 0.9]]
};

test('direct content-rect stroke without sessionRef gets the panel pen button', () => {
    assert.deepEqual(replayableAnnotationStrokes([contentStroke]), [contentStroke]);
    const panel = readFileSync(new URL('../src/browser/akari-review-panel-widget.ts', import.meta.url), 'utf8');
    assert.match(panel, /const richStrokes = replayableAnnotationStrokes\(annotation\.strokes\);/);
    assert.match(panel, /if \(richStrokes\.length > 0\) \{[\s\S]*?strokeButton\.title = t\('annotations\.reviewPanelWidget\.text\.showPenDrawing'\)/);
});

test('recorded content-rect strokes keep a string sessionRef requirement', () => {
    assert.deepEqual(replayableAnnotationStrokes([{ ...contentStroke, sessionRef: 's-0001/st-0001' }]),
        [{ ...contentStroke, sessionRef: 's-0001/st-0001' }]);
    assert.deepEqual(replayableAnnotationStrokes([{ ...contentStroke, sessionRef: null }]), []);
    assert.deepEqual(replayableAnnotationStrokes([{ ...contentStroke, sessionRef: 1 }]), []);
});

test('image-rect and canvas-rect retain their previous panel button eligibility', () => {
    for (const space of ['image-rect', 'canvas-rect']) {
        assert.deepEqual(replayableAnnotationStrokes([{ ...contentStroke, space }]), []);
        assert.deepEqual(replayableAnnotationStrokes([{
            tool: 'pen', space, points: contentStroke.points
        }]), []);
        const legacy = { ...contentStroke, space, sessionRef: 's-0001/st-0001' };
        assert.deepEqual(replayableAnnotationStrokes([legacy]), [legacy]);
    }
});
