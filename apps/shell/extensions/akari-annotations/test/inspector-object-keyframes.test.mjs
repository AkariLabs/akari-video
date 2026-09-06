import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { createNumberField } from '../lib/browser/inspector/number-field.js';
import { validateInspectorPerspective } from '../lib/browser/inspector/perspective-fields.js';
import { objectKeyframeValue } from '../lib/browser/timeline/object-keyframe-value.js';
import { keyframeRowPropertyOf, keyframeValueAt } from '../lib/browser/timeline/timeline-keyframe-rows.js';
import { setV2Keyframe, removeV2Keyframe } from '../lib/common/edit-v2-mutations.js';
import { inspectorSource, timelineMethod, perspectiveFields, visualSnapshot } from './helpers/perspective-transition-fixture.mjs';

const crop = { x: 0, y: 0, w: 1, h: 1 };
const perspective = { corners: [[0, 0], [1, 0], [0, 1], [1, 1]] };
const fixture = () => ({ version: 2, tracks: [{ id: 'video', lane: 'visual', items: [{
    id: 'visual-1', at: 0, duration: 100, source: { kind: 'media', src: 'main' }
}] }] });
const item = document => document.tracks[0].items[0];

test('object values use complete points, linear interpolation, boundaries and a single leaf override', () => {
    const raw = { crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, keyframes: [
        { t: 30, crop: { x: 0.2, y: 0.4, w: 0.6, h: 0.4 } },
        { t: 20, crop: { w: 0.9 }, perspective: { corners: [[0, 0]] } },
        { t: 21, crop: { ...crop, w: 0 } },
        { t: 10, crop, perspective },
        { t: 30, perspective: { corners: [[0.2, 0.4], [0.8, 0.2], [0.2, 0.8], [0.8, 0.6]] } }
    ] };
    const before = structuredClone(raw);
    assert.deepEqual(objectKeyframeValue(raw, 'crop.w', 20, 0.7), { x: 0.1, y: 0.2, w: 0.7, h: 0.7 });
    assert.deepEqual(objectKeyframeValue(raw, 'crop', 0), crop);
    assert.deepEqual(objectKeyframeValue(raw, 'crop', 50), raw.keyframes[0].crop);
    assert.deepEqual(objectKeyframeValue(raw, 'perspective.tl.x', 20, 0.3), {
        corners: [[0.3, 0.2], [0.9, 0.1], [0.1, 0.9], [0.9, 0.8]]
    });
    assert.deepEqual(objectKeyframeValue(undefined, 'crop', 0), crop);
    assert.deepEqual(objectKeyframeValue(undefined, 'perspective', 0), perspective);
    assert.deepEqual(objectKeyframeValue({ crop: raw.crop }, 'crop.h', 0, 0.5), { ...raw.crop, h: 0.5 });
    assert.deepEqual(objectKeyframeValue({ perspective }, 'perspective.br.x', 0, 0.7), {
        corners: [[0, 0], [1, 0], [0, 1], [0.7, 1]]
    });
    assert.deepEqual(raw, before);
});

test('v2 mutations store whole objects and remove only the selected property, then the empty point', () => {
    let document = fixture();
    for (const [property, value] of [['crop', crop], ['perspective', perspective]]) {
        document = setV2Keyframe(document, { itemId: 'visual-1', property, t: 0, value });
    }
    document = setV2Keyframe(document, { itemId: 'visual-1', property: 'opacity', t: 50, value: 0.5 });
    assert.deepEqual(item(document).keyframes.find(point => point.t === 0), { t: 0, crop, perspective });
    document = removeV2Keyframe(document, { itemId: 'visual-1', property: 'crop', t: 0 });
    assert.deepEqual(item(document).keyframes.find(point => point.t === 0), { t: 0, perspective });
    document = removeV2Keyframe(document, { itemId: 'visual-1', property: 'perspective', t: 0 });
    assert.equal(item(document).keyframes.some(point => point.t === 0), false);
    assert.deepEqual(item(document).keyframes, [{ t: 50, opacity: 0.5 }, { t: 100, crop }]);
});

const handleControl = timelineMethod('handleKeyframeControl', {
    keyframeRowPropertyOf, keyframeValueAt, objectKeyframeValue, validateInspectorPerspective,
    enterFocusScope: (_rows, itemId) => ({ rootId: itemId })
});
function context() {
    return {
        document: fixture(), fps: 10, playheadT: 2, selectionModel: {},
        expandedTimelineTreeRows: [{ id: 'visual-1', at: 0 }],
        rawKeyframeItem() { return item(this.document); },
        hydratedKeyframes() { return this.rawKeyframeItem().keyframes ?? []; },
        segmentEasingAt() { return 'linear'; },
        async setTimelineKeyframe(itemId, property, t, value) {
            this.document = setV2Keyframe(this.document, { itemId, property, t, value });
        },
        async removeSelectedKeyframes() {
            const { itemId, property, times } = this.selectionModel.keyframeSelection;
            this.document = removeV2Keyframe(this.document, { itemId, property, t: times[0] });
        },
        async handleInspectorWrite(request) { this.staticWrite = request; return { ok: true }; },
        errorMessage: error => error.message
    };
}

test('leaf toggles insert and delete objects; numeric writes update an existing point or static values', async () => {
    for (const property of ['crop.w', 'perspective.tl.x']) {
        const widget = context();
        const request = { action: 'toggle', itemId: 'visual-1', property, value: 0.6 };
        assert.deepEqual(await handleControl.call(widget, request), { ok: true });
        const row = keyframeRowPropertyOf(property);
        assert.deepEqual(item(widget.document).keyframes.find(point => point.t === 20)[row], objectKeyframeValue(undefined, property, 20, 0.6));
        assert.deepEqual(await handleControl.call(widget, { ...request, action: 'write', value: 0.7 }), { ok: true });
        assert.deepEqual(item(widget.document).keyframes.find(point => point.t === 20)[row], objectKeyframeValue(undefined, property, 20, 0.7));
        widget.playheadT = 3;
        await handleControl.call(widget, { ...request, action: 'write', value: 0.8 });
        assert.equal(widget.staticWrite.path, row === 'crop' ? property : row);
        assert.deepEqual(widget.staticWrite.value, row === 'crop' ? 0.8 : objectKeyframeValue(undefined, property, 30, 0.8));
        widget.playheadT = 2;
        assert.deepEqual(await handleControl.call(widget, request), { ok: true });
        assert.equal(widget.selectionModel.keyframeSelection.property, row);
        assert.equal(item(widget.document).keyframes?.some(point => point.t === 20) ?? false, false);
    }
});

test('leaf navigation and reveal select and scroll the single object row', async () => {
    for (const property of ['crop.w', 'perspective.br.y']) {
        const widget = context();
        item(widget.document).keyframes = [{ t: 10, crop, perspective }, { t: 30, crop, perspective }];
        widget.outputToSource = t => t;
        widget.requestSeek = async t => { widget.seek = t; };
        widget.applyKeyframePropertySelectionClass = () => {};
        widget.applyFocusScope = scope => { widget.focus = scope; };
        widget.scrollTimelineKeyframeRowIntoView = (id, row) => { widget.scroll = [id, row]; return true; };
        const request = { itemId: 'visual-1', property };
        for (const [action, time] of [['previous', 10], ['next', 30], ['reveal', 30]]) {
            assert.deepEqual(await handleControl.call(widget, { ...request, action }), { ok: true });
            assert.equal(widget.selectionModel.keyframeSelection.property, keyframeRowPropertyOf(property));
            assert.deepEqual(widget.selectionModel.keyframeSelection.times, [time]);
        }
        assert.deepEqual(widget.scroll, ['visual-1', keyframeRowPropertyOf(property)]);
    }
});

function inspectorMethod(name) {
    const ast = ts.createSourceFile('inspector.ts', inspectorSource, ts.ScriptTarget.Latest, true);
    const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariInspectorWidget');
    const method = widget.members.find(node => node.name?.getText(ast) === name);
    const code = ts.transpileModule(`class Widget { ${method.getText(ast)} }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2021 }
    }).outputText;
    return new Function('keyframeRowPropertyOf', 'keyframeValueAt', 'createNumberField',
        `${code}; return Widget.prototype.${name};`)(keyframeRowPropertyOf, keyframeValueAt, createNumberField);
}

class Element {
    children = []; attributes = new Map(); listeners = new Map();
    setAttribute(name, value) { this.attributes.set(name, value); }
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.append(child); return child; }
    addEventListener(name, callback) { this.listeners.set(name, [...(this.listeners.get(name) ?? []), callback]); }
    removeEventListener(name, callback) { this.listeners.set(name, (this.listeners.get(name) ?? []).filter(fn => fn !== callback)); }
    emit(name, event) { for (const callback of this.listeners.get(name) ?? []) callback(event); }
    setPointerCapture() {} hasPointerCapture() { return true; } releasePointerCapture() {}
    querySelectorAll() { return []; }
}
function dom(callback) {
    const previous = ['document', 'window'].map(name => Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => new Element() } });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: new Element() });
    try { callback(); } finally {
        ['document', 'window'].forEach((name, index) => {
            if (previous[index]) Object.defineProperty(globalThis, name, previous[index]);
            else delete globalThis[name];
        });
    }
}
const seatOptions = inspectorMethod('keyframeSeatOptions');
const appendRow = inspectorMethod('appendRow');

test('all crop and perspective number rows render seats using raw scalar values and row selection', () => dom(() => {
    for (const name of ['crop-x', 'crop-y', 'crop-w', 'crop-h',
        ...['tl', 'tr', 'bl', 'br'].flatMap(corner => ['x', 'y'].map(axis => `perspective-${corner}-${axis}`))]) {
        const requests = [];
        const property = name.replaceAll('-', '.');
        const rowProperty = keyframeRowPropertyOf(property);
        const snapshot = visualSnapshot('layer', { keyframes: [{ t: 20, crop, perspective }] });
        const model = { keyframeSelection: { itemId: snapshot.id, property: rowProperty }, requestKeyframe: r => requests.push(r) };
        const keyframe = seatOptions.call({ model }, snapshot, name, 0.7);
        assert.equal(keyframe.active, true);
        assert.equal(keyframe.hasKeyframes, true);
        const field = createNumberField({ name, label: name, value: 0.7, step: 0.005, keyframe, onCommit: async () => true });
        const seat = field.children[4].children[1];
        assert.equal(seat.attributes.get('data-akari-ui'), `inspector-kf-seat:${name}`);
        seat.emit('click');
        assert.deepEqual(requests[0], { action: 'toggle', itemId: snapshot.id, property, value: 0.7 });
        assert.equal(field.className.includes('seatless'), false);
    }
}));

test('perspective drag sends a live request even with perspective keyframes', () => dom(() => {
    const snapshot = visualSnapshot('layer', { keyframes: [{ t: 20, perspective }] });
    const field = perspectiveFields(snapshot, async () => ({ ok: true }))[0];
    const requests = [];
    const widget = { model: { requestLivePreview: r => requests.push(r) }, keyframeSeatOptions: seatOptions, attachRowMenu() {} };
    const parent = new Element();
    appendRow.call(widget, parent, field, snapshot, 'layer');
    const handle = parent.children[0].children[1].children[0];
    handle.emit('pointerdown', { button: 0, pointerId: 1, clientX: 0, preventDefault() {} });
    window.emit('pointermove', { pointerId: 1, clientX: 10 });
    assert.deepEqual(requests, [{ target: { kind: 'layer', id: snapshot.id }, field: 'perspective.tl.x', value: 0.05 }]);
    window.emit('pointercancel', { pointerId: 1 });
}));

test('only seatless rows collapse the fifth grid column', () => dom(() => {
    const field = createNumberField({ name: 'speed', label: 'Speed', value: 1, step: 0.1, onCommit: async () => true });
    assert.equal(field.children.length, 4);
    assert.equal(field.className.includes('akari-inspector-number-field-seatless'), true);
    assert.match(inspectorSource, /\.akari-inspector-number-field\s*\{[^}]*grid-template-columns: 24px minmax\(42px, 1fr\) auto 18px 54px;/u);
    assert.match(inspectorSource, /\.akari-inspector-number-field-seatless\s*\{\s*grid-template-columns: 24px minmax\(42px, 1fr\) auto 18px;/u);
}));
