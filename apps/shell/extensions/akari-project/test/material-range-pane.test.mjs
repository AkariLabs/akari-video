import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { memberText, readSourceFile } from './helpers/role-buckets-source.mjs';
import { materialCardLayout } from '../lib/common/material-card-layout.js';

const paneSource = readSourceFile('materials');
const constructor = paneSource.classNode.members.find(ts.isConstructorDeclaration).getText(paneSource.ast);
const behavior = [constructor, 'rangePath', 'changeMaterialRange', 'loadMaterials'
    ].map(member => member === constructor ? member : memberText(member, { in: 'materials' })).join('\n');
const behaviorCode = ts.transpileModule(`class Pane {
    materialRangeSource = 'materials-pane';
    materialRanges = {};
    rangeSaveTimers = new Map();
    rangeSavesInFlight = new Map();
    materialRangeRevision = 0;
    materialRangeRevisions = new Map();
    referenceWatches = new DisposableCollection();
    ${behavior}
}`, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;

function rangeFixture() {
    const events = [];
    const scheduled = new Map();
    const requests = [];
    const infos = [];
    let nextTimer = 0;
    const listeners = [];
    const window = {
        addEventListener: (_name, listener) => listeners.push(listener),
        removeEventListener: (_name, listener) => { const index = listeners.indexOf(listener); if (index >= 0) listeners.splice(index, 1); },
        dispatchEvent: event => { events.push(event); listeners.forEach(listener => listener(event)); }
    };
    const CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options.detail; } };
    const setTimeout = callback => { const id = ++nextTimer; scheduled.set(id, callback); return id; };
    const clearTimeout = id => scheduled.delete(id);
    const DisposableCollection = class { items = []; dispose() { for (const item of this.items) item.dispose(); this.items = []; }
        push(item) { this.items.push(item); } };
    const Pane = new Function('window', 'CustomEvent', 'setTimeout', 'clearTimeout',
        'DisposableCollection', 'DEFAULT_MATERIALS_SORT', 'isMaterialsList',
        `${behaviorCode}; return Pane;`)(window, CustomEvent, setTimeout, clearTimeout,
        DisposableCollection, 'imported-desc', mode => mode === 'list');
    let updates = 0;
    const pane = new Pane({
        workflow: { workspaceRoot: { toString: () => 'file:///project' } },
        update: () => { updates++; },
        messages: { warn: () => {}, info: message => infos.push(message) },
        commandService: { executeCommand: (_id, request) => {
            let resolve;
            const result = new Promise(done => { resolve = done; });
            requests.push({ request, resolve });
            return result;
        } }
    });
    const fireTimer = () => {
        const [id, callback] = scheduled.entries().next().value;
        scheduled.delete(id);
        callback();
    };
    return { pane, events, scheduled, requests, infos, window, CustomEvent, fireTimer, updates: () => updates };
}

test('a delayed save echo cannot roll back a newer handle movement', async () => {
    const f = rangeFixture();
    const entry = { relativePath: 'assets/a.mp4' };
    f.pane.changeMaterialRange(entry, { in: 1, out: 9 });
    assert.equal(f.events[0].detail.source, 'materials-pane');
    f.fireTimer();
    assert.equal(f.requests[0].request.source, 'materials-pane');
    f.pane.changeMaterialRange(entry, { in: 1, out: 7 });
    f.window.dispatchEvent(new f.CustomEvent('akari.materials.range.changed', {
        detail: { relativePath: entry.relativePath, range: { in: 1, out: 9 }, source: 'materials-pane' }
    }));
    assert.deepEqual(f.pane.materialRanges[entry.relativePath], { in: 1, out: 7 });
    assert.equal(f.scheduled.size, 1);
    f.requests[0].resolve();
    await Promise.resolve();
    f.fireTimer();
    assert.deepEqual(f.requests[1].request.range, { in: 1, out: 7 });
    f.requests[1].resolve();
    await Promise.resolve();
});

test('an external range change follows the event and cancels a pending local save', () => {
    const f = rangeFixture();
    const entry = { relativePath: 'assets/a.mp4' };
    f.pane.changeMaterialRange(entry, { in: 1, out: 9 });
    f.window.dispatchEvent(new f.CustomEvent('akari.materials.range.changed', {
        detail: { relativePath: entry.relativePath, range: { in: 2, out: 8 }, source: 'material-preview' }
    }));
    assert.deepEqual(f.pane.materialRanges[entry.relativePath], { in: 2, out: 8 });
    assert.equal(f.scheduled.size, 0);
    f.pane.changeMaterialRange(entry, { in: 3, out: 8 });
    f.window.dispatchEvent(new f.CustomEvent('akari.materials.range.changed', {
        detail: { relativePath: entry.relativePath, range: null }
    }));
    assert.equal(f.pane.materialRanges[entry.relativePath], undefined);
    assert.equal(f.scheduled.size, 0);
});

test('clearing the range announces it once', () => {
    const f = rangeFixture();
    const entry = { relativePath: 'assets/a.mp4' };
    f.pane.changeMaterialRange(entry, { in: 2, out: 6 });
    f.pane.changeMaterialRange(entry, null);
    assert.deepEqual(f.infos, ['範囲をなしに戻しました']);
    assert.equal(f.events.length, 2);
    assert.equal(f.scheduled.size, 1);
    f.pane.changeMaterialRange(entry, null);
    assert.deepEqual(f.infos, ['範囲をなしに戻しました']);
    assert.equal(f.events.length, 2);
    assert.equal(f.scheduled.size, 1);
});

test('disposing range watches removes the window listener', () => {
    const f = rangeFixture();
    f.pane.referenceWatches.dispose();
    f.window.dispatchEvent(new f.CustomEvent('akari.materials.range.changed', {
        detail: { relativePath: 'assets/a.mp4', range: { in: 2, out: 6 }, source: 'material-preview' }
    }));
    assert.equal(f.pane.materialRanges['assets/a.mp4'], undefined);
});

test('a stale range read preserves an edit that was awaiting save when reading began', async () => {
    const f = rangeFixture();
    const root = f.pane.host.workflow.workspaceRoot;
    root.resolve = () => root;
    const path = 'assets/a.mp4';
    f.pane.viewRootKey = root.toString();
    f.pane.materialsGeneration = 0;
    f.pane.referenceWatches = { dispose() {}, push() {} };
    f.pane.referenceWatchParents = new Set();
    f.pane.mode = 'grid';
    f.pane.collectAssetEntries = async () => ({ files: [], assetGroups: [] });
    f.pane.collectUnorganizedRootFiles = async () => [];
    f.pane.buildReferenceMaterials = async () => [];
    f.pane.hydrateCachedThumbnails = () => {};
    f.pane.hydrateMaterialMeta = async () => {};
    f.pane.host.files = { onDidFilesChange: () => ({ dispose() {} }) };
    let resolveRead;
    f.pane.host.projectService = {
        readMaterialRanges: () => new Promise(resolve => { resolveRead = resolve; }),
        listProjectAssetReferences: async () => [], projectCredits: async () => [],
        transcriptStates: async () => ({})
    };
    f.pane.changeMaterialRange({ relativePath: path }, { in: 2, out: 7 });
    await f.pane.loadMaterials();
    f.fireTimer();
    f.requests[0].resolve();
    await Promise.resolve();
    resolveRead({ [path]: { in: 0, out: 14 }, 'assets/other.mp4': { in: 1, out: 3 } });
    await Promise.resolve();
    assert.deepEqual(f.pane.materialRanges[path], { in: 2, out: 7 });
    assert.deepEqual(f.pane.materialRanges['assets/other.mp4'], { in: 1, out: 3 });
});

const cardMethod = memberText('renderMaterialCard', { in: 'materials' });
const cardCode = ts.transpileModule(`class Card { ${cardMethod} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2021, jsx: ts.JsxEmit.React }
}).outputText;
const React = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }) };
const Card = new Function('React', 'materialCardLayout', 'isMaterialsList', 'formatDurationBadge',
    'AKARI_FAINT', 'MaterialStrip', 'MaterialRangeHandles', 'AKARI_MATERIAL_SELECTED_EVENT',
    `${cardCode}; return Card;`)(React, materialCardLayout, mode => mode === 'list', n => `${n}s`,
    '#777', () => null, () => null, 'akari.material.selected');

test('range overlay clicks do not reselect or reopen the central preview', () => {
    const previousElement = Object.getOwnPropertyDescriptor(globalThis, 'Element');
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const previousCustomEvent = Object.getOwnPropertyDescriptor(globalThis, 'CustomEvent');
    const events = [];
    class Element { constructor(overlay) { this.overlay = overlay; } closest(selector) {
        return this.overlay && selector.includes('[data-akari-material-range-handles]') ? this : null;
    } }
    Object.defineProperty(globalThis, 'Element', { configurable: true, value: Element });
    Object.defineProperty(globalThis, 'window', { configurable: true,
        value: { dispatchEvent: event => events.push(event) } });
    Object.defineProperty(globalThis, 'CustomEvent', { configurable: true,
        value: class { constructor(type, options) { this.type = type; this.detail = options.detail; } } });
    try {
        const pane = new Card();
        const opened = [];
        pane.mode = 'list';
        pane.selectedMaterialPath = 'assets/a.mp4';
        pane.materialRanges = { 'assets/a.mp4': { in: 2, out: 6 } };
        pane.transcriptStateByPath = {};
        pane.host = { generationPick: {}, generationPickCardProps: () => ({}),
            renderGenerationPickBadge: () => null, placeholderIcon: () => 'icon',
            workflow: { workspaceRoot: { toString: () => 'file:///project' } }, update: () => {},
            openFile: uri => opened.push(uri.toString()) };
        const entry = { uri: { toString: () => 'file:///project/assets/a.mp4', path: { base: 'a.mp4' } },
            relativePath: 'assets/a.mp4', name: 'a.mp4', kind: 'video', analyzed: false,
            unorganized: false, durationSeconds: 14 };
        const card = pane.renderMaterialCard(entry).children[0];
        assert.equal(card.props.onDoubleClick, undefined);
        const listBadge = card.children.find(child => child?.props?.style?.right === '4px');
        assert.equal(listBadge, undefined);
        const overlayClick = { target: new Element(true) };
        card.props.onClickCapture(overlayClick);
        assert.deepEqual([events.length, opened.length], [0, 0]);
        const ordinaryClick = { target: new Element(false) };
        card.props.onClickCapture(ordinaryClick);
        card.props.onClick();
        assert.deepEqual([events.length, opened.length], [1, 1]);
        pane.mode = 'grid';
        const gridCard = pane.renderMaterialCard(entry).children[0];
        const gridBadge = gridCard.children.find(child => child?.props?.style?.right === '4px');
        assert.equal(gridBadge.children[0].children[0], '✂');
        assert.equal(gridBadge.children.at(-1), '4s');
    } finally {
        for (const [name, descriptor] of [['Element', previousElement], ['window', previousWindow],
            ['CustomEvent', previousCustomEvent]]) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else delete globalThis[name];
        }
    }
});

test('both handles and the label stop click bubbling but leave double-click free', () => {
    const source = ts.createSourceFile('material-range-handles.tsx',
        readFileSync(new URL('../src/browser/material-range-handles.tsx', import.meta.url), 'utf8'),
        ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const declaration = source.statements.find(node => ts.isFunctionDeclaration(node)
        && node.name?.text === 'MaterialRangeHandles');
    assert.ok(declaration);
    const code = ts.transpileModule(declaration.getText(source).replace(/^export\s+/, ''), {
        compilerOptions: { target: ts.ScriptTarget.ES2021, jsx: ts.JsxEmit.React }
    }).outputText;
    const React = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
        useRef: () => ({ current: null }), useState: value => [value, () => {}], useEffect: () => {} };
    const Component = new Function('React', 'materialRangeLabel', 'clampMaterialRange',
        `${code}; return MaterialRangeHandles;`)(React, () => '0:04', () => ({}));
    const tree = Component({ durationSeconds: 14, range: { in: 2, out: 6 }, onChange: () => {} });
    const flatten = value => Array.isArray(value) ? value.flatMap(flatten)
        : value && typeof value === 'object' && 'props' in value
            ? [value, ...value.children.flatMap(flatten)] : [];
    const targets = flatten(tree).filter(node => ['hnd l', 'hnd r', 'range-lbl'].includes(node.props.className));
    assert.deepEqual(targets.map(node => node.props.className), ['hnd l', 'hnd r', 'range-lbl']);
    for (const target of targets) {
        let stopped = 0;
        target.props.onClick({ stopPropagation: () => { stopped++; } });
        assert.equal(stopped, 1);
        assert.equal(target.props.onDoubleClick, undefined);
    }
});
