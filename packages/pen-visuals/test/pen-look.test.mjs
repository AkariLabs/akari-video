import assert from 'node:assert/strict';
import test from 'node:test';

import * as visuals from '../lib/index.js';

const { PEN_TUNING, drawPenStroke } = visuals;

test('pen appearance has one shared orange width, a dark outline, and restrained sparkles', () => {
    assert.equal(PEN_TUNING.coreColor, '#ff8a1f');
    assert.equal(PEN_TUNING.coreWidthPx, 2.8);
    assert.equal(PEN_TUNING.staticCoreWidthPx, PEN_TUNING.coreWidthPx);
    assert.equal(PEN_TUNING.outlineColor, 'rgba(8,10,14,0.6)');
    assert.equal(PEN_TUNING.outlineExtraWidthPx, 1.6);
    assert.equal(PEN_TUNING.sparklesPerSegment, 1);
    assert.equal(PEN_TUNING.sparkleProbability, 0.5);
    assert.equal(PEN_TUNING.sparkleMinSizePx, 4);
    assert.equal(PEN_TUNING.sparkleMaxSizePx, 8);
    assert.equal(PEN_TUNING.sparkleLifetimeMs, 460);
    assert.equal(PEN_TUNING.sparkleJitterPx, 5);
    assert.equal(PEN_TUNING.sparkleColor, 'rgb(255,206,160)');
    assert.equal(PEN_TUNING.sparkleMaxPoolSize, 120);
    assert.equal(PEN_TUNING.sparkleTwinkleHz, 2.2);
    assert.equal(PEN_TUNING.visibleWindowSec, 8);
    assert.equal(PEN_TUNING.fadeOutMs, 1500);
    assert.equal(PEN_TUNING.fadeDurationMs, 600);
    assert.equal('glowAlpha' in PEN_TUNING, false);
    assert.equal('glowSizePx' in PEN_TUNING, false);
    assert.equal('createGlowSprite' in visuals, false);
    assert.equal('createPlatinumGradient' in visuals, false);
    assert.equal('drawPenSegment' in visuals, false);
});

test('one complete path is outlined before the orange core without glow compositing', () => {
    const calls = [];
    const ctx = {
        save: () => calls.push(['save']),
        restore: () => calls.push(['restore']),
        beginPath: () => calls.push(['beginPath']),
        moveTo: (...args) => calls.push(['moveTo', ...args]),
        lineTo: (...args) => calls.push(['lineTo', ...args]),
        stroke: () => calls.push(['stroke', ctx.strokeStyle, ctx.lineWidth, ctx.lineCap, ctx.lineJoin]),
        drawImage: () => assert.fail('glow image must not be drawn')
    };
    drawPenStroke(ctx, [[0.1, 0.2], [0.5, 0.6], [0.9, 0.4]], 100, 200);
    assert.deepEqual(calls, [
        ['save'], ['beginPath'], ['moveTo', 10, 40], ['lineTo', 50, 120], ['lineTo', 90, 80],
        ['stroke', PEN_TUNING.outlineColor, 4.4, 'round', 'round'],
        ['stroke', PEN_TUNING.coreColor, 2.8, 'round', 'round'], ['restore']
    ]);
    assert.equal(ctx.globalCompositeOperation, undefined);
});
