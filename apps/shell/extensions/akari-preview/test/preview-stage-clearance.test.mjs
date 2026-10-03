import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

import { computePreviewStageClearance, computePreviewPanLimits, pinchPreviewPan }
    from '../lib/common/preview-stage-clearance.js';
import { readHandlerSource } from './helpers/handler-source.mjs';

const empty = { top: 16, barHeight: 0, holdUntil: 0, retryAfter: null };

test('bar bottom plus 8px defines top clearance, with 16px minimum', () => {
    assert.deepEqual(computePreviewStageClearance(empty, { top: 8, height: 72 }, 100, false),
        { top: 88, barHeight: 72, holdUntil: Infinity, retryAfter: null });
    assert.equal(computePreviewStageClearance(empty, { top: 0, height: 4 }, 100, false).top, 16);
    assert.equal(computePreviewStageClearance(empty, null, 100, false).top, 16);
});

test('clearance waits one second after bar disappears, then shrinks', () => {
    const shown = computePreviewStageClearance(empty, { top: 8, height: 112 }, 200, false);
    const hidden = computePreviewStageClearance(shown, null, 10200, false);
    assert.deepEqual(hidden, { top: 128, barHeight: 112, holdUntil: 11200, retryAfter: 1000 });
    assert.deepEqual(computePreviewStageClearance(hidden, null, 11199, false),
        { ...hidden, retryAfter: 1 });
    assert.deepEqual(computePreviewStageClearance(hidden, null, 11200, false),
        { top: 16, barHeight: 0, holdUntil: 11200, retryAfter: null });
    const reappeared = computePreviewStageClearance(hidden, { top: 8, height: 40 }, 10500, false);
    assert.equal(reappeared.top, 128);
    assert.equal(reappeared.holdUntil, Infinity);
    assert.deepEqual(computePreviewStageClearance(reappeared, null, 20000, false),
        { top: 128, barHeight: 112, holdUntil: 21000, retryAfter: 1000 });
    const replaced = computePreviewStageClearance(shown, { top: 8, height: 40 }, 500, false);
    assert.equal(replaced.top, 128);
    assert.equal(replaced.barHeight, 112);
    assert.equal(replaced.holdUntil, Infinity);
});

test('playback freezes stage clearance until paused', () => {
    const pending = computePreviewStageClearance(empty, { top: 8, height: 72 }, 100, true);
    assert.equal(pending.top, 16);
    assert.equal(pending.retryAfter, 100);
    assert.equal(computePreviewStageClearance(pending, { top: 8, height: 72 }, 200, false).top, 88);
    const shown = computePreviewStageClearance(empty, { top: 8, height: 72 }, 100, false);
    assert.equal(computePreviewStageClearance(shown, null, 1200, true).top, 88);
    assert.equal(computePreviewStageClearance(shown, null, 1200, false).top, 88);
    const hidden = computePreviewStageClearance(shown, null, 1200, true);
    assert.equal(computePreviewStageClearance(hidden, null, 2200, false).top, 16);
});

test('pan allowance applies at fit and adds stage overflow when zoomed', () => {
    assert.deepEqual(computePreviewPanLimits(404, 359, 202, 343, 1, 72), { x: 88, y: 88 });
    assert.deepEqual(computePreviewPanLimits(404, 359, 404, 343, 1.05, 72), { x: 88, y: 88 });
    assert.deepEqual(computePreviewPanLimits(404, 359, 404, 343, 2, 72), { x: 290, y: 259.5 });
    assert.deepEqual(computePreviewPanLimits(404, 359, 404, 343, 1, 0), { x: 16, y: 16 });
});

test('pinch anchors portrait and landscape output points throughout zoom, including narrow axes', () => {
    for (const frame of [
        { pane: [364, 301], stage: [151, 269], output: [1080, 1920] },
        { pane: [404, 359], stage: [372, 209], output: [1920, 1080] }
    ]) {
        const [paneWidth, paneHeight] = frame.pane;
        const [stageWidth, stageHeight] = frame.stage;
        const [outputWidth, outputHeight] = frame.output;
        for (const targetZoom of [2.2255, 4]) {
            for (const [fx, fy] of [[0.05, 0.05], [0.95, 0.05], [0.05, 0.95], [0.95, 0.95], [0.5, 0.5]]) {
                const cursor = { x: (fx - 0.5) * stageWidth, y: (fy - 0.5) * stageHeight };
                const before = { x: fx * outputWidth, y: fy * outputHeight };
                let zoom = 1;
                let pan = { x: 0, y: 0 };
                for (const nextZoom of [Math.sqrt(targetZoom), targetZoom]) {
                    pan = pinchPreviewPan(pan, cursor, zoom, nextZoom);
                    const limits = computePreviewPanLimits(paneWidth, paneHeight, stageWidth, stageHeight, nextZoom, 0);
                    pan = { x: Math.max(-limits.x, Math.min(limits.x, pan.x)),
                        y: Math.max(-limits.y, Math.min(limits.y, pan.y)) };
                    zoom = nextZoom;
                }
                const after = { x: ((cursor.x - pan.x) / zoom / stageWidth + 0.5) * outputWidth,
                    y: ((cursor.y - pan.y) / zoom / stageHeight + 0.5) * outputHeight };
                assert.ok(Math.abs(after.x - before.x) <= 0.5 && Math.abs(after.y - before.y) <= 0.5,
                    `${outputWidth}:${outputHeight} at ${targetZoom}x, ${fx},${fy}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
            }
        }
    }
});

test('pinch keeps the same output point beneath cursor', () => {
    const pan = { x: 10, y: -20 }, cursor = { x: 100, y: 50 };
    const next = pinchPreviewPan(pan, cursor, 1, 2);
    assert.deepEqual(next, { x: -80, y: -90 });
    assert.equal((cursor.x - pan.x) / 1, (cursor.x - next.x) / 2);
    assert.equal((cursor.y - pan.y) / 1, (cursor.y - next.y) / 2);
});

test('embedded pure functions have no module dependencies', () => {
    for (const fn of [computePreviewStageClearance, computePreviewPanLimits, pinchPreviewPan]) {
        const embedded = vm.runInNewContext(`(${fn.toString()})`);
        const args = fn === computePreviewStageClearance ? [empty, { top: 8, height: 72 }, 100, false]
            : fn === computePreviewPanLimits ? [404, 359, 404, 343, 2, 72]
                : [{ x: 10, y: -20 }, { x: 100, y: 50 }, 1, 2];
        assert.deepEqual({ ...embedded(...args) }, fn(...args));
    }
});

test('output stage uses a fixed 40px top gutter while material preview keeps 16px', () => {
    const source = readHandlerSource();
    const host = readFileSync(new URL('../src/browser/preview-context-bar.ts', import.meta.url), 'utf8');
    assert.match(host, /akari-preview-context-bar-rect/);
    assert.match(source, /event\.data\?\.type !== 'akari-preview-context-bar-rect'/);
    assert.match(source, /previewStage\.getBoundingClientRect\(\)[\s\S]*reportLibraryDropGeometry/);
    const base = source.match(/^#preview-stage \{ (.+) \}$/m)?.[1];
    assert.ok(base);
    assert.doesNotMatch(base, /transition:/);
    assert.match(source, /^html\.akari-gen-capture-fit #preview-stage \{[^\n]*transition: none;/m);
    const css = source.slice(source.indexOf('#preview-stage {'), source.indexOf('html.akari-gen-capture-fit #preview-stage'));
    const renderCss = kind => vm.runInNewContext('`' + css + '`', { kind, width: 1920, height: 1080 });
    assert.match(renderCss('output'), /#preview-stage \{ --akari-preview-gutter-top: 40px; top: calc\(/);
    assert.doesNotMatch(renderCss('raw'), /--akari-preview-gutter-top: 40px/);
    assert.match(renderCss('raw'), /#preview-stage \{ --akari-preview-gutter: 16px; --akari-preview-gutter-top: 16px;/);
    assert.doesNotMatch(renderCss('output'), /\$\{(?:width|height)\}/);
});

test('menu rectangle reports never change output stage position or size', () => {
    const source = readHandlerSource();
    const start = source.indexOf('let stageClearance = { barHeight: 0 };');
    const end = source.indexOf('const panLimits = () =>', start);
    assert.ok(start > 0 && end > start);
    let onMessage;
    const stage = { top: 40, width: 800, writes: 0 };
    const context = {
        window: { addEventListener: (_type, callback) => { onMessage = callback; } },
        pan: { x: 0, y: 0 }, clampPan: value => value, renderZoom() {},
        previewStage: { style: { setProperty() { stage.writes++; } }, classList: { add() { stage.writes++; }, toggle() { stage.writes++; } } }
    };
    vm.runInNewContext(source.slice(start, end), context);
    for (const rect of [{ top: 5, height: 30 }, null, { top: 5, height: 60 }, { top: 5, height: 90 }, null]) {
        onMessage({ data: { type: 'akari-preview-context-bar-rect', rect } });
        assert.deepEqual([stage.top, stage.width, stage.writes], [40, 800, 0]);
    }
});

test('write failure banner overlays the bottom of the picture pane', () => {
    const source = readHandlerSource();
    const bannerCss = source.match(/^\.write-error-banner \{ ([^\n]+) \}$/m)?.[1];
    assert.ok(bannerCss);
    const output = vm.runInNewContext('`' + bannerCss + '`', { kind: 'output' });
    const material = vm.runInNewContext('`' + bannerCss + '`', { kind: 'raw' });
    assert.match(output, /position: absolute; bottom: 0;/);
    assert.doesNotMatch(output, /(?:^|;) top:/);
    assert.match(material, /position: absolute; top: 8px;/);
    assert.match(source, /<div id="write-error-banner" class="write-error-banner" hidden role="alert"/);
});

test('wheel pans in pixel and line modes without intercepting scrollable controls', () => {
    const source = readHandlerSource();
    const start = source.indexOf("previewPane.addEventListener('wheel', event => {");
    const end = source.indexOf('}, { passive: false });', start) + '}, { passive: false });'.length;
    assert.ok(start >= 0 && end > start);
    let wheel;
    class Element { constructor(parent, control = false) { this.parentElement = parent; this.control = control; this.isContentEditable = true; }
        closest() { return this.control ? {} : null; } }
    const previewPane = { clientHeight: 359, addEventListener: (_name, handler) => { wheel = handler; },
        getBoundingClientRect: () => ({ left: 100, top: 50, width: 404, height: 359 }) };
    const context = { previewPane, Element, pan: { x: 0, y: 0 }, zoom: 1,
        clampPan: value => value, renderZoom() {}, computePinchPan: pinchPreviewPan,
        setZoom(value) { context.zoom = value; }, clamp: (value, low, high) => Math.max(low, Math.min(high, value)),
        ZOOM_MIN: 0.25, ZOOM_MAX: 8, getComputedStyle: () => ({ overflowX: 'visible', overflowY: 'visible' }) };
    vm.runInNewContext(source.slice(start, end), context);
    let prevented = 0;
    const target = new Element(previewPane);
    wheel({ target, ctrlKey: false, deltaX: 3, deltaY: -2, deltaMode: 1,
        preventDefault() { prevented++; } });
    assert.deepEqual(JSON.parse(JSON.stringify(context.pan)), { x: -48, y: 32 });
    assert.equal(prevented, 1);
    wheel({ target: new Element(previewPane, true), ctrlKey: false, deltaX: 50, deltaY: 50,
        preventDefault() { prevented++; } });
    assert.equal(prevented, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(context.pan)), { x: -48, y: 32 });
    const beforePinch = { ...context.pan };
    wheel({ target: new Element(previewPane, true), ctrlKey: true, deltaY: -20,
        clientX: 302, clientY: 200, preventDefault() { prevented++; } });
    assert.equal(prevented, 2);
    assert.ok(context.zoom > 1);
    const expected = pinchPreviewPan(beforePinch, { x: 0, y: -29.5 }, 1, context.zoom);
    assert.deepEqual(JSON.parse(JSON.stringify(context.pan)), expected);
});
