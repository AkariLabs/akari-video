import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { computeZoomMinimapLayout } from '../lib/common/zoom-minimap-layout.js';

const closeTo = (actual, expected, epsilon = 1e-9) => {
    assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} should be within ${epsilon} of ${expected}`);
};

for (const [outputWidth, outputHeight] of [[1920, 1080], [1080, 1920], [1080, 1080]]) {
    for (const zoom of [1.5, 2, 4]) {
        for (const [position, direction] of [['center', 0], ['top-left', 1], ['bottom-right', -1]]) {
            test(`${outputWidth}:${outputHeight} at ${zoom}x, ${position}`, () => {
                const paneWidth = 1200;
                const paneHeight = 700;
                const scale = Math.min((paneWidth - 16) / outputWidth, (paneHeight - 16) / outputHeight);
                const stageWidth = outputWidth * scale;
                const stageHeight = outputHeight * scale;
                const pan = {
                    x: direction * Math.max(0, (stageWidth * zoom - paneWidth) / 2),
                    y: direction * Math.max(0, (stageHeight * zoom - paneHeight) / 2)
                };
                const layout = computeZoomMinimapLayout({ paneWidth, paneHeight, stageWidth, stageHeight,
                    zoom, pan, outputWidth, outputHeight });
                closeTo(layout.box.width / layout.box.height, outputWidth / outputHeight);
                closeTo(Math.max(layout.box.width, layout.box.height), 64);
                const visibleWidth = Math.min(1, paneWidth / (stageWidth * zoom));
                const visibleHeight = Math.min(1, paneHeight / (stageHeight * zoom));
                closeTo(layout.viewport.width, visibleWidth);
                closeTo(layout.viewport.height, visibleHeight);
                closeTo(layout.viewport.left, (1 - visibleWidth) * (1 - direction) / 2);
                closeTo(layout.viewport.top, (1 - visibleHeight) * (1 - direction) / 2);
            });
        }
    }
}

test('uses the full portrait width when only the vertical axis is clipped', () => {
    const layout = computeZoomMinimapLayout({ paneWidth: 1200, paneHeight: 700,
        stageWidth: 393.75, stageHeight: 700, zoom: 2, pan: { x: 0, y: 0 },
        outputWidth: 1080, outputHeight: 1920, boxSize: 80 });
    assert.deepEqual(layout, { box: { width: 45, height: 80 },
        viewport: { left: 0, top: 0.25, width: 1, height: 0.5 } });
});

test('clamps an intersection entirely outside the pane to zero width', () => {
    const layout = computeZoomMinimapLayout({ paneWidth: 100, paneHeight: 100,
        stageWidth: 100, stageHeight: 100, zoom: 2, pan: { x: 1000, y: 0 },
        outputWidth: 100, outputHeight: 100 });
    assert.deepEqual(layout.viewport, { left: 0, top: 0.25, width: 0, height: 0.5 });
});

test('falls back safely before stage dimensions are available', () => {
    const layout = computeZoomMinimapLayout({ paneWidth: 0, paneHeight: 0,
        stageWidth: 0, stageHeight: 0, zoom: 1, pan: { x: 0, y: 0 },
        outputWidth: 0, outputHeight: 0 });
    assert.deepEqual(layout, { box: { width: 64, height: 64 },
        viewport: { left: 0, top: 0, width: 1, height: 1 } });
});

test('serialized function works without module state', () => {
    const serialized = vm.runInNewContext(`(${computeZoomMinimapLayout.toString()})`);
    const input = { paneWidth: 1200, paneHeight: 700, stageWidth: 393.75, stageHeight: 700,
        zoom: 4, pan: { x: 30, y: -45 }, outputWidth: 1080, outputHeight: 1920 };
    assert.deepEqual(JSON.parse(JSON.stringify(serialized(input))), computeZoomMinimapLayout(input));
});

const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const renderZoom = source.slice(source.indexOf('            const renderZoom = () => {'),
    source.indexOf('            const setZoom = value => {'));
for (const zoom of [0.5, 1, 1.05, 1.051]) {
    test(`renderZoom preserves minimap visibility at zoom ${zoom}`, () => {
        const context = {
            zoom, pan: { x: 0, y: 0 }, zoomLayer: { style: {} }, zoomValue: {}, zoomSlider: {},
            zoomToSlider: value => value, zoomMinimap: { style: {} }, zoomMinimapViewport: { style: {} },
            previewPane: { clientWidth: 1216, clientHeight: 716, classList: { toggle() {}, remove() {} } },
            previewStage: { getBoundingClientRect: () => ({ width: 393.75 * zoom, height: 700 * zoom }) },
            computeMinimapLayout: computeZoomMinimapLayout
        };
        vm.runInNewContext(renderZoom + '\nrenderZoom();', context);
        assert.equal(context.zoomMinimap.hidden, zoom <= 1.05);
        if (zoom > 1.05) {
            assert.equal(context.zoomMinimap.style.width, '36px');
            assert.equal(context.zoomMinimapViewport.style.width, '100%');
            closeTo(parseFloat(context.zoomMinimapViewport.style.height), 100 * 716 / (700 * zoom));
        }
    });
}
