import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { placePreviewLayerActions } from '../lib/common/preview-layer-action-placement.js';

const overlaps = (a, b) => a.left < b.left + b.width && a.left + a.width > b.left
    && a.top < b.top + b.height && a.top + a.height > b.top;
const contained = (outer, inner) => inner.left >= outer.left && inner.top >= outer.top
    && inner.left + inner.width <= outer.left + outer.width
    && inner.top + inner.height <= outer.top + outer.height;
const assertClear = (stage, selection, menu, expected) => {
    const result = placePreviewLayerActions(stage, selection, menu);
    assert.ok(result);
    assert.equal(result.placement, expected);
    for (const button of [result.rotate, result.move]) {
        assert.equal(contained(stage, button), true);
        assert.equal(overlaps(button, menu), false);
        assert.equal(overlaps(button, selection), false);
    }
};

test('bottom edge moves both controls beside the photo and clear of the floating menu', () => {
    assertClear({ left: 0, top: 0, width: 583, height: 328 },
        { left: 39, top: 219, width: 91, height: 90 },
        { left: 0, top: 173, width: 156, height: 36 }, 'side-right');
});

test('top edge keeps the usual controls below, clear of a menu below the gap', () => {
    assertClear({ left: 0, top: 0, width: 583, height: 328 },
        { left: 120, top: 3, width: 100, height: 90 },
        { left: 90, top: 145, width: 160, height: 36 }, 'below');
});

test('short stage and menu on the edge still leave both controls reachable', () => {
    assertClear({ left: 0, top: 0, width: 200, height: 70 },
        { left: 60, top: 20, width: 80, height: 28 },
        { left: 20, top: 0, width: 160, height: 18 }, 'side-right');
});

test('when the menu covers the photo center, the controls move to its side', () => {
    assertClear({ left: 0, top: 0, width: 300, height: 90 },
        { left: 100, top: 30, width: 80, height: 40 },
        { left: 50, top: 20, width: 120, height: 50 }, 'side-right');
});

test('panned selection keeps its controls reachable at the viewport edge', () => {
    const viewport = { left: 0, top: 0, width: 400, height: 300 };
    const selection = { left: -500, top: -400, width: 80, height: 50 };
    const result = placePreviewLayerActions(viewport, selection, null);
    for (const button of [result.rotate, result.move]) {
        assert.equal(contained(viewport, button), true);
    }
});

test('preview receives the host menu bounds and uses the placement helper', () => {
    const host = readFileSync(new URL('../src/browser/preview-context-bar.ts', import.meta.url), 'utf8');
    const webview = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
    assert.match(host, /type: 'akari-preview-context-menu-rect', rect: menuRect/u);
    assert.match(webview, /previewLayerActionsFn\(previewPane\.getBoundingClientRect\(\),\s*layerSelectBox\.getBoundingClientRect\(\), floatingMenuRect, zoomScale\)/u);
});
