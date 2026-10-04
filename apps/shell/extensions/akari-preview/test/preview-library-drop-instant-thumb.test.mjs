import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { PendingAssetFetchStore, summarizeFetchFailure } from '../lib/common/pending-asset-fetch.js';

const source = ts.createSourceFile('drop.ts',
    readFileSync(new URL('../src/browser/preview-library-drop.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const widget = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'PreviewLibraryDrop');
const methods = ['drop', 'placeAfterFetch', 'placeThenFetch', 'showFetchOverlay', 'showFetchFailure',
    'hideFetchOverlay', 'hideFetchFailure', 'trackIndicator', 'resizeFromThumbnail']
    .map(name => widget.members.find(member => member.name?.getText(source) === name).getText(source));
const code = ts.transpileModule('class Harness { ' + methods.join('\n') + ' }',
    { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
const pending = new PendingAssetFetchStore();
const Harness = new Function('pendingAssetFetches', 'outputOffset', 'previewDropBox', 'summarizeFetchFailure',
    'readMaterialPayload', 'readPayload', 'readExplorerPayload', 'nearestOutputPoint',
    'APPLY_KINDS', 'PLACE_KINDS', 'previewOverlayKind', 'MATERIAL_MIME', 'MIME',
    code + '\nreturn Harness;')(pending, () => ({ x: 0, y: 0 }),
    () => ({ width: 100, height: 60 }), summarizeFetchFailure,
    () => undefined, value => value ? JSON.parse(value) : undefined, () => undefined, () => point,
    new Set(), new Set(), () => undefined, 'material', 'library');
const plan = { relativePath: 'assets/still/photo/p.png', kind: 'image', cached: false };
const geometry = { time: 1, output: { width: 1280, height: 720 },
    rect: { x: 10, y: 20, width: 640, height: 360 } };
const point = { x: 640, y: 360 };

function harness(resolveMaterial) {
    const handler = new Harness();
    const calls = [], warnings = [], failures = [];
    handler.commands = { async executeCommand(command, args) {
        calls.push([command, args]);
        if (command === 'akari.catalog.resolveMaterial') return resolveMaterial();
        if (command === 'akari.timeline.addMaterialAtOutputPoint') return 'placed';
    } };
    handler.messages = { warn: message => warnings.push(message) };
    handler.showFetchOverlay = () => {};
    handler.hideFetchOverlay = () => {};
    handler.showFetchFailure = (...args) => failures.push(args);
    return { handler, calls, warnings, failures };
}

test('failure leaves reason and retry callback while placement is removed', async () => {
    const { handler, calls, warnings, failures } = harness(() => Promise.reject(new Error('failed')));
    pending.noteFailureReason('still/photo', 'validator: source invalid');
    await handler.placeThenFetch(plan, { key: 'still/photo', width: 100 }, geometry, point, 'edit.json', false);
    assert.equal(failures.length, 1);
    assert.equal(failures[0][5], 'validator: source invalid');
    assert.equal(calls.some(([name]) => name === 'akari.timeline.removePlacedMaterial'), true);
    assert.match(warnings[0], /failed/);
});

test('undefined resolve retains the failure mark without duplicate notification', async () => {
    const { handler, warnings, failures } = harness(() => Promise.resolve(undefined));
    await handler.placeThenFetch(plan, { key: 'still/photo', width: 100 }, geometry, point, 'edit.json', false);
    assert.equal(warnings.length, 0);
    assert.equal(failures.length, 1);
});

test('retry resolves and refreshes after selection changes', async () => {
    let attempt = 0;
    const { handler, calls, failures } = harness(() => ++attempt === 1
        ? Promise.reject(new Error('first failure'))
        : Promise.resolve({ relativePath: plan.relativePath, kind: 'image' }));
    let hidden = 0;
    handler.hideFetchFailure = () => { hidden++; };
    await handler.placeThenFetch(plan, { key: 'still/photo', width: 100 }, geometry, point, 'edit.json', false);
    const previousWindow = globalThis.window;
    globalThis.window = new EventTarget();
    globalThis.window.dispatchEvent(new Event('akari.timeline.primarySelected'));
    globalThis.window = previousWindow;
    failures[0][6]();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(hidden, 1);
    assert.equal(pending.has(plan.relativePath), false);
    assert.equal(calls.some(([name]) => name === 'akari.timeline.refreshPlacedMaterial'), true);
    assert.equal(calls.some(([name]) => name === 'akari.preview.refreshMedia'), true);
});

function element() {
    const listeners = new Map();
    return {
        dataset: {}, style: {}, children: [], listeners,
        setAttribute(name, value) { this[name] = value; },
        addEventListener(name, callback) { listeners.set(name, callback); },
        append(...children) { this.children.push(...children); },
        appendChild(child) { this.children.push(child); return child; },
        remove() { this.removed = true; }
    };
}

test('overlays track widget visibility and failure has retry and close buttons', async () => {
    const originalDocument = globalThis.document;
    const body = element();
    globalThis.document = { body, createElement: element, createTextNode: value => ({ textContent: value }) };
    const handler = new Harness();
    let visible = true;
    let rect = { x: 0, y: 0, left: 0, top: 0, width: 640, height: 360 };
    handler.widget = { get isVisible() { return visible; },
        node: { getBoundingClientRect: () => rect } };
    handler.fetchOverlays = new Map();
    handler.fetchFailures = new Map();
    handler.indicatorStops = new WeakMap();
    try {
        handler.showFetchOverlay(plan, geometry, point, { width: 100 }, 'thumb');
        const overlay = body.children.at(-1);
        assert.equal(overlay.style.display, 'flex');
        visible = false;
        handler.showFetchFailure(plan, geometry, point, { width: 100 }, 'thumb', 'reason', () => {});
        const failure = body.children.at(-1);
        assert.equal(failure.style.display, 'none');
        assert.equal(failure.role, 'alert');
        assert.equal(failure.children.at(-1).children.length, 2);
        visible = true;
        rect = { x: 100, y: 50, left: 100, top: 50, width: 640, height: 360 };
        await new Promise(resolve => setTimeout(resolve, 220));
        assert.equal(failure.style.display, 'flex');
        assert.equal(Number.parseFloat(failure.style.left) > 100, true);
        handler.hideFetchOverlay(plan.relativePath);
        handler.hideFetchFailure(plan.relativePath);
        assert.equal(overlay.removed, true);
        assert.equal(failure.removed, true);
    } finally {
        handler.hideFetchOverlay(plan.relativePath);
        handler.hideFetchFailure(plan.relativePath);
        globalThis.document = originalDocument;
    }
});

test('unknown-width still shows thumbnail before planMaterial resolves', async () => {
    const handler = new Harness();
    const overlays = [], hidden = [];
    let finishPlan;
    handler.active = { kind: 'asset', key: 'still/photo', category: 'still', thumb: 'tile-thumb' };
    handler.dragSession = handler.active;
    handler.geometry = geometry;
    handler.pendingGeometryRequests = new Set();
    handler.widget = { node: { getBoundingClientRect: () => ({
        x: 0, y: 0, left: 0, top: 0, width: 800, height: 600
    }) } };
    handler.queryGeometry = () => Promise.resolve(geometry);
    handler.fullscreen = () => false;
    handler.editUri = () => 'edit.json';
    handler.clear = () => {};
    handler.showFetchOverlay = (...args) => overlays.push(args);
    handler.hideFetchOverlay = path => hidden.push(path);
    handler.showFetchFailure = () => {};
    handler.canPlaceOptimistically = () => false;
    handler.messages = { warn() {} };
    handler.commands = { executeCommand(name) {
        if (name === 'akari.catalog.planMaterial') return new Promise(resolve => { finishPlan = resolve; });
        if (name === 'akari.catalog.resolveMaterial') return Promise.resolve(undefined);
        return Promise.resolve();
    } };
    const event = { clientX: 300, clientY: 200, altKey: false,
        dataTransfer: { getData: name => name === 'library' ? JSON.stringify(handler.active) : '' },
        preventDefault() {}, stopPropagation() {} };
    const dropping = handler.drop(event);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(overlays.length, 1);
    assert.equal(overlays[0][4], 'tile-thumb');
    assert.equal(overlays[0][3].width, undefined);
    finishPlan(undefined);
    await dropping;
    assert.equal(hidden.includes('catalog:still/photo'), true);
});

test('unknown-width fetch failure keeps a reason and retry can place the material', async () => {
    const handler = new Harness();
    const calls = [], warnings = [], failures = [], hidden = [];
    let attempts = 0;
    handler.commands = { async executeCommand(name, args) {
        calls.push([name, args]);
        if (name === 'akari.catalog.resolveMaterial') {
            return ++attempts === 1 ? undefined : { relativePath: 'assets/still/photo/p.png', kind: 'image' };
        }
        if (name === 'akari.timeline.addMaterialAtOutputPoint') return 'placed';
    } };
    handler.messages = { warn: value => warnings.push(value) };
    handler.showFetchOverlay = () => {};
    handler.hideFetchOverlay = () => {};
    handler.showFetchFailure = (...args) => failures.push(args);
    handler.hideFetchFailure = key => hidden.push(key);
    pending.noteFailureReason('still/photo', 'validator: source invalid');
    const payload = { kind: 'asset', key: 'still/photo', category: 'still', thumb: 'tile-thumb' };
    const outcome = await handler.placeAfterFetch(undefined, payload, geometry, point, 'edit.json', false);
    assert.equal(outcome.keepGhost, false);
    assert.equal(failures.length, 1);
    assert.equal(failures[0][0].relativePath, 'catalog:still/photo');
    assert.equal(failures[0][5], 'validator: source invalid');
    assert.equal(warnings.length, 1);
    failures[0][6]();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(hidden, ['catalog:still/photo']);
    assert.equal(attempts, 2);
    assert.equal(calls.some(([name]) => name === 'akari.timeline.addMaterialAtOutputPoint'), true);
    assert.equal(calls.some(([name]) => name === 'akari.preview.seekOutput'), true);
});

test('failure mark appears before a slow removal and before the warning', async () => {
    const handler = new Harness();
    const order = [];
    let finishRemoval;
    handler.commands = { executeCommand(name) {
        if (name === 'akari.catalog.resolveMaterial') return Promise.reject(new Error('fetch failed'));
        if (name === 'akari.timeline.addMaterialAtOutputPoint') return Promise.resolve('placed');
        if (name === 'akari.timeline.removePlacedMaterial') {
            order.push('remove');
            return new Promise(resolve => { finishRemoval = resolve; });
        }
        return Promise.resolve();
    } };
    handler.messages = { warn() { order.push('warn'); } };
    handler.showFetchOverlay = () => { order.push('overlay'); };
    handler.hideFetchOverlay = () => { order.push('hide'); };
    handler.showFetchFailure = () => { order.push('failure'); };
    const running = handler.placeThenFetch(plan, { key: 'still/photo', width: 100 }, geometry, point,
        'edit.json', false);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(order, ['overlay', 'failure', 'hide', 'remove']);
    finishRemoval();
    await running;
    assert.deepEqual(order, ['overlay', 'failure', 'hide', 'remove', 'warn']);
});

test('unknown-width failure mark appears before loading overlay is removed and warning is sent', async () => {
    const handler = new Harness();
    const order = [];
    handler.commands = { executeCommand(name) {
        if (name === 'akari.catalog.resolveMaterial') return Promise.resolve(undefined);
        return Promise.resolve();
    } };
    handler.messages = { warn() { order.push('warn'); } };
    handler.showFetchOverlay = () => { order.push('overlay'); };
    handler.hideFetchOverlay = () => { order.push('hide'); };
    handler.showFetchFailure = () => { order.push('failure'); };
    await handler.placeAfterFetch(undefined,
        { kind: 'asset', key: 'still/photo', category: 'still', thumb: 'tile-thumb' },
        geometry, point, 'edit.json', false);
    assert.deepEqual(order, ['overlay', 'failure', 'hide', 'warn']);
});
