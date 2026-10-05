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

function dragHarness(kind, spec, original, opaqueBox = null,
    crop = { x: 0, y: 0, w: 1, h: 1 }) {
    const computeSnapCorrection = createSnapCorrection();
    let bounds;
    let snap;
    let transform;
    let setPreviewPosition;
    const context = {
        summary: { output }, outputTime: 0,
        previewMotionGeometryTransformFn: previewMotionGeometryTransform,
        previewMotionLiveItemFn: previewMotionLiveItem,
        window: { akari: {
            itemMotion: { evaluateItemMotion: item => item.transform },
            computeOutputFrameRect: () => ({ x: 20, y: 30 }),
            stageScale: () => 2,
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
        layerCropNow: () => crop,
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
    const screenRect = declaration('const layerScreenRectForVideoRect = (transform, videoRect, pivotPx) => {',
        'const layerAlphaAtPoint =');
    vm.runInContext(`${motion}\n${centered}\n${screenRect}\n${layerBounds}`, context);
    if (kind === 'layer') {
        const drag = declaration('const beginLayerMoveDrag = (entry, startEvent) => {',
            '// 選択済みレイヤーは描画画素ではなく選択枠を操作面にする。');
        vm.runInContext(`${drag}\nthis.runDrag = beginLayerMoveDrag;`, context);
        const entry = { spec, video: { videoWidth: 200, videoHeight: 100 },
            opaqueBox, previewVisiblePosition: null };
        setPreviewPosition = position => { entry.previewVisiblePosition = position; };
        context.drag = () => context.runDrag(entry, {});
    } else {
        const startMarker = 'beginMediaTransformDrag(cutDragTarget(), event, (moveEvent, original) => {';
        const start = source.indexOf(startMarker);
        const end = source.indexOf('\n                    });\n                    return;', start);
        assert.ok(start >= 0 && end > start);
        const callback = source.slice(start + startMarker.indexOf('(moveEvent, original)'), end) + '\n}';
        vm.runInContext(`this.runDrag = ${callback};`, context);
        setPreviewPosition = position => { context.cutPreviewVisiblePosition = position; };
        context.drag = () => { transform = context.runDrag(
            { shiftKey: false, metaKey: false, ctrlKey: false }, original); };
    }
    return {
        move(x, y, visiblePosition = null) {
            context.movement = { x, y };
            setPreviewPosition(visiblePosition);
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

    test(`${kind} move does not count an in-flight preview position twice`, () => {
        const spec = { t: 0, duration: 2, outStart: 0, outEnd: 2,
            transform: { x: 0, y: 0, scale: 0.5, rotate: 0 } };
        const live = { x: 100, y: 25, scale: kind === 'layer' ? 1 : 0.4, rotate: 0 };
        const drag = dragHarness(kind, spec, live);
        const result = drag.move(73, 41, { x: live.x + 48, y: live.y + 27 });
        assert.equal(result.bounds.centerX, output.width / 2 + live.x + 73);
        assert.equal(result.bounds.centerY, output.height / 2 + live.y + 41);
        assert.equal(result.transform.x, live.x + 73);
        assert.equal(result.transform.y, live.y + 41);
    });
}

test('layer snap uses the same opaque crop intersection as the selection frame', () => {
    const spec = { t: 0, duration: 2,
        transform: { x: 0, y: 0, scale: 0.5, rotate: 0 } };
    const live = { x: -404, y: 25, scale: 1, rotate: 0 };
    const drag = dragHarness('layer', spec, live, { x: 6, y: 0, w: 188, h: 100 });
    const result = drag.move(0, 17);
    assert.equal(result.bounds.left, 2);
    assert.equal(result.bounds.right, 190);
    assert.equal(result.bounds.centerX, 96);
    assert.equal(result.snap.x?.target, 0);
    assert.equal(result.snap.x?.correction, -2);
    assert.equal(result.transform.x, -406);
});

test('layer snap keeps the cropped selection frame pivot when rotated', () => {
    const spec = { t: 0, duration: 2,
        transform: { x: 0, y: 0, scale: 0.5, rotate: 0 } };
    const live = { x: 0, y: 0, scale: 1, rotate: 90 };
    const opaqueBox = { x: 80, y: 10, w: 110, h: 60 };
    const crop = { x: 0.25, y: 0.2, w: 0.5, h: 0.6 };
    const result = dragHarness('layer', spec, live, opaqueBox, crop).move(0, 0);
    assert.equal(result.bounds.left, 470);
    assert.equal(result.bounds.right, 540);
    assert.equal(result.bounds.top, 240);
    assert.equal(result.bounds.bottom, 290);
    assert.equal(result.bounds.centerX, 505);
    assert.equal(result.bounds.centerY, 265);
});

function mediaTransformDragHarness(handleKind = null, timersAvailable = true) {
    const listeners = new Map();
    const timers = new Map();
    const computed = [];
    const applied = [];
    let time = 0;
    let nextTimerId = 1;
    const captureTarget = {
        getAttribute: name => name === 'data-akari-handle' ? handleKind : null,
        setPointerCapture() {}, hasPointerCapture: () => false
    };
    const context = {
        selectionDragActive: false, isPlaying: false, CLICK_THRESHOLD_PX: 3,
        beginSelectionGesture: () => ({}), endSelectionGesture() {},
        document: { body: {
            classList: { add() {}, remove() {} }, appendChild() {}, style: {}
        }, createElement: () => ({ setAttribute() {}, style: {}, remove() {} }) },
        window: {
            akari: { lockedIds: new Set(), interaction: { hideSnapGuides() {} },
                reportGesture() {}, showWriteError() {} },
            addEventListener: (type, callback) => listeners.set(type, callback),
            removeEventListener: (type, callback) => {
                if (listeners.get(type) === callback) listeners.delete(type);
            }
        },
        setTimeout: (callback, delay) => {
            const id = nextTimerId++;
            timers.set(id, { callback, at: time + delay });
            return id;
        },
        clearTimeout: id => timers.delete(id)
    };
    if (!timersAvailable) {
        delete context.setTimeout;
        delete context.clearTimeout;
    }
    vm.createContext(context);
    const drag = declaration('const beginMediaTransformDrag = (target, startEvent, computeTransform) => {',
        'const pointerTranslationFrom =');
    vm.runInContext(`${drag}\nthis.beginDrag = beginMediaTransformDrag;`, context);
    const target = {
        kind: 'layer', entry: { spec: { id: 'photo' } },
        transformNow: () => ({ x: 0, y: 0, scale: 1, rotate: 0 }),
        motionAt: () => null,
        applyTransform: transform => applied.push(transform),
        flushTransform() {}, canWrite: () => true, write: async () => {}
    };
    context.beginDrag(target, {
        pointerId: 7, clientX: 0, clientY: 0, currentTarget: captureTarget,
        preventDefault() {}, stopPropagation() {}
    }, (event, original) => {
        computed.push(event);
        return { ...original, x: event.clientX, y: event.clientY };
    });
    return {
        computed, applied, timers,
        dispatch(type, event) { assert.ok(listeners.has(type), type); listeners.get(type)(event); },
        advance(ms) {
            time += ms;
            for (;;) {
                const due = [...timers.entries()].find(([, timer]) => timer.at <= time);
                if (!due) break;
                timers.delete(due[0]);
                due[1].callback();
            }
        }
    };
}

test('a paused move rechecks the same pointer event after 96 ms', () => {
    const drag = mediaTransformDragHarness();
    const move = { pointerId: 7, clientX: 170, clientY: 20,
        shiftKey: true, ctrlKey: true, metaKey: false };
    drag.dispatch('pointermove', move);
    assert.equal(drag.computed.length, 1);
    assert.equal(drag.applied.length, 1);
    assert.equal(drag.timers.size, 1);
    drag.advance(95);
    assert.equal(drag.computed.length, 1);
    drag.advance(1);
    assert.equal(drag.computed.length, 2);
    assert.equal(drag.applied.length, 2);
    assert.strictEqual(drag.computed[1], move);
    assert.equal(drag.computed[1].shiftKey, true);
    assert.equal(drag.computed[1].ctrlKey, true);
    assert.equal(drag.timers.size, 0);
});

test('a new move resets the pause timer and every drag end clears it', () => {
    for (const end of ['pointerup', 'pointercancel', 'Escape']) {
        const drag = mediaTransformDragHarness();
        const first = { pointerId: 7, clientX: 170, clientY: 20 };
        const second = { pointerId: 7, clientX: 190, clientY: 20 };
        drag.dispatch('pointermove', first);
        drag.advance(70);
        drag.dispatch('pointermove', second);
        drag.advance(30);
        assert.equal(drag.computed.length, 2, `${end}: old timer was cancelled`);
        if (end === 'Escape') drag.dispatch('keydown', { key: 'Escape' });
        else drag.dispatch(end, second);
        const afterEnd = drag.computed.length;
        assert.equal(drag.timers.size, 0, end);
        drag.advance(200);
        assert.equal(drag.computed.length, afterEnd, end);
        assert.equal(drag.timers.size, 0, end);
    }
});

test('resize does not schedule a move pause timer', () => {
    const drag = mediaTransformDragHarness('nw');
    drag.dispatch('pointermove', { pointerId: 7, clientX: 170, clientY: 20 });
    assert.equal(drag.computed.length, 1);
    assert.equal(drag.applied.length, 1);
    assert.equal(drag.timers.size, 0);
    drag.advance(200);
    assert.equal(drag.computed.length, 1);
});

test('move and cancellation work when timer APIs are unavailable', () => {
    const drag = mediaTransformDragHarness(null, false);
    const move = { pointerId: 7, clientX: 170, clientY: 20 };
    drag.dispatch('pointermove', move);
    assert.equal(drag.computed.length, 1);
    assert.equal(drag.applied.length, 1);
    assert.equal(drag.timers.size, 0);
    drag.dispatch('pointercancel', move);
    assert.equal(drag.timers.size, 0);
});

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
