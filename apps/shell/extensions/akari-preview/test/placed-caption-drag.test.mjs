import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { placedCaptionPositionFromRects } from '../lib/common/caption-zone-write.js';

const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
function section(start, end) {
    const from = source.indexOf(start), to = source.indexOf(end, from);
    assert.ok(from >= 0 && to > from);
    return source.slice(from, to);
}

test('actual drag listeners skip placed-text snaps, preserve anchors, and write the landing', async () => {
    for (const anchor of ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br']) {
        for (const [dx, dy] of [[315, 100], [-80, -85], [860, 100], [100, 265.5], [173.4, 128.35]]) {
            const listeners = new Map(), writes = [], guides = [];
            let pointerdown;
            const caption = { id: 'placed', timeDomain: 'output', textStyle: { text_anchor: anchor } };
            const plate = { style: {}, setPointerCapture() {}, hasPointerCapture: () => false };
            const original = { left: 100, right: 300, top: 100, bottom: 200 };
            const context = {
                captionLayer: { addEventListener: (_type, listener) => { pointerdown = listener; } },
                activeCaptionEdit: null, captionForEvent: () => caption,
                beginCaptionHandleDrag: () => false, selectCaption() {}, setCaptionGroupMode() {},
                captionClampEnabled: () => false, captionCuePositionKnown: new Map(),
                CLICK_THRESHOLD_PX: 4, selectionDragActive: false, pendingCaptionDragReload: false,
                captionOutputPoint: (x, y) => ({ x, y }),
                captionOutputFrame: () => ({ x: 0, y: 0, width: 1000, height: 500 }),
                captionVisualRect: () => {
                    const [x, y] = (plate.style.translate || '0 0').split(' ').map(parseFloat);
                    return { left: original.left + x, right: original.right + x, top: original.top + y, bottom: original.bottom + y };
                },
                placedCaptionPositionFromRects,
                captionCuePositionFromRects: () => { throw Error('speech resolver must not handle placed text'); },
                setCaptionDragGuides: value => guides.push(value), updateCaptionSelectBoxForRect() {}, updateCaptionSelectBox() {},
                window: {
                    addEventListener: (type, listener) => listeners.set(type, listener),
                    removeEventListener: type => listeners.delete(type),
                    akari: { computeOutputFrameRect: () => ({}), engine: { captionWrite: async (...args) => writes.push(args) }, showWriteError: error => { throw error; } }
                }, console
            };
            vm.runInNewContext(section("captionLayer.addEventListener('pointerdown', event =>", '            new ResizeObserver(() => updateCaptionSelectBox())'), context);
            pointerdown({ button: 0, target: { closest: selector => selector === '.caption-row-plate' ? plate : null },
                pointerId: 1, clientX: 200, clientY: 150, altKey: false, preventDefault() {}, stopPropagation() {} });
            listeners.get('pointermove')({ pointerId: 1, clientX: 200 + dx, clientY: 150 + dy });
            assert.ok(Math.abs(parseFloat(plate.style.translate) - dx) < 1e-8);
            const landed = context.captionVisualRect();
            listeners.get('pointerup')({ pointerId: 1 });
            await Promise.resolve();
            assert.equal(writes.length, 1);
            const saved = writes[0][1].plateTransform.cuePosition.value;
            assert.deepEqual(saved, placedCaptionPositionFromRects(landed, context.captionOutputFrame(), { anchor, clamp: false }));
            assert.equal(saved.anchor, anchor);
            assert.ok(guides.every(value => value === false));
        }
    }
});

test('clamp defaults to off only for declared output cues and an explicit toggle wins', () => {
    const context = vm.createContext({});
    vm.runInContext(section('const captionClampOverrides =', '            const captionCuePositionKnown ='), context);
    for (const timeDomain of ['output', 'source', undefined]) {
        context.caption = { id: 'c1', timeDomain };
        assert.equal(vm.runInContext('captionClampEnabled(caption)', context), timeDomain !== 'output');
    }
    vm.runInContext("captionClampOverrides.set('c1', false)", context);
    assert.equal(vm.runInContext('captionClampEnabled(caption)', context), false);
    context.caption.timeDomain = 'output';
    vm.runInContext("captionClampOverrides.set('c1', true)", context);
    assert.equal(vm.runInContext('captionClampEnabled(caption)', context), true);
});

test('inline editor has no second outline and uses an ink line rather than the full-width layout wrapper', () => {
    const rule = source.match(/\.caption-row-plate \[data-akari-caption-editing="true"\][^\n]+/)[0];
    assert.match(rule, /outline: none/);
    assert.match(rule, /caret-color: currentColor/);
    const edit = section('const beginCaptionEdit =', "captionLayer.addEventListener('dblclick'");
    assert.match(edit, /line.className = 'akari-caption__line'/);
    assert.match(edit, /layoutPlate.replaceChildren\(line\)/);
    assert.match(edit, /element.style.userSelect = 'text'/);
});

const compiled = readFileSync(new URL('../lib/browser/akari-preview-open-handler.js', import.meta.url), 'utf8');
function hostMethod(name, bindings = {}) {
    const start = compiled.search(new RegExp(`^    (?:async )?${name}\\(`, 'm'));
    const end = compiled.indexOf('\n    }', start);
    assert.ok(start >= 0 && end > start);
    const Host = vm.runInNewContext(`(class { ${compiled.slice(start, end + 6)} })`, bindings);
    return new Host();
}

test('write boundary accepts nine cue anchors and still rejects invalid anchors and group anchors', () => {
    const host = hostMethod('isCaptionWriteRequest');
    const request = patch => ({ type: 'akari-preview-caption-write', requestId: 'r1', captionId: 'c1', patch });
    for (const anchor of ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br', 'invalid']) {
        const value = { anchor, position: { x: .45, y: .52 } };
        assert.equal(host.isCaptionWriteRequest(request({ cuePosition: value })), anchor !== 'invalid');
        assert.equal(host.isCaptionWriteRequest(request({ plateTransform: {
            captionIds: ['c1'], scale: 1, rotate: 0, cuePosition: { captionId: 'c1', value }
        } })), anchor !== 'invalid');
        assert.equal(host.isCaptionWriteRequest(request({ groupPosition: value })), ['bc', 'tc'].includes(anchor));
    }
});

test('resolved captions retain original domains using source cue ids, not their normalized clocks', async () => {
    const captions = [
        { id: 'display-placed', sourceCueId: 'p1', start: 0, end: 2, text: 'placed' },
        { id: 'display-speech', sourceCueId: 's1', start: 0, end: 2, text: 'speech' }
    ];
    const host = hostMethod('loadPreviewCaptions', {
        akari_preview_captions_1: {
            loadCaptionDisplayFailOpen: async options => options.resolved(await options.resolve()),
            parseResolvedPreviewCaptions: value => value.captions
        }, console
    });
    host.readText = async () => JSON.stringify({ captions: [
        { id: 'p1', time_domain: 'output' }, { id: 's1', time_domain: 'source' }
    ] });
    host.currentWorkspaceRoots = async () => [];
    host.previewService = { resolveCaptionDisplay: async () => ({ captions }) };
    host.fileService = { exists: async () => true };
    const result = await host.loadPreviewCaptions('captions.json', 'edit.json');
    assert.deepEqual(Array.from(result.captions, cue => cue.timeDomain), ['output', 'source']);
    assert.ok(result.captions.every(cue => cue.clockDomain === 'output'));
});
