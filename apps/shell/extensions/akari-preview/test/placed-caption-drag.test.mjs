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

test('actual drag listeners share snapping, preserve placed anchors, and write the landing', async () => {
    for (const anchor of ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br']) {
        for (const [dx, dy] of [[315, 100], [-80, -85], [860, 100], [100, 265.5], [173.4, 128.35]]) {
            const listeners = new Map(), writes = [], guides = [];
            let pointerdown;
            const caption = { id: 'placed', timeDomain: 'output', textStyle: { text_anchor: anchor } };
            const plate = { style: {}, setPointerCapture() {}, hasPointerCapture: () => false };
            const original = { left: 100, right: 300, top: 100, bottom: 200 };
            const context = {
                captionLayer: { addEventListener: (_type, listener) => { pointerdown = listener; } },
                captionGroupToolEnabled: false, captionSnapEnabled: true,
                selectedCaptionIds: new Set(['placed']), captions: [caption],
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
                updateCaptionSelectBoxForRect() {}, updateCaptionSelectBox() {},
                window: {
                    addEventListener: (type, listener) => listeners.set(type, listener),
                    removeEventListener: type => listeners.delete(type),
                    akari: { computeOutputFrameRect: () => ({}),
                        interaction: { computeSnapCorrection: () => ({ x: null, y: null }),
                            showSnapGuides: () => guides.push(true), hideSnapGuides: () => guides.push(false) },
                        engine: { captionWrite: async (...args) => writes.push(args) }, showWriteError: error => { throw error; } }
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
            // ドラッグは位置だけを送る（scale / rotate は送らない = 回転の保存直後のドラッグで古い値に戻さない）
            assert.deepEqual(Object.keys(writes[0][1]), ['cuePosition']);
            const saved = writes[0][1].cuePosition;
            assert.deepEqual(saved, placedCaptionPositionFromRects(landed, context.captionOutputFrame(), { anchor, clamp: false }));
            assert.equal(saved.anchor, anchor);
            assert.equal(guides.at(-1), false);
        }
    }
});

test('clamp defaults to off for every caption and an explicit toggle wins', () => {
    const context = vm.createContext({});
    vm.runInContext(section('const captionClampOverrides =', '            const captionCuePositionKnown ='), context);
    for (const timeDomain of ['output', 'source', undefined]) {
        context.caption = { id: 'c1', timeDomain };
        assert.equal(vm.runInContext('captionClampEnabled(caption)', context), false);
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

test('output cues keep a frame-relative plate width and unbounded single lines at every x', () => {
    const plateRule = source.match(/\.caption-row-plate\[data-output-caption\] \.akari-caption__plate \{[^}]+\}/)?.[0];
    const lineRule = source.match(/\.caption-row-plate\[data-output-caption\] \.akari-caption__line[^\n]+/)?.[0];
    assert.match(plateRule, /width: 92%; right: auto/);
    assert.match(lineRule, /max-width: none; flex-shrink: 0/);
    assert.match(section('const renderCaptionRow =', '            const renderCaption ='), /caption\?\.timeDomain === 'output'/);
    assert.equal((source.match(/\.caption-row-plate\[data-output-caption\]/g) ?? []).length, 3);
});

test('renderCaptionRow clears output-only styling when the caption is absent', () => {
    const context = {
        activeCaptionEdit: null,
        applyCaptionStyleVars() {},
        applyCaptionRowSelectionAttrs() {},
        captionEntryAnimationsSettledFn: () => true,
        window: { akari: { interaction: { syncOverlayHitRegion() {} } } }
    };
    const renderCaptionRow = vm.runInNewContext(`${section('const renderCaptionRow =', '            const renderCaption = () =>')} renderCaptionRow`, context);
    for (const caption of [undefined, null]) {
        const plate = {
            dataset: { outputCaption: '' },
            classList: { toggle(name, enabled) { assert.equal(name, 'akari-caption-host--styled'); assert.equal(enabled, false); } },
            innerHTML: 'previous caption'
        };
        const row = { plate, renderedCaption: { id: 'previous' }, styledCaptionActive: true, captionHitRegionPending: false };
        assert.doesNotThrow(() => renderCaptionRow(caption, row));
        assert.equal(Object.hasOwn(plate.dataset, 'outputCaption'), false);
        assert.equal(plate.innerHTML, '');
        assert.equal(row.styledCaptionActive, false);
    }
});

const compiled = readFileSync(new URL('../lib/browser/akari-preview-open-handler.js', import.meta.url), 'utf8');
function hostMethod(name, bindings = {}) {
    const start = compiled.search(new RegExp(`^    (?:async )?${name}\\(`, 'm'));
    const end = compiled.indexOf('\n    }', start);
    assert.ok(start >= 0 && end > start);
    const Host = vm.runInNewContext(`(class { ${compiled.slice(start, end + 6)} })`, bindings);
    return new Host();
}

test('write boundary accepts nine anchors and unbounded finite positions', () => {
    const host = hostMethod('isCaptionWriteRequest');
    const request = patch => ({ type: 'akari-preview-caption-write', requestId: 'r1', captionId: 'c1', patch });
    for (const anchor of ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br', 'invalid']) {
        const value = { anchor, position: { x: .45, y: .52 } };
        assert.equal(host.isCaptionWriteRequest(request({ cuePosition: value })), anchor !== 'invalid');
        assert.equal(host.isCaptionWriteRequest(request({ plateTransform: {
            captionIds: ['c1'], scale: 1, rotate: 0, cuePosition: { captionId: 'c1', value }
        } })), anchor !== 'invalid');
        assert.equal(host.isCaptionWriteRequest(request({ groupPosition: value })), anchor !== 'invalid');
    }
    assert.equal(host.isCaptionWriteRequest(request({ cuePosition: {
        anchor: 'bc', position: { x: -2.4, y: 3.2 }
    } })), true);
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
    host.lastLoadedCaptions = new Map();
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

test('partial JSON keeps the last captions; a valid empty file or deletion clears them', async () => {
    let sourceText = JSON.stringify({ captions: [{ id: 'p1', time_domain: 'output' }] });
    let exists = true;
    const host = hostMethod('loadPreviewCaptions', {
        akari_preview_captions_1: {
            loadCaptionDisplayFailOpen: async options => options.resolved(await options.resolve()),
            parseResolvedPreviewCaptions: value => value.captions
        }, console: { warn() {} }, setTimeout
    });
    host.lastLoadedCaptions = new Map();
    host.readText = async () => {
        if (!exists) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        return sourceText;
    };
    host.currentWorkspaceRoots = async () => [];
    host.previewService = { resolveCaptionDisplay: async () => ({ captions: JSON.parse(sourceText).captions
        .map(row => ({ id: row.id, sourceCueId: row.id, start: 0, end: 2, text: row.id })) }) };
    host.fileService = { exists: async () => exists };
    const initial = await host.loadPreviewCaptions('captions.json', 'edit.json');
    sourceText = '{"captions":[{"id":"p';
    const duringWrite = await host.loadPreviewCaptions('captions.json', 'edit.json');
    assert.deepEqual(Array.from(duringWrite.captions, cue => cue.id), ['p1']);
    assert.strictEqual(duringWrite, initial);
    sourceText = '{"captions":[]}';
    assert.deepEqual(Array.from((await host.loadPreviewCaptions('captions.json', 'edit.json')).captions), []);
    sourceText = JSON.stringify({ captions: [{ id: 'p2', time_domain: 'output' }] });
    assert.deepEqual(Array.from((await host.loadPreviewCaptions('captions.json', 'edit.json')).captions,
        cue => cue.id), ['p2']);
    sourceText = '';
    const duringTruncate = host.loadPreviewCaptions('captions.json', 'edit.json');
    setTimeout(() => { sourceText = JSON.stringify({ captions: [{ id: 'p3', time_domain: 'output' }] }); }, 20);
    assert.deepEqual(Array.from((await duringTruncate).captions, cue => cue.id), ['p3']);
    sourceText = '';
    assert.deepEqual(Array.from((await host.loadPreviewCaptions('captions.json', 'edit.json')).captions), []);
    sourceText = JSON.stringify({ captions: [{ id: 'p4', time_domain: 'output' }] });
    assert.deepEqual(Array.from((await host.loadPreviewCaptions('captions.json', 'edit.json')).captions,
        cue => cue.id), ['p4']);
    exists = false;
    sourceText = '';
    assert.deepEqual(Array.from((await host.loadPreviewCaptions('captions.json', 'edit.json')).captions), []);
    assert.equal(host.lastLoadedCaptions.size, 0);
});
