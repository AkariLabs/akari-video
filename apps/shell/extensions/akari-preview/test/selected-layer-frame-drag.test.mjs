import assert from 'node:assert/strict';
import test from 'node:test';
import { readHandlerSource } from './helpers/handler-source.mjs';

const source = readHandlerSource();

test('selected layer frame is a drag surface while unselected hit testing remains alpha/clip based', () => {
    assert.match(source, /#layer-select-box\.is-active \{[^}]*pointer-events: auto;[^}]*cursor: move/);
    assert.match(source, /layerSelectBox\.addEventListener\('pointerdown',[\s\S]*event\.target !== layerSelectBox[\s\S]*beginLayerMoveDrag\(entry, event\)/);
    assert.match(source, /layerAlphaAtPoint\(candidateEntry, event\.clientX, event\.clientY\) > 16/);
    assert.match(source, /media\.style\.clipPath = resolveLayerHitRegionClipFn\(/);
    assert.match(source, /applyLayerStyleMediaLayout\(layerVideo, outputWidth, outputHeight\)/);
});
