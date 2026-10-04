import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import vm from 'node:vm';
import { readHandlerSource } from './helpers/handler-source.mjs';
import { updateCaptionCuePositionsSource } from '../lib/common/caption-zone-write.js';
import { resolvePreviewItemWriteBatch } from '../../../../../packages/edit-store/lib/edit-v2-item-write.js';

const source = readHandlerSource();
const parsed = ts.createSourceFile('handler.ts', source, ts.ScriptTarget.Latest, true);
function hostMethod(name, bindings = {}) {
    const member = parsed.statements.filter(ts.isClassDeclaration)
        .flatMap(node => [...node.members]).find(node => node.name?.getText(parsed) === name);
    assert.ok(member, name);
    const code = ts.transpileModule(`class Host { ${member.getText(parsed)} }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2021 }
    }).outputText;
    return vm.runInNewContext(`${code}; new Host()`, bindings);
}
function declaration(name) {
    const start = source.indexOf(`const ${name} =`);
    const end = source.indexOf('\n            };', start);
    assert.ok(start >= 0 && end > start, name);
    return source.slice(start, end + 15);
}

test('batched caption write accepts center placement without x and rejects invalid x', () => {
    const host = hostMethod('isCaptionWriteRequest');
    const request = { type: 'akari-preview-caption-write', requestId: 'r1', captionId: 'c1',
        patch: { cuePositions: [
            { captionId: 'c1', value: { anchor: 'mc', position: { y: 0.5723 } } },
            { captionId: 'c2', value: { anchor: 'tl', position: { x: 0.25, y: 0.4 } } }
        ] } };
    assert.equal(host.isCaptionWriteRequest(request), true);
    const saved = JSON.parse(updateCaptionCuePositionsSource(JSON.stringify({ captions: [
        { id: 'c1', text: 'one', start: 0, end: 1 }, { id: 'c2', text: 'two', start: 0, end: 1 }
    ] }), request.patch.cuePositions));
    assert.deepEqual(saved.captions.map(cue => cue.text_style.position), [{ y: 0.5723 }, { x: 0.25, y: 0.4 }]);
    request.patch.cuePositions[0].value.position.x = Infinity;
    assert.equal(host.isCaptionWriteRequest(request), false);
});

test('host mixed move lints both destinations and submits one history command', async () => {
    const linted = [], commands = [], replies = [];
    const uri = text => ({ toString: () => text });
    const host = hostMethod('handleMixedMove', {
        resolvePreviewItemWriteBatch: (_before, writes) => {
            assert.deepEqual(writes.map(write => write.kind), ['layer', 'overlay']);
            return { candidateText: '{"version":2,"moved":true}' };
        }, updateCaptionCuePositionsSource
    });
    Object.assign(host, {
        readText: async file => file.toString().endsWith('edit.json') ? '{"version":2}' :
            JSON.stringify({ captions: [{ id: 'c1', text: 'one', start: 0, end: 1 }] }),
        previewService: { lintEditCandidate: async candidate => { linted.push(candidate.editUri); return { pass: true }; } },
        commandRegistry: { getCommand: () => true, executeCommand: async (...args) => { commands.push(args); return true; } },
        markRecentWrite() {}, queueCaptionsUpdate() {}, queueRefresh() {}
    });
    const widget = { akariPreviewEditUri: uri('file:///edit.json'),
        akariPreviewCaptionsUri: uri('file:///captions.json'), sendMessage: reply => replies.push(reply) };
    await host.handleMixedMove(widget, { requestId: 'r2', writes: [
        { kind: 'layer', itemId: 'image-2', patch: { transform: { x: 12, y: 14 } } },
        { kind: 'overlay', itemId: 'overlay-1', patch: { transform: { x: 8, y: 9 } } }
    ], cuePositions: [{ captionId: 'c1', value: { anchor: 'mc', position: { y: 0.6 } } }] });
    assert.deepEqual(linted, ['file:///edit.json', 'file:///captions.json']);
    assert.equal(commands.length, 1);
    assert.equal(commands[0][2].kind, 'mixed-move');
    assert.equal(JSON.parse(commands[0][2].captions.after).captions[0].text_style.position.y, 0.6);
    assert.equal(replies[0].ok, true);
});

test('one mixed drag writes photo and overlay to edit.json and text to captions.json', () => {
    const edit = JSON.stringify({ version: 2, output: { width: 1280, height: 720, fps: 30 },
        sources: [{ id: 'photo', path: 'assets/photo.png' }], tracks: [{ id: 'visual', lane: 'visual', items: [
            { id: 'image-2', at: 0, duration: 90, source: { kind: 'media', src: 'photo', in: 0, out: 3 } },
            { id: 'overlay-1', at: 0, duration: 90, source: { kind: 'html', path: 'overlays/title.html' } }
        ] }] });
    const moved = JSON.parse(resolvePreviewItemWriteBatch(edit, [
        { kind: 'layer', itemId: 'image-2', patch: { transform: { x: 20, y: 30 } } },
        { kind: 'overlay', itemId: 'overlay-1', patch: { transform: { x: 40, y: 50 } } }
    ]).candidateText);
    const captions = JSON.parse(updateCaptionCuePositionsSource(JSON.stringify({ captions: [
        { id: 'c-0002', text: 'title', start: 0, end: 2 }
    ] }), [{ captionId: 'c-0002', value: { anchor: 'mc', position: { y: 0.6 } } }]));
    assert.deepEqual(moved.tracks[0].items.map(item => item.transform), [{ x: 20, y: 30 }, { x: 40, y: 50 }]);
    assert.deepEqual(captions.captions[0].text_style.position, { y: 0.6 });
});

test('mixed selection draws a frame for every selected visual kind', () => {
    const elements = new Map(['caption:c1', 'layer:image-2', 'overlay:overlay-1'].map((key, i) => [key,
        { getBoundingClientRect: () => ({ left: 10 + i * 30, top: 20, width: 20, height: 10 }) }]));
    const children = [];
    const context = vm.createContext({
        selectedMixedGroup: [{ kind: 'layer', id: 'image-2' }, { kind: 'overlay', id: 'overlay-1' },
            { kind: 'caption', id: 'c1' }], mixedFrameLoop: true,
        mixedSelectionFrames: { replaceChildren() { children.length = 0; }, appendChild(node) { children.push(node); } },
        mixedSelectionElement: item => elements.get(`${item.kind}:${item.id}`),
        mixedSelectionRect: (_item, element) => element.getBoundingClientRect(),
        hasNativeMixedFrame: () => false,
        previewPane: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
        getComputedStyle: () => ({ visibility: 'visible' }),
        document: { createElement: () => ({ dataset: {}, style: {} }) }, requestAnimationFrame() {}
    });
    vm.runInContext(`${declaration('drawMixedSelectionFrames')}\ndrawMixedSelectionFrames();`, context);
    assert.deepEqual(children.map(node => node.dataset.akariMixedSelected),
        ['layer:image-2', 'overlay:overlay-1', 'caption:c1']);
});

test('host group handoff retains caption, layer and overlay selections together', () => {
    const calls = [];
    const context = vm.createContext({
        selectedMixedGroup: [], applyingMixedSelection: false, selectedCaptionIds: new Set(),
        mixedFrameLoop: false, mixedSelectionFrames: { replaceChildren() {} },
        window: { akari: { interaction: null } },
        selectLayer: id => calls.push(['layer', id]),
        selectCaption: id => calls.push(['caption', id]),
        applyRequestedOverlaySelection: () => calls.push(['overlay']),
        requestAnimationFrame() {}, drawMixedSelectionFrames() {}
    });
    vm.runInContext(`${declaration('applyMixedSelection')}\napplyMixedSelection([
        {kind:'layer',id:'image-2'}, {kind:'overlay',id:'overlay-1'}, {kind:'caption',id:'c-0002'}
    ]);`, context);
    assert.deepEqual(Array.from(context.selectedCaptionIds), ['c-0002']);
    assert.deepEqual(calls, [['layer', 'image-2'], ['caption', 'c-0002'], ['overlay']]);
    assert.equal(context.requestedOverlayId, 'overlay-1');
    assert.equal(context.selectedMixedGroup.length, 3);
    assert.match(source, /type: 'akari-preview-set-selected-group', selection/);
});

test('preview Shift and Ctrl clicks add unlike and same-kind items', () => {
    const after = source.indexOf('const mixedSelectionHit =');
    const start = source.indexOf("window.addEventListener('pointerdown', event => {", after);
    const end = source.indexOf('            }, true);', start);
    assert.ok(after >= 0 && start > after && end > start);
    let pointerDown;
    const reported = [];
    const context = vm.createContext({
        selectedMixedGroup: [], selectedCaptionId: null, selectedLayerId: null, suppressMixedClick: false,
        mixedSelectionHit: () => ({ kind: 'overlay', id: 'shape-3' }),
        applyMixedSelection: group => { context.selectedMixedGroup = group; },
        window: { akari: { interaction: { selectedId: 'overlay-1' },
            reportMixedSelection: group => reported.push(group.map(item => `${item.kind}:${item.id}`)) },
        addEventListener: (_type, callback) => { pointerDown = callback; } }
    });
    vm.runInContext(source.slice(start, end + '            }, true);'.length), context);
    const event = keys => ({ button: 0, shiftKey: false, ctrlKey: false, metaKey: false,
        preventDefault() {}, stopImmediatePropagation() {}, ...keys });
    pointerDown(event({ ctrlKey: true }));
    assert.deepEqual(Array.from(reported[0]), ['overlay:overlay-1', 'overlay:shape-3']);
    context.mixedSelectionHit = () => ({ kind: 'caption', id: 'c-0002' });
    pointerDown(event({ shiftKey: true }));
    assert.deepEqual(Array.from(reported[1]), ['overlay:overlay-1', 'overlay:shape-3', 'caption:c-0002']);
});

test('invalid caption writes receive an explicit failure response', () => {
    assert.match(source, /if \(message\?\.type === 'akari-preview-caption-write'\) \{\s*if \(!this\.isCaptionWriteRequest\(message\)\)/);
    assert.match(source, /type: 'akari-preview-caption-write-response', requestId: message\.requestId,\s*ok: false/);
});

test('mixed finish saves caption and edit positions, then restores live translations', async () => {
    const visualRect = source.indexOf('const captionVisualRect =');
    assert.ok(source.indexOf('const frameCaptionPosition =', visualRect)
        < source.indexOf('const captionLayoutRect =', visualRect), 'frame placement must be in the shared scope');
    const start = source.indexOf('const finish = async cancelled => {', source.indexOf('const mixedSelectionElement ='));
    const end = source.indexOf('                const up = next =>', start);
    assert.ok(start > 0 && end > start);
    const saved = [];
    const gestures = [];
    const errors = [];
    const captionElement = { style: { translate: '4px 5px' } };
    const layerElement = { style: { translate: '' } };
    const overlayElement = { style: { translate: '' } };
    const rows = [
        { item: { kind: 'caption', id: 'c1' }, element: captionElement,
            rect: { left: 10, right: 30, top: 20, bottom: 40 }, layoutRect: {}, captionTransform: {},
            translate: { x: 4, y: 5 } },
        { item: { kind: 'layer', id: 'image-2' }, element: layerElement, translate: { x: 0, y: 0 } },
        { item: { kind: 'overlay', id: 'overlay-1' }, element: overlayElement, translate: { x: 0, y: 0 } }
    ];
    const context = vm.createContext({
        stop() {}, restore() { for (const row of rows) row.element.style.translate = row.translate.x || row.translate.y
            ? `${row.translate.x}px ${row.translate.y}px` : ''; },
        moved: true, finished: false, suppressMixedClick: false, rows, delta: { x: 10, y: 12 },
        captions: [{ id: 'c1', textStyle: { text_anchor: 'mc' }, timeDomain: 'output' }],
        frameCaptionPosition: (_caption, position) => position,
        captionPositionFromVisualRect: movedRect => ({ anchor: 'mc', position: { y: movedRect.top / 100 } }),
        captionOutputFrame: () => ({}), captionClampEnabled: () => true,
        findLayerEntry: () => ({ spec: { transform: { x: 1, y: 2 } } }),
        summary: { overlays: [{ id: 'overlay-1', transform: { x: 3, y: 4 } }] },
        window: { akari: {
            engine: { mixedMove: async (...args) => saved.push(args) },
            reportGesture: event => gestures.push(event), showWriteError: error => errors.push(error)
        } }
    });
    vm.runInContext(`${source.slice(start, end)}\nthis.finish = finish;`, context);
    await context.finish(false);
    await context.finish(false);
    assert.equal(errors.length, 0);
    assert.equal(saved.length, 1);
    assert.deepEqual(Array.from(saved[0][0], write => [write.kind, write.itemId, write.patch.transform.x,
        write.patch.transform.y]), [['layer', 'image-2', 11, 14], ['overlay', 'overlay-1', 13, 16]]);
    assert.equal(saved[0][1][0].value.position.y, 0.32);
    const edit = JSON.stringify({ version: 2, output: { width: 1280, height: 720, fps: 30 },
        sources: [{ id: 'photo', path: 'assets/photo.png' }], tracks: [{ id: 'visual', lane: 'visual', items: [
            { id: 'image-2', at: 0, duration: 90, source: { kind: 'media', src: 'photo', in: 0, out: 3 } },
            { id: 'overlay-1', at: 0, duration: 90, source: { kind: 'html', path: 'overlays/title.html' } }
        ] }] });
    const reloadedEdit = JSON.parse(resolvePreviewItemWriteBatch(edit, saved[0][0]).candidateText);
    const reloadedCaptions = JSON.parse(updateCaptionCuePositionsSource(JSON.stringify({ captions: [
        { id: 'c1', text: 'one', start: 0, end: 1 }
    ] }), saved[0][1]));
    assert.deepEqual(reloadedEdit.tracks[0].items.map(item => item.transform),
        [{ x: 11, y: 14 }, { x: 13, y: 16 }]);
    assert.equal(reloadedCaptions.captions[0].text_style.position.y, 0.32);
    assert.deepEqual(gestures, ['saved', 'end']);
    assert.deepEqual(rows.map(row => row.element.style.translate), ['4px 5px', '', '']);
});

test('a mixed pointerdown consumes the native caption drag and begins one gesture', () => {
    const start = source.indexOf("window.addEventListener('pointerdown', event => {",
        source.indexOf('            let suppressMixedClick = false;'));
    const end = source.indexOf('            }, true);', start);
    assert.ok(start > 0 && end > start);
    const gestures = [];
    const element = { style: { translate: '' }, getBoundingClientRect: () => ({ left: 0, right: 20, top: 0, bottom: 20 }) };
    const context = vm.createContext({
        selectedMixedGroup: [{ kind: 'caption', id: 'c1' }, { kind: 'layer', id: 'image-2' }],
        mixedSelectionHit: () => ({ kind: 'caption', id: 'c1' }),
        mixedSelectionElement: () => element,
        captionOutputPoint: () => ({ x: 0, y: 0 }),
        captionVisualRect: () => ({ left: 0, right: 20, top: 0, bottom: 20 }),
        captionLayoutRect: () => ({}), captionTransformValues: () => ({}),
        window: { akari: { reportGesture: event => gestures.push(event) },
            addEventListener(type, listener) { if (type === 'pointerdown') this.mixedDown = listener; } }
    });
    vm.runInContext(source.slice(start, end + '            }, true);'.length), context);
    const event = { button: 0, pointerId: 1, shiftKey: false, ctrlKey: false, metaKey: false,
        stopped: false, preventDefault() {}, stopImmediatePropagation() { this.stopped = true; } };
    context.window.mixedDown(event);
    if (!event.stopped) gestures.push('begin'); // native caption handler on the target
    assert.deepEqual(gestures, ['begin']);
    assert.equal(event.stopped, true);
    assert.match(source, /const onCaptionPointerDown = event => \{[\s\S]*?if \(typeof selectedMixedGroup !== 'undefined' && selectedMixedGroup\.length > 1/);
});

test('caption drag excerpts provide their own frame placement helper', () => {
    const handleStart = source.indexOf('const beginCaptionHandleDrag =');
    const pointerStart = source.indexOf('const onCaptionPointerDown =', handleStart);
    const handle = source.slice(handleStart, pointerStart);
    const pointer = source.slice(pointerStart, source.indexOf('            captionLayer.addEventListener', pointerStart));
    assert.match(handle, /const frameCaptionPosition = \(candidate, value\) =>/);
    assert.match(pointer, /const frameCaptionPosition = \(candidate, value\) =>/);
});

test('caption-only multi-selection reaches the native caption drag', () => {
    const start = source.indexOf('const onCaptionPointerDown = event => {');
    const end = source.indexOf('                if (activeCaptionEdit) return;', start);
    assert.ok(start > 0 && end > start);
    const plate = { dataset: { captionKey: 'c1' } };
    const event = { shiftKey: false, ctrlKey: false, metaKey: false,
        target: { closest: selector => selector === '.caption-row-plate' ? plate : null } };
    const run = group => {
        let reached = false;
        vm.runInNewContext(`${source.slice(start, end)}\nreached(); }; onCaptionPointerDown(event);`, {
            selectedMixedGroup: group,
            captionRows: new Map([['c1', { caption: { id: 'c1' } }]]), event,
            reached: () => { reached = true; }
        });
        return reached;
    };
    assert.equal(run([{ kind: 'caption', id: 'c1' }, { kind: 'caption', id: 'c2' }]), true);
    assert.equal(run([{ kind: 'caption', id: 'c1' }, { kind: 'layer', id: 'image-2' }]), false);
});

test('overlay frames and shape surfaces are modifier selection hits', () => {
    const hit = declaration('mixedSelectionHit');
    class ElementMock {
        constructor(matches) { this.matches = matches; }
        closest(selector) { return this.matches[selector] ?? null; }
    }
    const context = vm.createContext({ Element: ElementMock,
        window: { akari: { interaction: { selectedId: 'overlay-1' } } },
        captionRows: new Map(), selectedCaptionId: null, selectedLayerId: null });
    vm.runInContext(`${hit}\nthis.hit = mixedSelectionHit;`, context);
    const selectedFrame = new ElementMock({ '[data-akari-interaction="selection-frame"]': {} });
    const shape = new ElementMock({ '[data-overlay-id]': { dataset: { overlayId: 'shape-3' } } });
    assert.equal(context.hit({ target: selectedFrame }).id, 'overlay-1');
    assert.equal(context.hit({ target: shape }).id, 'shape-3');
    const group = [{ kind: 'overlay', id: 'overlay-1' }];
    const toggled = group.filter(item => item.id !== context.hit({ target: selectedFrame }).id);
    assert.deepEqual(toggled, []);
});

test('canvas visual hit adds a photo layer and rejects a cut', () => {
    class ElementMock {
        constructor(id, matches = {}) { this.id = id; this.matches = matches; }
        closest(selector) { return this.matches[selector] ?? null; }
    }
    const stage = new ElementMock('preview-stage');
    const canvas = new ElementMock('frame-engine-canvas');
    let media = { dataset: { akariLayerId: 'image-2' } };
    const context = vm.createContext({ Element: ElementMock, previewStage: stage,
        window: { akari: { interaction: { selectedId: null } } },
        captionRows: new Map(), selectedCaptionId: null, selectedLayerId: null,
        findVisualMediaHitAt: () => media });
    vm.runInContext(`${declaration('mixedSelectionHit')}\nthis.hit = mixedSelectionHit;`, context);
    assert.deepEqual(JSON.parse(JSON.stringify(context.hit({ target: stage }))),
        { kind: 'layer', id: 'image-2' });
    assert.equal(context.hit({ target: canvas }).id, 'image-2');
    media = { dataset: { akariCutId: 'cut-1' } };
    assert.equal(context.hit({ target: canvas }), null);
});

test('a missing shape selection-tree node cannot erase a mixed group', () => {
    const start = source.indexOf('const reportOverlaySelectionChange =');
    const end = source.indexOf("            window.addEventListener('akari-preview-scope-selection'", start);
    assert.ok(start > 0 && end > start);
    const reports = [];
    const context = vm.createContext({
        stage: { querySelector: () => null },
        window: { akari: { interaction: { hasSelectionTree: true, selectedId: null, selectedIds: [] },
            reportOverlaySelection: value => reports.push(value) } },
        selectedMixedGroup: [{ kind: 'layer', id: 'image-2' }, { kind: 'overlay', id: 'shape-3' }],
        requestedOverlayId: 'shape-3', applyingMixedSelection: false,
        lastReportedOverlayId: 'shape-3', lastReportedOverlayIds: ['shape-3'],
        selectLayer() { throw new Error('group cleared'); }, deselectCut() { throw new Error('group cleared'); },
        deselectCaption() { throw new Error('group cleared'); }
    });
    vm.runInContext(`${source.slice(start, end)}\nthis.report = reportOverlaySelectionChange;`, context);
    context.report();
    context.report(true, false);
    assert.equal(context.selectedMixedGroup.length, 2);
    assert.deepEqual(reports, []);
    context.selectedMixedGroup = [{ kind: 'overlay', id: 'shape-3' }];
    context.lastReportedOverlayId = 'shape-3';
    context.report();
    assert.equal(context.selectedMixedGroup.length, 1);
    assert.deepEqual(reports, []);
});

test('Shift, Ctrl and Meta toggle overlays without losing other selected kinds', () => {
    const after = source.indexOf('const mixedSelectionHit =');
    const start = source.indexOf("window.addEventListener('pointerdown', event => {", after);
    const end = source.indexOf('            }, true);', start);
    let onDown;
    let hit = { kind: 'overlay', id: 'shape-3' };
    const context = vm.createContext({
        selectedMixedGroup: [{ kind: 'caption', id: 'c-0002' }, { kind: 'layer', id: 'image-2' },
            { kind: 'overlay', id: 'overlay-1' }],
        suppressMixedClick: false,
        mixedSelectionHit: () => hit,
        applyMixedSelection: group => { context.selectedMixedGroup = group; },
        window: { akari: { reportMixedSelection() {} }, addEventListener: (_type, callback) => { onDown = callback; } }
    });
    vm.runInContext(source.slice(start, end + '            }, true);'.length), context);
    const click = keys => onDown({ button: 0, shiftKey: false, ctrlKey: false, metaKey: false,
        preventDefault() {}, stopImmediatePropagation() {}, ...keys });
    click({ shiftKey: true });
    assert.deepEqual(Array.from(context.selectedMixedGroup, item => item.id),
        ['c-0002', 'image-2', 'overlay-1', 'shape-3']);
    click({ ctrlKey: true });
    assert.deepEqual(Array.from(context.selectedMixedGroup, item => item.id),
        ['c-0002', 'image-2', 'overlay-1']);
    hit = { kind: 'overlay', id: 'overlay-1' };
    click({ metaKey: true });
    assert.deepEqual(Array.from(context.selectedMixedGroup, item => item.id), ['c-0002', 'image-2']);
});

test('mixed finish reports preparation failures and always ends the gesture', async () => {
    const start = source.indexOf('const finish = async cancelled => {', source.indexOf('const mixedSelectionElement ='));
    const end = source.indexOf('                const up = next =>', start);
    const gestures = [], errors = [];
    const row = { item: { kind: 'caption', id: 'c1' }, element: { style: { translate: '20px 20px' } },
        rect: { left: 0, right: 10, top: 0, bottom: 10 }, layoutRect: {}, captionTransform: {},
        translate: { x: 0, y: 0 } };
    const context = vm.createContext({ stop() {}, restore() { row.element.style.translate = ''; }, finished: false,
        moved: true, rows: [row], delta: { x: 10, y: 10 }, captions: [{ id: 'c1', textStyle: {} }],
        frameCaptionPosition() { throw new ReferenceError('position unavailable'); },
        captionPositionFromVisualRect: () => ({ anchor: 'mc', position: { y: 0.5 } }),
        captionOutputFrame: () => ({}), captionClampEnabled: () => false,
        window: { akari: { engine: { mixedMove() { throw new Error('unexpected write'); } },
            reportGesture: event => gestures.push(event), showWriteError: error => errors.push(error) } } });
    vm.runInContext(`${source.slice(start, end)}\nthis.finish = finish;`, context);
    await context.finish(false);
    assert.equal(errors.length, 1);
    assert.equal(row.element.style.translate, '');
    assert.deepEqual(gestures, ['end']);
});

test('mixed frame geometry uses visible caption ink and overlay fragment bounds', () => {
    const start = source.indexOf('const mixedSelectionRect =');
    const end = source.indexOf('            const hasNativeMixedFrame =', start);
    const caption = { querySelector: () => ({ getBoundingClientRect: () =>
        ({ left: 100, top: 200, right: 190, bottom: 225 }) }), querySelectorAll: () => [] };
    const overlay = {};
    const context = vm.createContext({ window: { akari: { interaction: { fragmentBounds: () =>
        ({ left: 50, top: 60, width: 35, height: 20 }) } } } });
    vm.runInContext(`${source.slice(start, end)}\nthis.rect = mixedSelectionRect;`, context);
    assert.deepEqual(JSON.parse(JSON.stringify(context.rect({ kind: 'caption' }, caption))),
        { left: 100, top: 200, width: 90, height: 25 });
    assert.equal(context.rect({ kind: 'overlay' }, overlay).width, 35);
    assert.match(source, /if \(hasNativeMixedFrame\(item\)\) continue/);
    const native = vm.createContext({
        selectedCaptionId: 'c1', selectedLayerId: 'image-2',
        captionSelectBox: { classList: { contains: () => true },
            getBoundingClientRect: () => ({ width: 20, height: 10 }) },
        layerSelectBox: { classList: { contains: () => true },
            getBoundingClientRect: () => ({ width: 20, height: 10 }) },
        window: { akari: { interaction: { selectedId: 'overlay-1' } } },
        document: { querySelector: () => ({ getBoundingClientRect: () => ({ width: 30, height: 15 }) }) },
        getComputedStyle: () => ({ display: 'block', visibility: 'visible' })
    });
    vm.runInContext(`${declaration('nativeMixedFrameVisible')}\n${declaration('hasNativeMixedFrame')}
        this.hasNative = hasNativeMixedFrame;`, native);
    assert.equal(native.hasNative({ kind: 'caption', id: 'c1' }), true);
    assert.equal(native.hasNative({ kind: 'layer', id: 'image-2' }), true);
    assert.equal(native.hasNative({ kind: 'overlay', id: 'overlay-1' }), true);
    native.document.querySelector = () => ({ getBoundingClientRect: () => ({ width: 0, height: 0 }) });
    assert.equal(native.hasNative({ kind: 'overlay', id: 'overlay-1' }), false);
});
