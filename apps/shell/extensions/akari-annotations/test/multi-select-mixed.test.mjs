import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';

const model = readFileSync(new URL('../src/browser/timeline-selection-model.ts', import.meta.url), 'utf8');
const widget = readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');
const preview = readFileSync(new URL('../../akari-preview/src/browser/preview-script-bootstrap.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('selection.ts', model, ts.ScriptTarget.Latest, true);
const member = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'previewCaptionIds');
assert.ok(member);
const code = ts.transpileModule(member.getText(parsed).replace(/^export /, ''),
    { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
const { previewCaptionIds } = vm.runInNewContext(`${code}; ({ previewCaptionIds })`);

test('mixed timeline selection keeps the caption IDs among visual items', () => {
    assert.deepEqual(Array.from(previewCaptionIds([undefined, 'c-0002', undefined, 'c-0003', 'c-0002'])),
        ['c-0002', 'c-0003']);
    assert.match(widget, /this\.selectionModel\.selectedCaptionIds = this\.multiSelection\.length > 0\s*\? previewCaptionIds\(selectedCaptionIds\)/);
    assert.match(widget, /const captionIds = this\.multiSelection\.length > 0\s*\? selectedCaptionIds/);
    assert.match(widget, /'akari\.timeline\.groupSelectionChanged'/);
    assert.match(widget, /'akari\.preview\.mixedSelected'/);
});

test('mixed move uses the combined edit and captions history path', () => {
    assert.match(widget, /command\.kind === 'mixed-move'/);
    assert.match(widget, /resolvePreviewItemWriteBatch\(JSON\.stringify\(doc\), command\.writes\)/);
    assert.match(widget, /\{ captions: command\.captions \}/);
    assert.match(widget, /await this\.writeEditSnapshotGuarded\(before, options\?\.captions\?\.before\)/);
    assert.match(widget, /await this\.writeEditSnapshotGuarded\(after, options\?\.captions\?\.after\)/);
});

test('all six Shift selection orders keep caption, layer and overlay together', () => {
    const method = name => {
        const ast = ts.createSourceFile('widget.ts', widget, ts.ScriptTarget.Latest, true);
        const member = ast.statements.filter(ts.isClassDeclaration).flatMap(node => [...node.members])
            .find(node => node.name?.getText(ast) === name);
        assert.ok(member, name);
        return member.getText(ast);
    };
    const toggle = parsed.statements.find(node => ts.isFunctionDeclaration(node)
        && node.name?.text === 'togglePreviewSelection');
    assert.ok(toggle);
    const js = ts.transpileModule(`class Widget { ${method('toggleMultiSelection')}\n${method('publishPrimaryPreviewSelection')} }
        ${toggle.getText(parsed).replace(/^export /, '')}\nthis.Widget = Widget;`,
    { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
    const items = [
        { kind: 'caption', id: 'c-0002' },
        { kind: 'layer', id: 'image-2' },
        { kind: 'overlay', id: 'overlay-1' }
    ];
    const orders = [
        [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]
    ];
    for (const order of orders) {
        const events = [];
        const context = vm.createContext({
            window: { dispatchEvent: event => events.push(event) },
            CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
            TIMELINE_OVERLAY_SELECTED_EVENT: 'overlay', TIMELINE_LAYER_SELECTED_EVENT: 'layer',
            captionIdForTreeSelection: () => null
        });
        vm.runInContext(js, context);
        const instance = new context.Widget();
        Object.assign(instance, {
            selection: undefined, multiSelection: [], previewBagSelection: undefined,
            selectionModel: { inspectorOwner: null }, location: { editUri: { toString: () => 'file:///edit.json' } },
            layers: [{ id: 'image-2' }], cutItemIds: [],
            selectionKey: item => `${item?.kind}:${item?.id}`,
            claimInspectorOwner() {}, pushSelectionSnapshot() {}, applySelectionClass() {},
            applyCaptionStateClasses() {}, rawKeyframeItem: () => null
        });
        for (const index of order) instance.toggleMultiSelection(items[index]);
        assert.equal(instance.multiSelection.length, 3, `order ${order}`);
        const final = events.at(-1);
        assert.equal(final.type, 'akari.timeline.groupSelectionChanged', `order ${order}`);
        assert.deepEqual(new Set(final.detail.selection.map(item => `${item.kind}:${item.id}`)),
            new Set(['caption:c-0002', 'layer:image-2', 'overlay:overlay-1']));
        assert.equal(events.filter(event => event.type === 'akari.timeline.primarySelected').length, 1,
            `group events must not echo a primary selection for ${order}`);
    }
});

test('all 12 preview pair selections reach the timeline and keep two preview frames', () => {
    const ast = ts.createSourceFile('widget.ts', widget, ts.ScriptTarget.Latest, true);
    const member = name => {
        const value = ast.statements.filter(ts.isClassDeclaration).flatMap(node => [...node.members])
            .find(node => node.name?.getText(ast) === name);
        assert.ok(value, name);
        return value.getText(ast);
    };
    const js = ts.transpileModule(`class Widget { ${member('applyPreviewMixedSelection')}
        ${member('publishPrimaryPreviewSelection')} }
        this.Widget = Widget;`, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
    const visuals = [
        { kind: 'layer', id: 'image-2' }, { kind: 'overlay', id: 'overlay-1' },
        { kind: 'overlay', id: 'shape-3' }, { kind: 'caption', id: 'c-0002' }
    ];
    for (const first of visuals) for (const second of visuals) {
        if (first === second) continue;
        class ElementMock {
            constructor(id, matches = {}) { this.id = id; this.matches = matches; }
            closest(selector) { return this.matches[selector] ?? null; }
        }
        const stage = new ElementMock('preview-stage');
        const target = second.kind === 'layer' ? new ElementMock('frame-engine-canvas')
            : second.kind === 'caption' ? new ElementMock('caption-plate')
                : new ElementMock('overlay-surface');
        if (second.kind === 'caption') {
            target.dataset = { captionKey: second.id };
            target.matches['.caption-row-plate'] = target;
        } else if (second.kind === 'overlay') {
            target.dataset = { overlayId: second.id };
            target.matches['[data-overlay-id]'] = target;
        }
        let reported;
        let pointerDown;
        const hitContext = vm.createContext({
            Element: ElementMock, previewStage: stage, selectedMixedGroup: [], suppressMixedClick: false,
            selectedCaptionId: first.kind === 'caption' ? first.id : null,
            selectedLayerId: first.kind === 'layer' ? first.id : null,
            captionRows: new Map([['c-0002', { caption: { id: 'c-0002' } }]]),
            findVisualMediaHitAt: () => ({ dataset: { akariLayerId: 'image-2' } }),
            applyMixedSelection(group) { hitContext.selectedMixedGroup = group; },
            window: { akari: { interaction: { selectedId: first.kind === 'overlay' ? first.id : null },
                reportMixedSelection(group) { reported = group; } },
            addEventListener(_type, callback) { pointerDown = callback; } }
        });
        const hitStart = preview.indexOf('const mixedSelectionHit =');
        const hitEnd = preview.indexOf('            }, true);', hitStart);
        vm.runInContext(preview.slice(hitStart, hitEnd + '            }, true);'.length), hitContext);
        pointerDown({ button: 0, shiftKey: true, ctrlKey: false, metaKey: false,
            target, preventDefault() {}, stopImmediatePropagation() {} });
        assert.ok(reported, `${first.id} -> ${second.id}`);
        const events = [];
        const context = vm.createContext({
            window: { dispatchEvent: event => events.push(event) },
            CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
            TIMELINE_OVERLAY_SELECTED_EVENT: 'overlay', TIMELINE_LAYER_SELECTED_EVENT: 'layer',
            captionIdForTreeSelection: () => null
        });
        vm.runInContext(js, context);
        const instance = new context.Widget();
        Object.assign(instance, {
            selection: undefined, multiSelection: [], selectionModel: { inspectorOwner: null },
            location: { editUri: { toString: () => 'file:///edit.json' } },
            layers: [{ id: 'image-2' }], cutItemIds: [], timelineTreeRows: [],
            selectionKey: item => `${item?.kind}:${item?.id}`,
            claimInspectorOwner() {}, pushSelectionSnapshot() {}, applySelectionClass() {},
            applyCaptionStateClasses() {}, rawKeyframeItem: () => null
        });
        instance.applyPreviewMixedSelection(reported);
        const groupEvent = events.at(-1);
        assert.equal(groupEvent.type, 'akari.timeline.groupSelectionChanged', `${first.id} -> ${second.id}`);
        const expected = [first.id, second.id];
        assert.deepEqual(Array.from(groupEvent.detail.selection, item => item.id), expected);
        assert.deepEqual(Array.from(instance.multiSelection, item => item.id), expected);
        const frames = [];
        const previewContext = vm.createContext({
            selectedMixedGroup: [], applyingMixedSelection: false, selectedCaptionIds: new Set(),
            mixedFrameLoop: true, mixedSelectionFrames: {
                replaceChildren() { frames.length = 0; }, appendChild(node) { frames.push(node); }
            },
            window: { akari: { interaction: null } },
            selectLayer() {}, selectCaption() {}, applyRequestedOverlaySelection() {},
            mixedSelectionElement: () => ({}), hasNativeMixedFrame: () => false,
            mixedSelectionRect: (_item, element) => ({ left: 10, top: 10, width: 20, height: 20 }),
            previewPane: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
            getComputedStyle: () => ({ visibility: 'visible' }),
            document: { createElement: () => ({ dataset: {}, style: {} }) }, requestAnimationFrame() {}
        });
        const applyStart = preview.indexOf('const applyMixedSelection =');
        const applyEnd = preview.indexOf('            const mixedSelectionHit =', applyStart);
        const drawStart = preview.indexOf('const drawMixedSelectionFrames =');
        const drawEnd = preview.indexOf('            const applyMixedSelection =', drawStart);
        vm.runInContext(`${preview.slice(drawStart, drawEnd)}\n${preview.slice(applyStart, applyEnd)}
            applyMixedSelection(${JSON.stringify(groupEvent.detail.selection)}); drawMixedSelectionFrames();`, previewContext);
        assert.deepEqual(frames.map(frame => frame.dataset.akariMixedSelected),
            Array.from(groupEvent.detail.selection, item => `${item.kind}:${item.id}`),
            `${first.id} -> ${second.id}`);
    }
});
