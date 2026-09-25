import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

import {
    captionCuePositionFromRects,
    captionPositionFromVisualRect,
    placedCaptionPositionFromRects
} from '../lib/common/caption-zone-write.js';
import { captionWrapWidthDrag, captionCornerTransform } from '../lib/common/caption-plate-handles.js';
import { captionWrapPosition } from '../lib/common/caption-wrap-position.js';

const require = createRequire(new URL('../../../package.json', import.meta.url));
const { minify } = require('terser');
const { transformSync } = require('esbuild');

const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const start = source.indexOf('const roundCaptionRatioUnclamped =');
const end = source.indexOf('const updateCaptionSelectBox =', start);
assert.ok(start >= 0 && end > start);
const definitions = source.slice(start, end)
    .replace('${captionPositionFromVisualRect.toString()}', captionPositionFromVisualRect.toString())
    .replace('${placedCaptionPositionFromRects.toString()}', placedCaptionPositionFromRects.toString())
    .replace('${captionWrapWidthDrag.toString()}', captionWrapWidthDrag.toString())
    .replace('${captionWrapPosition.toString()}', captionWrapPosition.toString())
    .replace('${captionCornerTransform.toString()}', captionCornerTransform.toString());

function webviewFunctions() {
    return webviewContext().captionGeometry;
}

function webviewContext() {
    const context = vm.createContext({});
    vm.runInContext(`${definitions}\nglobalThis.captionGeometry = {
        captionCuePositionFromRects, placedCaptionPositionFromRects,
        captionPositionFromVisualRect, captionGroupPositionFromRects
    };`, context);
    return context;
}

const plain = value => JSON.parse(JSON.stringify(value));

test('toString-injected position functions work alone after esbuild and terser minification', async () => {
    const frame = { x: 10, y: 20, width: 1000, height: 500 };
    const layout = { left: 140, right: 340, top: 160, bottom: 240 };
    const rects = [layout,
        { left: -80, right: 120, top: -35, bottom: 45 },
        { left: -100, right: 1200, top: -90, bottom: 610 }
    ];
    const injected = [captionPositionFromVisualRect, placedCaptionPositionFromRects];
    for (const original of injected) {
        const standalone = new Function(`return (${original.toString()})`)();
        const result = await minify(`globalThis.injected = (${original.toString()});`, {
            compress: true, mangle: { toplevel: true }
        });
        const minified = new Function('globalThis', `${result.code}; return globalThis.injected;`)({});
        const esbuildCode = transformSync(`globalThis.injected = (${original.toString()});`, {
            minify: true, target: 'es2022'
        }).code;
        const esbuildMinified = new Function('globalThis', `${esbuildCode}; return globalThis.injected;`)({});
        for (const candidate of [standalone, minified, esbuildMinified]) {
            for (const anchor of [undefined, 'tl', 'mc', 'bc', 'br']) {
                for (const clamp of [false, true]) {
                    for (const rect of rects) {
                        if (original === placedCaptionPositionFromRects && anchor === undefined) continue;
                        const options = { anchor, clamp };
                        if (original === placedCaptionPositionFromRects) {
                            assert.deepEqual(candidate(rect, frame, options), original(rect, frame, options));
                            continue;
                        }
                        for (const timeDomain of ['source', 'output']) {
                            if (anchor === undefined && timeDomain === 'output') continue;
                            for (const [scale, rotate, visual] of [
                                [1, 0, rect], [0.7, 0, rect], [1.5, 15, rect], [1, 90, rect]
                            ]) {
                                if (anchor === undefined && (scale !== 1 || rotate !== 0)) continue;
                                const transformOptions = { ...options, timeDomain, scale, rotate };
                                assert.deepEqual(candidate(visual, layout, frame, transformOptions),
                                    original(visual, layout, frame, transformOptions));
                            }
                        }
                    }
                }
            }
        }
    }
});

test('injected webview position functions match common for both time domains and transforms', () => {
    const webview = webviewFunctions();
    const frame = { x: 0, y: 0, width: 1000, height: 500 };
    const layout = { left: 120, right: 320, top: 160, bottom: 240 };
    for (const anchor of ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br']) {
        for (const clamp of [false, true]) {
            for (const timeDomain of ['source', 'output']) {
                for (const [scale, rotate, visual] of [
                    [1, 0, layout],
                    [1, 0, { left: -80, right: 120, top: -35, bottom: 45 }],
                    [1.5, 15, { left: 70, right: 370, top: 120, bottom: 280 }],
                    [1.5, 15, { left: -80, right: 220, top: -35, bottom: 125 }]
                ]) {
                    const options = { anchor, clamp, timeDomain, scale, rotate };
                    const expected = captionPositionFromVisualRect(visual, layout, frame, options);
                    const actual = plain(webview.captionPositionFromVisualRect(visual, layout, frame, options));
                    assert.deepEqual(actual, expected, `${timeDomain} ${anchor} ${clamp} ${scale} ${rotate}`);
                }
                for (const rect of [layout,
                    { left: -80, right: 120, top: -35, bottom: 45 },
                    { left: -100, right: 1200, top: -90, bottom: 610 }
                ]) {
                    const legacy = timeDomain === 'output'
                        ? placedCaptionPositionFromRects(rect, frame, { anchor, clamp })
                        : captionCuePositionFromRects(rect, frame, { anchor, clamp });
                    const local = timeDomain === 'output'
                        ? webview.placedCaptionPositionFromRects(rect, frame, { anchor, clamp })
                        : webview.captionCuePositionFromRects(rect, frame, { anchor, clamp });
                    assert.deepEqual(plain(local), legacy, `${timeDomain} legacy ${anchor} ${clamp}`);
                }
            }
        }
    }
});

test('injected listener saves single, multi and group drags for plain and transformed speech', async () => {
    const listenerSource = source.slice(
        source.indexOf("captionLayer.addEventListener('pointerdown', event =>"),
        source.indexOf('            new ResizeObserver(() => updateCaptionSelectBox())')
    );
    assert.match(listenerSource, /captionPositionFromVisualRect\(/);
    for (const mode of ['single', 'multi', 'group']) {
        for (const [scale, rotate] of [[1, 0], [1.5, 15]]) {
            for (const clamp of [false, true]) {
                const context = webviewContext();
                const listeners = new Map();
                const writes = [];
                let pointerdown;
                const a = { id: 'a', timeDomain: 'source', textStyle: { text_anchor: 'bc' } };
                const b = { id: 'b', timeDomain: 'source', textStyle: { text_anchor: 'tc' } };
                const plateA = { style: {}, setPointerCapture() {}, hasPointerCapture: () => false };
                const plateB = { style: {}, setPointerCapture() {}, hasPointerCapture: () => false };
                const visualA = { left: 100, right: scale === 1 ? 300 : 410, top: 100, bottom: scale === 1 ? 180 : 250 };
                const visualB = { left: 400, right: scale === 1 ? 600 : 710, top: 200, bottom: scale === 1 ? 280 : 350 };
                const layoutA = { left: 100, right: 300, top: 100, bottom: 180 };
                const layoutB = { left: 400, right: 600, top: 200, bottom: 280 };
                const shifted = (base, plate) => {
                    const [dx, dy] = (plate.style.translate || '0 0').split(' ').map(parseFloat);
                    return { left: base.left + dx, right: base.right + dx,
                        top: base.top + dy, bottom: base.bottom + dy };
                };
                Object.assign(context, {
                    document: { body: { classList: { add() {}, remove() {} } } },
                    captionLayer: { addEventListener: (_name, listener) => { pointerdown = listener; } },
                    activeCaptionEdit: null, captionForEvent: () => a,
                    beginCaptionHandleDrag: () => false, selectCaption() {}, setCaptionGroupMode() {},
                    captionGroupToolEnabled: mode === 'group', captionSnapEnabled: false,
                    selectedCaptionIds: new Set(mode === 'multi' ? ['a', 'b'] : ['a']),
                    captions: [a, b], captionRows: new Map([
                        ['a', { caption: a, plate: plateA }], ['b', { caption: b, plate: plateB }]
                    ]),
                    captionClampEnabled: () => clamp, captionCuePositionKnown: new Map(),
                    CLICK_THRESHOLD_PX: 4, selectionDragActive: false, pendingCaptionDragReload: false,
                    captionOutputPoint: (x, y) => ({ x, y }),
                    captionOutputFrame: () => ({ x: 0, y: 0, width: 1000, height: 500 }),
                    captionVisualRect: (plate = plateA) => shifted(plate === plateA ? visualA : visualB, plate),
                    captionLayoutRect: (plate = plateA) => plate === plateA ? layoutA : layoutB,
                    captionTransformValues: () => ({ scale, rotate }),
                    updateCaptionSelectBoxForRect() {}, updateCaptionSelectBox() {},
                    window: {
                        addEventListener: (name, listener) => listeners.set(name, listener),
                        removeEventListener: name => listeners.delete(name),
                        akari: {
                            computeOutputFrameRect: () => ({}),
                            interaction: { hideSnapGuides() {} },
                            engine: { captionWrite: async (...args) => writes.push(args) },
                            showWriteError: error => { throw error; }
                        }
                    }, console
                });
                vm.runInContext(listenerSource, context);
                pointerdown({ button: 0, target: {
                    closest: selector => selector === '.caption-row-plate' ? plateA : null
                }, pointerId: 1, clientX: 200, clientY: 150, altKey: false,
                preventDefault() {}, stopPropagation() {} });
                listeners.get('pointermove')({ pointerId: 1, clientX: 220, clientY: 160, altKey: true });
                listeners.get('pointerup')({ pointerId: 1 });
                await Promise.resolve();
                assert.equal(writes.length, 1, `${mode} ${scale} ${clamp}`);
                const [id, payload] = writes[0];
                assert.equal(id, 'a');
                const expectedA = captionPositionFromVisualRect(
                    shifted(visualA, plateA), layoutA, context.captionOutputFrame(),
                    { anchor: 'bc', clamp: mode === 'group' ? false : clamp, scale, rotate }
                );
                if (mode === 'single') assert.deepEqual(plain(payload.cuePosition), expectedA);
                if (mode === 'group') assert.deepEqual(plain(payload.groupPosition), expectedA);
                if (mode === 'multi') {
                    assert.deepEqual(plain(payload.cuePositions[0]), { captionId: 'a', value: expectedA });
                    const expectedB = captionPositionFromVisualRect(
                        shifted(visualB, plateA), layoutB, context.captionOutputFrame(),
                        { anchor: 'tc', clamp, scale, rotate }
                    );
                    assert.deepEqual(plain(payload.cuePositions[1]), { captionId: 'b', value: expectedB });
                }
            }
        }
    }
});

test('injected group placement uses the same source resolver as a single or multi move', () => {
    const webview = webviewFunctions();
    const frame = { x: 0, y: 0, width: 1000, height: 500 };
    const layout = { left: 100, right: 300, top: 100, bottom: 180 };
    for (const [scale, rotate, visual] of [
        [1, 0, layout],
        [1.5, 15, { left: 50, right: 350, top: 70, bottom: 210 }]
    ]) {
        const transform = { scale, rotate };
        const expected = captionPositionFromVisualRect(visual, layout, frame,
            { anchor: 'bc', clamp: false, ...transform });
        assert.deepEqual(plain(webview.captionGroupPositionFromRects(
            visual, layout, frame, 'bc', transform
        )), expected);
    }
});
