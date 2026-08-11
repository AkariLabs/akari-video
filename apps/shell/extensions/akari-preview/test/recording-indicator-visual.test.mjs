import assert from 'node:assert/strict';
import test from 'node:test';

import { computeIndicatorClipPath } from '../lib/common/recording-indicator-visual.js';

// docs/contract-2026-08-11-review-session-ui-events.md #4: the indicator frame must exclude the
// review panel. This checks the pure geometry (clip-path hole) without touching the DOM.

const VIEWPORT = { width: 1200, height: 800 };

test('no exclude rect: no clip-path (frame covers the whole viewport)', () => {
    assert.equal(computeIndicatorClipPath(undefined, VIEWPORT), undefined);
});

test('punches a hole matching the panel rect', () => {
    const rect = { left: 900, top: 0, right: 1200, bottom: 800 };
    const clipPath = computeIndicatorClipPath(rect, VIEWPORT);
    assert.ok(clipPath.startsWith('polygon(evenodd,'));
    assert.match(clipPath, /900px 0px/);
    assert.match(clipPath, /1200px 800px/);
});

test('clamps a rect that overflows the viewport', () => {
    const rect = { left: -50, top: -20, right: 1300, bottom: 900 };
    const clipPath = computeIndicatorClipPath(rect, VIEWPORT);
    assert.match(clipPath, /0px 0px/);
    assert.match(clipPath, /1200px 800px/);
});

test('zero-area rect (panel not actually visible) yields no clip-path', () => {
    assert.equal(computeIndicatorClipPath({ left: 10, top: 10, right: 10, bottom: 400 }, VIEWPORT), undefined);
    assert.equal(computeIndicatorClipPath({ left: 10, top: 10, right: 400, bottom: 10 }, VIEWPORT), undefined);
});

test('rect entirely outside the viewport yields no clip-path', () => {
    assert.equal(computeIndicatorClipPath({ left: 2000, top: 0, right: 2100, bottom: 100 }, VIEWPORT), undefined);
});

test('zero-size viewport yields no clip-path', () => {
    const rect = { left: 0, top: 0, right: 100, bottom: 100 };
    assert.equal(computeIndicatorClipPath(rect, { width: 0, height: 0 }), undefined);
});
