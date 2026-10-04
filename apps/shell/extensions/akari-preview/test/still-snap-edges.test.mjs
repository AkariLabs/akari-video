import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { previewMotionGeometryTransform, previewMotionLiveItem } from '../lib/common/preview-motion-geometry.js';
import { readHandlerSource, sliceBetween } from './helpers/handler-source.mjs';

const source = readHandlerSource();
const style = readFileSync(new URL('../src/browser/preview-selection-handles-style.ts', import.meta.url), 'utf8');
const interaction = readFileSync(new URL('../../../../../packages/overlay-runtime/src/interaction.js', import.meta.url), 'utf8');
const output = { width: 1000, height: 500, fps: 30 };

function declaration(start, end) {
    return sliceBetween(start, end, { source });
}

function createSnapCorrection() {
    const start = interaction.indexOf('function closestAxisSnap(');
    const end = interaction.indexOf('function applyDragSnapping(', start);
    assert.ok(start >= 0 && end > start);
    const context = { SNAP_DISTANCE: 6, SNAP_RELEASE_DISTANCE: 6,
        outputSize: () => output, currentDisplayScale: () => 1,
        performance: { now: () => 0 } };
    vm.createContext(context);
    vm.runInContext(interaction.slice(start, end), context);
    return vm.runInContext('computeSnapCorrection', context);
}

function dragHarness(kind, spec, original) {
    const computeSnapCorrection = createSnapCorrection();
    let bounds;
    let snap;
    let transform;
    const context = {
        summary: { output }, outputTime: 0,
        previewMotionGeometryTransformFn: previewMotionGeometryTransform,
        previewMotionLiveItemFn: previewMotionLiveItem,
        window: { akari: {
            itemMotion: { evaluateItemMotion: item => item.transform },
            interaction: {
                computeSnapCorrection(value, previous) {
                    bounds = value;
                    snap = computeSnapCorrection(value, previous);
                    return snap;
                },
                showSnapGuides() {}
            }
        } },
        pointerTranslationFrom: () => () => context.movement,
        translate: () => context.movement,
        beginMediaTransformDrag: (_target, _event, callback) => {
            transform = callback({ shiftKey: false, metaKey: false, ctrlKey: false }, original);
        },
        layerDragTarget: () => ({}), cutDragTarget: () => ({}),
        layerCropNow: () => ({ w: 1, h: 1 }),
        cutInteractionSegment: () => spec,
        cutPreviewVisiblePosition: null,
        dragSnap: { x: null, y: null },
        movement: { x: 0, y: 0 }
    };
    vm.createContext(context);
    const motion = declaration('const motionAtForSpec = (spec, start, duration, liveTransform) => {',
        'const layerVisualTransformNow =');
    const centered = declaration('const outputBoundsForCenteredBox = (centerX, centerY, boxWidth, boxHeight) => ({',
        'const cutResizeCornersFn =');
    const layerBounds = declaration('const layerOutputBoundsForTransform = (entry, transform) => {',
        '// 裁定 0: 移動 / 角点 / 回転の確定書き戻し');
    vm.runInContext(`${motion}\n${centered}\n${layerBounds}`, context);
    if (kind === 'layer') {
        const drag = declaration('const beginLayerMoveDrag = (entry, startEvent) => {',
            '// 選択済みレイヤーは描画画素ではなく選択枠を操作面にする。');
        vm.runInContext(`${drag}\nthis.runDrag = beginLayerMoveDrag;`, context);
        const entry = { spec, video: { videoWidth: 200, videoHeight: 100 }, previewVisiblePosition: null };
        context.drag = () => context.runDrag(entry, {});
    } else {
        const startMarker = 'beginMediaTransformDrag(cutDragTarget(), event, (moveEvent, original) => {';
        const start = source.indexOf(startMarker);
        const end = source.indexOf('\n                    });\n                    return;', start);
        assert.ok(start >= 0 && end > start);
        const callback = source.slice(start + startMarker.indexOf('(moveEvent, original)'), end) + '\n}';
        vm.runInContext(`this.runDrag = ${callback};`, context);
        context.drag = () => { transform = context.runDrag(
            { shiftKey: false, metaKey: false, ctrlKey: false }, original); };
    }
    return {
        move(x, y) {
            context.movement = { x, y };
            context.drag();
            return { bounds, snap, transform };
        }
    };
}

for (const kind of ['layer', 'cut']) {
    test(`${kind} move snaps four canvas edges and center from the live pose`, () => {
        const spec = { t: 0, duration: 2, outStart: 0, outEnd: 2,
            transform: { x: 0, y: 0, scale: 0.5, rotate: 0 } };
        const live = { x: 100, y: 25, scale: kind === 'layer' ? 1 : 0.4, rotate: 0 };
        const drag = dragHarness(kind, spec, live);
        const boxWidth = kind === 'layer' ? 200 : output.width * live.scale;
        const boxHeight = kind === 'layer' ? 100 : output.height * live.scale;
        const xCases = [
            ['left', boxWidth / 2 + 2, 'left', 0, -2],
            ['right', output.width - boxWidth / 2 - 2, 'right', output.width, 2],
            ['center', output.width / 2 + 2, 'centerX', output.width / 2, -2]
        ];
        for (const [edge, center, key, target, correction] of xCases) {
            const result = drag.move(center - output.width / 2 - live.x, 17);
            assert.equal(result.bounds[key], target - correction, edge);
            assert.equal(result.snap.x?.target, target, edge);
            assert.equal(result.snap.x?.correction, correction, edge);
            assert.equal(result.transform.x, center - output.width / 2 + correction, edge);
        }
        const yCases = [
            ['top', boxHeight / 2 + 2, 'top', 0, -2],
            ['bottom', output.height - boxHeight / 2 - 2, 'bottom', output.height, 2],
            ['center', output.height / 2 + 2, 'centerY', output.height / 2, -2]
        ];
        for (const [edge, center, key, target, correction] of yCases) {
            const result = drag.move(17, center - output.height / 2 - live.y);
            assert.equal(result.bounds[key], target - correction, edge);
            assert.equal(result.snap.y?.target, target, edge);
            assert.equal(result.snap.y?.correction, correction, edge);
        }
    });
}

test('only canvas snap guides extend beyond the preview in both directions', () => {
    const selector = '.akari-interaction-snap-guide:not(.is-item)';
    for (const axis of ['vertical', 'horizontal']) {
        for (const pseudo of ['before', 'after']) {
            assert.ok(style.includes(`${selector}.is-${axis}[data-akari-interaction]::${pseudo}`),
                `${axis} ${pseudo}`);
        }
    }
    assert.match(style, /:not\(\.is-item\)\[data-akari-interaction\]::before,[\s\S]*?::after \{ content: ''; position: absolute; background: #ff8b2c; pointer-events: none; \}/u);
    assert.match(style, /\.is-vertical\[data-akari-interaction\]::before \{[^}]*top: -100vh;[^}]*height: 100vh/u);
    assert.match(style, /\.is-vertical\[data-akari-interaction\]::after \{[^}]*bottom: -100vh;[^}]*height: 100vh/u);
    assert.match(style, /\.is-horizontal\[data-akari-interaction\]::before \{[^}]*left: -100vw;[^}]*width: 100vw/u);
    assert.match(style, /\.is-horizontal\[data-akari-interaction\]::after \{[^}]*right: -100vw;[^}]*width: 100vw/u);
    assert.doesNotMatch(style, /\.akari-interaction-snap-guide\.is-item[^\n]*::(?:before|after)/u);
});
