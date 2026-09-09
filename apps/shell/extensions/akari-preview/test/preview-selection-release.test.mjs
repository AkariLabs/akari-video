import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// Execute the webview's actual source fragments; no compiled lib is required.
const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
function between(start, end) {
    const from = source.indexOf(start);
    assert.notEqual(from, -1, start);
    const to = source.indexOf(end, from + start.length);
    assert.notEqual(to, -1, end);
    return source.slice(from, to);
}
function declaration(name) {
    return between(`const ${name} =`, '\n            };') + '\n};';
}

const stageStyle = source.match(/^#preview-stage \{ (.+) \}$/m)?.[1];
assert.ok(stageStyle);
const gutter = Number(stageStyle.match(/--akari-preview-gutter: (\d+)px/)?.[1]);
function fittedWidth(paneWidth, paneHeight, width = 1280, height = 720) {
    const expression = stageStyle.match(/ width: ([^;]+);/)[1]
        .replaceAll('var(--akari-preview-gutter)', String(gutter))
        .replaceAll('100cqw', String(paneWidth)).replaceAll('100cqh', String(paneHeight))
        .replaceAll('${width}', String(width)).replaceAll('${height}', String(height))
        .replaceAll('px', '').replaceAll('calc(', '(');
    return vm.runInNewContext(expression, { max: Math.max, min: Math.min });
}

test('fit reserves a gutter on both axes and stays positive in tiny panes', () => {
    assert.equal(gutter, 16);
    assert.match(stageStyle, /max\(1px, min\(calc\(100cqw - var\(--akari-preview-gutter\) \* 2\)/);
    assert.match(stageStyle, /100cqh - var\(--akari-preview-gutter\) \* 2/);
    for (const [width, height] of [[1280, 720], [720, 1280]]) {
        for (const [paneWidth, paneHeight] of [[1280, 720], [720, 1280], [800, 450]]) {
            const actualWidth = fittedWidth(paneWidth, paneHeight, width, height);
            const actualHeight = actualWidth * height / width;
            assert.ok(actualWidth <= paneWidth - gutter * 2 + 1e-9);
            assert.ok(actualHeight <= paneHeight - gutter * 2 + 1e-9);
        }
        for (const [paneWidth, paneHeight] of [[0, 0], [1, 1], [16, 450], [800, 16], [32, 32]]) {
            assert.ok(fittedWidth(paneWidth, paneHeight, width, height) > 0);
        }
    }
});

function eventTarget(selector = '') {
    const listeners = new Map();
    return {
        dataset: {}, style: {},
        classList: { add() {}, remove() {} },
        closest: selectors => selector && selectors.split(',').some(item => item.trim() === selector) ? {} : null,
        addEventListener(type, listener, capture = false) {
            const entries = listeners.get(type) || [];
            entries.push({ listener, capture });
            listeners.set(type, entries);
        },
        dispatch(type, event) {
            for (const { listener } of listeners.get(type) || []) {
                listener(event);
                if (event.immediateStopped) break;
            }
        },
        listeners,
        setPointerCapture() {}, hasPointerCapture: () => true, releasePointerCapture() {}
    };
}
function pointer(type, target, properties = {}) {
    return {
        type, target, button: 0, pointerId: 1, clientX: 10, clientY: 10,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.propagationStopped = true; },
        stopImmediatePropagation() { this.immediateStopped = true; },
        ...properties
    };
}
function harness(overrides = {}) {
    const window = eventTarget();
    window.akari = { frameEngineClock: {}, exitFullscreen() { exits++; } };
    const previewPane = eventTarget();
    previewPane.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 450 });
    const video = { dataset: { akariCutIndex: '0' }, style: { visibility: '', zIndex: '1' },
        getBoundingClientRect: () => ({ left: 40, top: 30, right: 760, bottom: 430, width: 720, height: 400 }) };
    let exits = 0;
    const calls = [];
    const context = {
        window, previewPane, wrapper: eventTarget(), video,
        stillImage: { style: { display: 'none' } },
        previewStage: { getBoundingClientRect: () => ({ left: 40, top: 30, right: 760, bottom: 430 }) },
        frameEngineMediaIdle: true, layerEntries: [],
        segments: [{kind: 'src', track: 0}], activeSegmentIndex: 0,
        allTracksHiddenByScope: {cuts:false}, hiddenTracksByScope:{cuts:new Set()},
        layerGeometryHitAt: entry => entry.hit,
        document: { elementsFromPoint: () => [] },
        findLayerEntry: () => null, layerAlphaAtPoint: () => 255,
        selectedCaptionId: null, selectedLayerId: null, cutSelected: false,
        selectionDragActive: false, penModeActive: false, rectModeActive: false,
        cropModeActive: false, perspectivePanelOpen: false, activeCaptionEdit: null,
        scrubDragActive: false, hostFullscreenActive: true,
        suppressClick: false, drag: null, zoom: 1, pan: { x: 0, y: 0 },
        CLICK_THRESHOLD_PX: 4, Element: class Element {},
        clampPan: value => value, renderZoom() {},
        deselectCaption() { calls.push('caption'); context.selectedCaptionId = null; },
        selectLayer(id) { calls.push('layer'); context.selectedLayerId = id; },
        deselectCut() { calls.push('cut'); context.cutSelected = false; },
        ...overrides
    };
    vm.createContext(context);
    vm.runInContext(declaration('findVisualMediaHitAt') + '\nglobalThis.hit = findVisualMediaHitAt;', context);
    vm.runInContext(between('const isSelectionReleaseTarget =', '            new ResizeObserver(() => updateLayerSelectBox())'), context);
    // Include the real pan/click suppression listeners after the selection listeners, as in the webview.
    vm.runInContext(between('const isDirectManipulationTarget =', "            fullscreenToggle.addEventListener('click'"), context);
    vm.runInContext(between('// 操作中の Escape は既存の取消処理へ渡し', '            // isEditable だけでは IME'), context);
    const dispatchPointer = (type, properties = {}) => {
        const event = pointer(type, previewPane, properties);
        window.dispatch(type, event);
        if (!event.propagationStopped) previewPane.dispatch(type, event);
        if (!event.propagationStopped) context.wrapper.dispatch(type, event);
        return event;
    };
    return { context, calls, dispatchPointer, exits: () => exits };
}

test('engine hits only selectable cuts inside the client-space output frame', () => {
    for (const frameEngineMediaIdle of [true, false]) {
        const { context } = harness({ frameEngineMediaIdle });
        const inside = { clientX: 400, clientY: 200 };
        assert.equal(context.hit(inside), context.video);
        for (const point of [{ clientX: 10, clientY: 200 }, { clientX: 400, clientY: 10 },
            { clientX: 790, clientY: 200 }, { clientX: 400, clientY: 440 }]) {
            assert.equal(context.hit(point), null);
        }
        for (const index of ['', undefined]) {
            context.video.dataset.akariCutIndex = index;
            assert.equal(context.hit(inside), null);
        }
        context.video.dataset.akariCutIndex = '0';
        context.video.style.visibility = 'hidden';
        assert.equal(context.hit(inside), context.video, 'idle legacy video is not logical visibility');
        context.hiddenTracksByScope.cuts.add(0);
        assert.equal(context.hit(inside), null);
        context.hiddenTracksByScope.cuts.clear();
        context.stillImage.style.display = '';
        assert.equal(context.hit(inside), context.video, 'visible stills remain selectable');
        context.stillImage.style.display = 'none';
        const layer = { video: { style: { zIndex: '2' }, videoWidth: 100, videoHeight: 100 }, hit: true };
        context.layerEntries.push(layer);
        assert.equal(context.hit(inside), layer.video, 'layer hits precede the cut visibility guard');
    }
});

const selections = [
    ['cut', { cutSelected: true }], ['layer', { selectedLayerId: 'l1' }],
    ['caption', { selectedCaptionId: 'c1' }]
];
for (const [name, selection] of selections) {
    test(`pasteboard releases ${name} with or without a synthesized click, including zoomed pan capture`, () => {
        for (const zoom of [1, 2]) {
            const { dispatchPointer, calls } = harness({ ...selection, zoom });
            dispatchPointer('pointerdown');
            assert.deepEqual(calls, [], 'do not deselect before a potential pan');
            dispatchPointer('pointerup');
            assert.deepEqual(calls, [name], 'pointerup alone must suffice');
            dispatchPointer('click');
            assert.deepEqual(calls, [name]);
        }
    });
    test(`pan drag and cancellation preserve ${name}, including a drag returning to its origin`, () => {
        for (const finish of ['pointerup', 'pointercancel']) {
            const { dispatchPointer, calls, context } = harness({ ...selection, zoom: 2 });
            dispatchPointer('pointerdown');
            dispatchPointer('pointermove', { clientX: 30 });
            dispatchPointer('pointermove');
            dispatchPointer(finish);
            dispatchPointer('click');
            assert.deepEqual(calls, []);
            assert.equal(context.drag, null);
            dispatchPointer('pointerdown');
            dispatchPointer('pointerup');
            assert.deepEqual(calls, [name], 'a new click is not swallowed by stale suppression');
        }
    });
}

test('protected selection controls and captions never release on pointer or click', () => {
    for (const selector of ['#layer-select-box', '#cut-select-box', '#caption-select-box',
        '#layer-crop-box', '#layer-crop-toggle', '#layer-perspective-toggle', '#layer-perspective-panel',
        '#caption-plate', '[data-overlay-id]', 'button']) {
        const { dispatchPointer, calls } = harness({ cutSelected: true, selectedLayerId: 'l1', selectedCaptionId: 'c1' });
        const target = eventTarget(selector);
        dispatchPointer('pointerdown', { target });
        dispatchPointer('pointerup', { target });
        dispatchPointer('click', { target });
        assert.deepEqual(calls, [], selector);
    }
});

test('empty or hidden cuts allow release inside the stage; real cut hits preserve selection', () => {
    for (const kind of ['empty', 'hidden', 'visible']) {
        const { context, calls, dispatchPointer } = harness({ cutSelected: true });
        if (kind === 'empty') context.video.dataset.akariCutIndex = '';
        if (kind === 'hidden') context.hiddenTracksByScope.cuts.add(0);
        const position = { clientX: 400, clientY: 200 };
        dispatchPointer('pointerdown', position);
        dispatchPointer('pointerup', position);
        dispatchPointer('click', position);
        assert.deepEqual(calls, kind === 'visible' ? [] : ['cut']);
    }
});

test('trusted Escape clears exactly one selection per key before exiting fullscreen', () => {
    const { context, calls, exits } = harness({ selectedCaptionId: 'c1', selectedLayerId: 'l1', cutSelected: true });
    assert.ok(context.window.listeners.get('keydown').every(entry => entry.capture === true));
    for (const expected of [['caption'], ['caption', 'layer'], ['caption', 'layer', 'cut']]) {
        const event = pointer('keydown', context.previewPane, { key: 'Escape', isTrusted: true });
        context.window.dispatch('keydown', event);
        assert.deepEqual(calls, expected);
        assert.equal(event.propagationStopped, true);
        assert.equal(exits(), 0, 'stopPropagation alone does not stop another listener on window');
    }
    context.window.dispatch('keydown', pointer('keydown', context.previewPane, { key: 'Escape', isTrusted: true }));
    assert.equal(exits(), 1);
});

test('Escape leaves existing crop, perspective, drag, and inline edit cancellation in charge', () => {
    for (const guard of ['cropModeActive', 'perspectivePanelOpen', 'selectionDragActive',
        'drag', 'scrubDragActive', 'activeCaptionEdit']) {
        const { context, calls } = harness({ selectedCaptionId: 'c1', [guard]: true, hostFullscreenActive: false });
        const event = pointer('keydown', context.previewPane, { key: 'Escape', isTrusted: true });
        let existingCancel = false;
        context.window.addEventListener('keydown', () => { existingCancel = true; }, true);
        context.window.dispatch('keydown', event);
        assert.deepEqual(calls, [], guard);
        assert.equal(existingCancel, true, guard);
        assert.equal(event.defaultPrevented, undefined);
    }
    for (const key of ['Escape', 'Enter']) {
        const { context, calls, exits } = harness({ selectedCaptionId: 'c1' });
        context.window.dispatch('keydown', pointer('keydown', context.previewPane, { key, isTrusted: false }));
        assert.deepEqual(calls, []);
        assert.equal(exits(), 0);
    }
    for (const name of ['beginMediaTransformDrag', 'beginMediaCropDrag']) {
        const body = declaration(name);
        assert.match(body, /beginSelectionGesture\(target\)/);
        assert.match(body, /finally \{[\s\S]*endSelectionGesture\(gesture\)/);
        assert.match(body, /const cleanup = \(\) => \{\s*selectionDragActive = false/);
    }
    const captionDrag = between("captionPlate.addEventListener('pointerdown', event =>", '            new ResizeObserver(() => updateCaptionSelectBox())');
    assert.match(captionDrag, /selectionDragActive = true/);
    assert.match(captionDrag, /const cleanup = \(\) => \{\s*selectionDragActive = false/);
});

test('caption and layer coordinates use the measured frame with gutters, zoom, and pan', () => {
    for (const zoom of [1, 2]) {
        const width = fittedWidth(800, 450);
        const height = width * 720 / 1280;
        const scale = width / 1280;
        const left = (800 - width * zoom) / 2 + 37;
        const top = (450 - height * zoom) / 2 - 19;
        const stageRect = { left, top, width: width * zoom, height: height * zoom };
        const stage = { getBoundingClientRect: () => stageRect };
        const plate = { left: 320, right: 960, top: 540, bottom: 640 };
        const context = {
            previewStage: stage, stage, wrapper: { clientWidth: 800, clientHeight: 450 }, zoom,
            document: { getElementById: () => ({ getBoundingClientRect: () => ({ width: 800 * zoom, height: 450 * zoom }) }) },
            window: { akari: { stageScale: () => scale } },
            summary: { output: { width: 1280, height: 720 } }, selectedCaptionId: 'c1',
            captionSelectBox: { style: {}, classList: { add() {} } }, updateCaptionSelectTools() {},
            captionPlate: {
                querySelector: () => null, querySelectorAll: () => [],
                getBoundingClientRect: () => ({
                    left: left + plate.left * scale * zoom, right: left + plate.right * scale * zoom,
                    top: top + plate.top * scale * zoom, bottom: top + plate.bottom * scale * zoom
                })
            }
        };
        vm.createContext(context);
        vm.runInContext([
            declaration('computeOutputFrameRect'),
            'window.akari.computeOutputFrameRect = computeOutputFrameRect;',
            declaration('captionOutputPoint'), declaration('captionVisualRect'), declaration('setRectStyle'),
            declaration('updateCaptionSelectBoxForRect'), declaration('layerScreenRectForVideoRect'),
            'globalThis.frame = computeOutputFrameRect();',
            'globalThis.plate = captionVisualRect(); updateCaptionSelectBoxForRect(plate);',
            'globalThis.layer = layerScreenRectForVideoRect({ x: 0, y: 0, scale: 1, rotate: 0 },',
            '    { x: 0, y: 0, w: 640, h: 100 }, { x: 320, y: 50 });'
        ].join('\n'), context);
        const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
        assert.equal(context.frame.x, 0);
        assert.equal(context.frame.y, 0);
        near(context.frame.width, width);
        near(context.frame.height, height);
        for (const edge of Object.keys(plate)) near(context.plate[edge], plate[edge]);
        near(parseFloat(context.captionSelectBox.style.left), plate.left * scale);
        near(parseFloat(context.captionSelectBox.style.top), plate.top * scale);
        near(parseFloat(context.captionSelectBox.style.width), 640 * scale);
        near(context.layer.left, 320 * scale);
        near(context.layer.top, 310 * scale);
        near(context.layer.width, 640 * scale);
        near(context.layer.height, 100 * scale);
    }
});

test('media hits use transformed cut bounds and numeric track order instead of layer array order', () => {
    const { context } = harness();
    const point = { clientX: 400, clientY: 200 };
    context.video.getBoundingClientRect = () => ({ left: 300, top: 150, right: 500, bottom: 250, width: 200, height: 100 });
    const front = { video: { style: { zIndex: '10' }, videoWidth: 640, videoHeight: 360 }, hit: true };
    const back = { video: { style: { zIndex: '2' }, videoWidth: 640, videoHeight: 360 }, hit: true };
    context.layerEntries.push(front, back);
    assert.equal(context.hit(point), front.video);
    context.video.style.zIndex = '11';
    assert.equal(context.hit(point), context.video);
    assert.equal(context.hit({ clientX: 200, clientY: 200 }), front.video, 'outside the scaled cut exposes the lower track');
    context.video.style.zIndex = '1';
    front.video.style.display = 'none';
    assert.equal(context.hit(point), back.video);
    back.hit = false;
    assert.equal(context.hit(point), context.video, 'outside the crop geometry exposes the cut');
    assert.equal(context.hit({ clientX: 200, clientY: 200 }), null);
    front.video.style.display = '';
    front.video.videoWidth = 0;
    assert.equal(context.hit(point), context.video, 'unmeasured media is not selectable');
    front.video.naturalWidth = 640;
    front.video.naturalHeight = 360;
    front.video.videoHeight = 0;
    assert.equal(context.hit(point), front.video, 'still images use their natural dimensions');
});
