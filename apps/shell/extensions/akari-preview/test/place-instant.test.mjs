import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import { methodBody, readHandlerSource } from './helpers/handler-source.mjs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../src/common/preview-model-diff.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const exports = {};
vm.runInNewContext(compiled, { exports, require: () => ({
    samePageOverlayReferences: (a, b) => JSON.stringify(a.overlayUris) === JSON.stringify(b.overlayUris)
}) });
const { classifyPreviewModelUpdate, isOwnAssetReferenceChange } = exports;

test('生成 PNG の差分では生成情報を新しい layer より先に送る', () => {
    const handler = readHandlerSource();
    const start = handler.indexOf('const generatedAssetUrls =');
    const generation = handler.indexOf('await this.sendGenerationUpdate(widget)', start);
    const layer = handler.indexOf("widget.sendMessage({ type: 'akari-preview-model-update', summary })", start);
    assert.ok(start >= 0 && generation > start && layer > generation);
});

const model = () => ({
    sourceUris: ['first=file:///first.png'], assetUris: ['file:///first.png'],
    overlayUris: [], output: { width: 1920, height: 1080, fps: 30 },
    overlayRuntimeAssets: [], captions: [], emphasisWords: [],
    summary: { cuts: [], layers: [{ id: 'first', src: 'stream://first', kind: 'image', isImage: true }],
        overlays: [], audio: {}, tracks: {}, timelineTracks: [] }
});

test('追加した source と layer だけを差分で受ける', () => {
    const before = model();
    const after = structuredClone(before);
    after.sourceUris.push('second=file:///second.png');
    after.assetUris.push('file:///second.png');
    after.summary.layers.push({ id: 'second', src: 'stream://second', kind: 'image', isImage: true });
    assert.equal(classifyPreviewModelUpdate(before, after), 'incremental');
    after.summary.layers[0].src = 'stream://changed';
    assert.equal(classifyPreviewModelUpdate(before, after), 'rebuild');
    after.summary.layers[0].src = 'stream://first';
    after.summary.layers[0].transform = { x: 10 };
    assert.equal(classifyPreviewModelUpdate(before, after), 'rebuild');
});

test('参照が遅れて届くとき source だけ、続いて layer だけを差分で足す', () => {
    const before = model();
    const withoutReference = structuredClone(before);
    const missingUri = 'file:///project/assets/still/second/photo.png';
    const resolvedUri = 'file:///library/still/second/photo.png';
    // loadPreviewModel registers the attempted asset URI before streaming fails;
    // the layer is omitted, while track rows still come from edit.json.
    withoutReference.sourceUris.push(`second=${missingUri}|proxy=`);
    withoutReference.assetUris.push(missingUri);
    withoutReference.summary.tracks = { layers: [{ ref: 0 }] };
    withoutReference.summary.timelineTracks = [{ id: 'visual', kind: 'layers' }];
    assert.equal(classifyPreviewModelUpdate(before, withoutReference), 'incremental');
    const resolved = structuredClone(withoutReference);
    resolved.sourceUris[1] = `second=${resolvedUri}|proxy=`;
    resolved.assetUris[1] = resolvedUri;
    resolved.summary.layers.push({ id: 'second-layer', src: `akari-asset:${resolvedUri}`,
        kind: 'image', isImage: true });
    assert.equal(classifyPreviewModelUpdate(withoutReference, resolved), 'incremental');
    const visibleSourceChanged = structuredClone(before);
    const currentUri = 'file:///first.png';
    visibleSourceChanged.sourceUris[0] = `first=${currentUri}|proxy=`;
    visibleSourceChanged.summary.layers[0].src = `akari-asset:${currentUri}`;
    const reboundVisibleSource = structuredClone(visibleSourceChanged);
    reboundVisibleSource.sourceUris[0] = 'first=file:///other.png|proxy=';
    reboundVisibleSource.assetUris[0] = 'file:///other.png';
    reboundVisibleSource.summary.layers.push({ id: 'second', src: 'stream://second', kind: 'image', isImage: true });
    assert.equal(classifyPreviewModelUpdate(visibleSourceChanged, reboundVisibleSource), 'rebuild');
});

test('削除と既存 source の変更は再構築する', () => {
    const before = model();
    const removed = structuredClone(before);
    removed.sourceUris = [];
    assert.equal(classifyPreviewModelUpdate(before, removed), 'rebuild');
    const changed = structuredClone(before);
    changed.sourceUris[0] = 'first=file:///changed.png';
    assert.equal(classifyPreviewModelUpdate(before, changed), 'rebuild');
});

test('配置中の台帳追加だけを自分の変更と認め、削除・差し替え・期限切れは除外する', () => {
    const content = references => JSON.stringify({ version: 0, references });
    const first = { category: 'still', id: 'one' };
    const second = { category: 'still', id: 'two' };
    const own = { content: content([first]), at: 1000, key: 'still/two', until: 1600 };
    assert.equal(isOwnAssetReferenceChange(own, content([first, second]), 1050, 500), true);
    const sorted = { content: content([second]), at: 1000, key: 'still/one', until: 1600 };
    assert.equal(isOwnAssetReferenceChange(sorted, content([first, second]), 1050, 500), true);
    assert.equal(isOwnAssetReferenceChange(own, content([]), 1050, 500), false);
    assert.equal(isOwnAssetReferenceChange(own, content([second]), 1050, 500), false);
    assert.equal(isOwnAssetReferenceChange(own, content([first, { ...second, id: 'three' }]), 1050, 500), false);
    assert.equal(isOwnAssetReferenceChange(own, content([first, { ...second, files: [] }]), 1050, 500), false);
    assert.equal(isOwnAssetReferenceChange(own, content([first, second]), 1700, 500), false);
});

test('台帳の変更通知は全体再構築せずモデル差分へ渡し、配置分の重複通知を省く', async () => {
    const sourceFile = ts.createSourceFile('handler.ts', readHandlerSource(), ts.ScriptTarget.Latest, true);
    let initializer;
    const visit = node => {
        if (ts.isVariableDeclaration(node) && node.name.getText(sourceFile) === 'handleFilesChanged')
            initializer = node.initializer.getText(sourceFile);
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    assert.ok(initializer);
    const body = ts.transpileModule(`const handleFilesChanged = ${initializer};
        exports.handler = handleFilesChanged;`, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
    const referencesUri = { toString: () => 'refs' };
    const editUri = { toString: () => 'edit', parent: { resolve: () => referencesUri } };
    const widget = { akariPreviewEditUri: editUri };
    const calls = [];
    const before = JSON.stringify({ version: 0, references: [{ category: 'still', id: 'z' }] });
    let content = JSON.stringify({ version: 0, references: [
        { category: 'still', id: 'a' }, { category: 'still', id: 'z' }] });
    const host = { readText: async () => content, resourceSuffix: () => 'edit', recentWriteAt: () => 0,
        queueRefresh: (...args) => calls.push(args) };
    const context = { ...host, exports: {}, widget, identityUri: editUri, kind: 'output',
        placement: { content: before, baseline: Promise.resolve(before), key: 'still/a',
            at: Date.now(), until: Date.now() + 1000 },
        RECENT_WRITE_WINDOW_MS: 1000, isOwnAssetReferenceChange, Date, Set, console };
    vm.runInContext(body, vm.createContext(context));
    const handler = context.exports.handler;
    handler({ changes: [{ resource: referencesUri }] });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 1);
    assert.equal(calls[0][4], false);
    handler({ changes: [{ resource: referencesUri }] });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 1, '同じ内容の重複通知は再読込しない');
    content = JSON.stringify({ version: 0, references: [{ category: 'still', id: 'a' }] });
    handler({ changes: [{ resource: referencesUri }] });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 2);
    assert.equal(calls[1][4], false, '参照の削除もモデル差分で再評価する');
    content = JSON.stringify({ version: 0, references: [
        { category: 'still', id: 'other' }, { category: 'still', id: 'z' }] });
    handler({ changes: [{ resource: referencesUri }] });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 3);
    assert.equal(calls[2][4], false, '別素材への入れ替えでも台帳だけでは全体再構築しない');
    const generatedKey = 'file:///project/assets/generated/frame-1.png';
    widget.akariPreviewTrackedResources = new Set([generatedKey]);
    widget.akariPreviewJustAddedUris = new Map([[generatedKey, Date.now()]]);
    const generated = { toString: () => generatedKey,
        path: { base: 'frame-1.png', toString: () => '/project/assets/generated/frame-1.png' } };
    handler({ changes: [{ resource: generated }] });
    assert.equal(calls.length, 3, '追加した仮枠の png の通知では全体更新しない');
});

test('queueCaptionsUpdate は送信した字幕を前回モデルの控えにも保存する', async () => {
    const body = methodBody('queueCaptionsUpdate');
    const code = ts.transpileModule(`class Subject {
        ${body}
        async loadPreviewCaptions() { return { captions: [{ id: 'c1', text: 'edited' }] }; }
        previewCaptionTimelineSegments() { return []; }
    }
    exports.Subject = Subject;`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    const sandbox = { exports: {}, console,
        normalizePreviewCaptionClock: captions => captions,
        buildCaptionAnimatorSummaryFields: captions => captions };
    vm.runInNewContext(code, sandbox);
    const sent = [];
    const widget = { akariPreviewRefresh: Promise.resolve(), akariPreviewSummary: {
        cuts: [], output: { fps: 30 }, captionTrackId: 'captions' },
    akariPreviewModelSnapshot: { captions: [{ id: 'c1', text: 'before' }] },
    isDisposed: false, sendMessage: message => sent.push(message) };
    new sandbox.exports.Subject().queueCaptionsUpdate(widget);
    await widget.akariPreviewCaptionsUpdate;
    assert.equal(sent[0].captions[0].text, 'edited');
    assert.equal(widget.akariPreviewModelSnapshot.captions[0].text, 'edited');
});

test('webview のモデル更新はページを保ったまま image layer の要素を 1 つ足す', async () => {
    const source = readFileSync(new URL('../src/browser/preview-script-bootstrap.ts', import.meta.url), 'utf8');
    const part = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
    const factory = part('const createLayerEntry =', 'const layerEntries =');
    const update = part('const applyIncrementalModel =', '// BEGIN preview bag response');
    assert.ok(factory.startsWith('const createLayerEntry ='));
    assert.ok(update.startsWith('const applyIncrementalModel ='));
    const children = [];
    const messages = [];
    const pageEvents = new Map();
    const element = tag => ({ tagName: tag.toUpperCase(), style: {}, dataset: {}, naturalWidth: 80,
        naturalHeight: 80, complete: true, addEventListener() {}, appendChild() {},
        removeAttribute() {}, remove() { const index = children.indexOf(this); if (index >= 0) children.splice(index, 1); },
        decode: () => Promise.resolve() });
    const initialLayer = { id: 'first', src: 'stream://first', kind: 'media', isImage: true };
    const nextLayer = { id: 'second', src: 'stream://second', kind: 'media', isImage: true };
    const page = { marker: 'same-page', requestAnimationFrame: callback => callback(),
        addEventListener: (type, listener) => pageEvents.set(type, listener), akari: {
        state: {}, runtime: {}, frameEngineClock: { updateModel: () => Promise.resolve() },
        reportReadySeek: message => messages.push(message), updateLayerLayout() {} } };
    const noop = () => {};
    const context = { exports: {}, window: page, document: { createElement: element },
        stage: { querySelector: () => null, querySelectorAll: () => [] }, captionRows: new Map(),
        CSS: { escape: value => value },
        layersStage: { appendChild: child => {
            const index = children.indexOf(child);
            if (index >= 0) children.splice(index, 1);
            children.push(child);
        } }, initialLayer,
        initial: { frameEngineEnabled: true, playbackPageId: 'page-1' },
        summary: { layers: [initialLayer], audio: {}, tracks: {} }, segments: [], activeSegmentIndex: 0,
        outputTime: 0, filterEntries: [], frameEngineMediaIdle: true, isPlaying: false,
        previewDomOpacityFn: () => '1', zForItem: () => 1, zForTrack: () => 1,
        setAdjustBaseFilter: noop, tick: noop, syncLayerHitRegion: noop,
        refreshAdjustCssApproximation: noop, refreshIndicators: noop, rebuildVisualTrackZ: noop,
        applyIncrementalLayerSpec: noop, syncDeclaredTrackStates: noop, rebuildSegments: noop,
        syncSegmentPlaybackRate: noop, applyCutVisual: noop, applyCutsZIndex: noop, applyOverlayTracks: noop,
        findLayerEntry: id => context.exports.layerEntries.find(entry => entry.spec.id === id),
        probeSfxDurations: () => Promise.resolve(), console };
    vm.runInNewContext(`${factory}\nconst layerEntries = [createLayerEntry(initialLayer, 0, true)];
        const optimisticallyRemovedIds = new Set();
        window.akari.optimisticallyRemovedIds = optimisticallyRemovedIds;
        let playbackModelUpdate;
        ${update}
        exports.layerEntries = layerEntries;
        exports.receive = message => {
            if (message.type === 'akari-preview-model-update') applyIncrementalModel(message.summary);
            if (message.type === 'akari-preview-optimistic-item-update') applyOptimisticItemUpdate(message);
        };`, context);
    pageEvents.get('akari-frame-engine-ready')();
    assert.equal(messages.at(-1)?.initialPaint, true);
    assert.equal(messages.at(-1)?.layerIds[0], 'first');
    const before = children.length;
    context.exports.receive({ type: 'akari-preview-model-update', summary: {
        layers: [initialLayer, nextLayer], audio: {}, tracks: {}, filters: [] } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(page.marker, 'same-page');
    assert.equal(children.length, before + 1);
    assert.equal(context.exports.layerEntries.length, 2);
    assert.equal(messages.at(-1)?.type, 'akari-preview-model-painted');
    assert.equal(messages.at(-1)?.layerIds[0], 'second');
    context.exports.receive({ type: 'akari-preview-optimistic-item-update', removedIds: ['first'] });
    assert.equal(context.exports.layerEntries[0].video.style.display, 'none');
    context.exports.receive({ type: 'akari-preview-optimistic-item-update', rollback: true });
    assert.equal(context.exports.layerEntries[0].video.style.display, '');
    context.exports.receive({ type: 'akari-preview-model-update', summary: {
        layers: [nextLayer, initialLayer], audio: {}, tracks: {}, filters: [] } });
    assert.deepEqual(children.map(child => child.dataset.akariLayerId), ['second', 'first']);
    assert.deepEqual([...context.exports.layerEntries].map(entry => entry.spec.id), ['second', 'first']);
    context.exports.receive({ type: 'akari-preview-model-update', summary: {
        layers: [nextLayer], audio: {}, tracks: {}, filters: [] } });
    assert.deepEqual(children.map(child => child.dataset.akariLayerId), ['second']);
    assert.deepEqual([...context.exports.layerEntries].map(entry => entry.spec.id), ['second']);
});

test('drop は最初の await より前にゴーストを控え、dragend 後も描画通知まで残す', async () => {
    const { PreviewLibraryDrop } = require('../lib/browser/preview-library-drop.js');
    const previousWindow = globalThis.window, previousDocument = globalThis.document;
    const held = { dataset: {}, style: {}, removed: false, remove() { this.removed = true; } };
    const children = [];
    const listeners = new Set();
    globalThis.window = { setTimeout, clearTimeout, requestAnimationFrame: callback => callback() };
    globalThis.document = { body: { appendChild: child => children.push(child) } };
    try {
        const drop = Object.create(PreviewLibraryDrop.prototype);
        drop.active = { kind: 'shape', preset: 'star-5' };
        drop.ghost = { style: { display: 'block' }, getBoundingClientRect: () => ({ left: 20, top: 30 }),
            cloneNode: () => held };
        drop.widget = { akariPreviewPlaybackPageId: 'page-1',
            node: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }) },
            onMessage(listener) { listeners.add(listener); return { dispose: () => listeners.delete(listener) }; } };
        drop.fullscreen = () => false;
        drop.editUri = () => 'edit.json';
        drop.pendingGeometryRequests = new Set();
        drop.clear = () => {
            drop.ghost = undefined;
            for (const request of drop.pendingGeometryRequests) request.dispose();
            drop.pendingGeometryRequests.clear();
        };
        drop.messages = { warn() {}, info() {} };
        const commands = [];
        drop.commands = { executeCommand: async (...args) => {
            commands.push(args);
            return args[0] === 'akari.timeline.addShapeAt' ? 'shape-1' : 'seeked';
        } };
        drop.geometry = { rect: { x: 0, y: 0, width: 200, height: 200 }, time: 0,
            output: { width: 200, height: 200 }, canvases: [] };
        let resolveGeometry;
        drop.queryGeometry = () => new Promise(resolve => {
            resolveGeometry = resolve;
            drop.pendingGeometryRequests.add({ dispose: () => resolve(undefined) });
        });
        const pending = drop.drop({ clientX: 50, clientY: 50, altKey: false,
            dataTransfer: { getData: () => '' }, preventDefault() {}, stopPropagation() {} });
        assert.equal(children[0], held, 'await 前に独立した要素を追加する');
        assert.equal(held.dataset.akariPlacedGhost, 'true');
        assert.equal(commands.length, 0, '直前の値があっても最新の位置情報を待つ');
        drop.clear();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(commands.length, 0, 'dragend でもドロップ用の問い合わせを打ち切らない');
        resolveGeometry({ rect: { x: 0, y: 0, width: 200, height: 200 }, time: 1,
            output: { width: 200, height: 200 }, canvases: [] });
        await pending;
        assert.equal(commands[0][1].t, 1, '新しい応答の時刻を使う');
        assert.equal(held.removed, false, 'dragend と配置完了では消さない');
        for (const listener of listeners) listener({ type: 'akari-preview-model-painted', pageId: 'page-1' });
        assert.equal(held.removed, true, '実際の描画通知で消す');
    } finally {
        globalThis.window = previousWindow;
        globalThis.document = previousDocument;
    }
});

test('ライブラリ画像のゴーストは source だけの更新では消えず layer の描画を待つ', async () => {
    const { PreviewLibraryDrop } = require('../lib/browser/preview-library-drop.js');
    const previousWindow = globalThis.window, previousDocument = globalThis.document;
    const held = { dataset: {}, style: {}, removed: false, remove() { this.removed = true; } };
    const listeners = new Set();
    globalThis.window = { setTimeout, clearTimeout, requestAnimationFrame: callback => callback() };
    globalThis.document = { body: { appendChild() {} } };
    try {
        const drop = Object.create(PreviewLibraryDrop.prototype);
        drop.active = { kind: 'asset', category: 'still', key: 'still/photo', width: 800 };
        drop.ghost = { style: { display: 'block' }, getBoundingClientRect: () => ({ left: 20, top: 30 }),
            cloneNode: () => held };
        drop.widget = { akariPreviewPlaybackPageId: 'page-1',
            node: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }) },
            onMessage(listener) { listeners.add(listener); return { dispose: () => listeners.delete(listener) }; } };
        drop.fullscreen = () => false;
        drop.editUri = () => 'edit.json';
        drop.pendingGeometryRequests = new Set();
        drop.clear = () => { drop.ghost = undefined; };
        drop.messages = { warn() {}, info() {} };
        drop.queryGeometry = async () => ({ rect: { x: 0, y: 0, width: 200, height: 200 }, time: 1,
            output: { width: 200, height: 200 }, canvases: [] });
        drop.commands = { executeCommand: async command => command === 'akari.catalog.planMaterial'
            ? { relativePath: 'assets/still/photo/photo.png', kind: 'image', cached: true } : undefined };
        drop.placeThenFetch = async () => {};
        await drop.drop({ clientX: 50, clientY: 50, altKey: false,
            dataTransfer: { getData: () => '' }, preventDefault() {}, stopPropagation() {} });
        for (const listener of listeners) listener({ type: 'akari-preview-model-painted', pageId: 'page-1', layerIds: [] });
        assert.equal(held.removed, false);
        for (const listener of listeners) listener({ type: 'akari-preview-model-painted', pageId: 'page-1', layerIds: ['photo'] });
        assert.equal(held.removed, true);
    } finally {
        globalThis.window = previousWindow;
        globalThis.document = previousDocument;
    }
});

test('ページを作り直した場合は新しいページの初回描画でゴーストを消す', async () => {
    const { PreviewLibraryDrop } = require('../lib/browser/preview-library-drop.js');
    const previousWindow = globalThis.window, previousDocument = globalThis.document;
    const held = { dataset: {}, style: {}, removed: false, remove() { this.removed = true; } };
    const listeners = new Set();
    globalThis.window = { setTimeout, clearTimeout, requestAnimationFrame: callback => callback() };
    globalThis.document = { body: { appendChild() {} } };
    try {
        const drop = Object.create(PreviewLibraryDrop.prototype);
        drop.active = { kind: 'asset', category: 'still', key: 'still/photo', width: 800 };
        drop.ghost = { style: { display: 'block' }, getBoundingClientRect: () => ({ left: 20, top: 30 }),
            cloneNode: () => held };
        drop.widget = { akariPreviewPlaybackPageId: 'page-1',
            node: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }) },
            onMessage(listener) { listeners.add(listener); return { dispose: () => listeners.delete(listener) }; } };
        drop.pendingGeometryRequests = new Set();
        drop.fullscreen = () => false;
        drop.editUri = () => 'edit.json';
        drop.clear = () => { drop.ghost = undefined; };
        drop.messages = { warn() {}, info() {} };
        drop.queryGeometry = async () => ({ rect: { x: 0, y: 0, width: 200, height: 200 }, time: 1,
            output: { width: 200, height: 200 }, canvases: [] });
        drop.commands = { executeCommand: async command => command === 'akari.catalog.planMaterial'
            ? { relativePath: 'assets/still/photo/photo.png', kind: 'image', cached: true } : undefined };
        drop.placeThenFetch = async () => {};
        await drop.drop({ clientX: 50, clientY: 50, altKey: false,
            dataTransfer: { getData: () => '' }, preventDefault() {}, stopPropagation() {} });
        drop.widget.akariPreviewPlaybackPageId = 'page-2';
        for (const listener of listeners) listener({ type: 'akari-preview-ready-seeked', pageId: 'page-2' });
        assert.equal(held.removed, false, '準備完了だけでは消さない');
        for (const listener of listeners) listener({ type: 'akari-preview-model-painted',
            pageId: 'page-2', initialPaint: true, layerIds: ['photo'] });
        assert.equal(held.removed, true);
    } finally {
        globalThis.window = previousWindow;
        globalThis.document = previousDocument;
    }
});

test('位置情報が 300 ms で得られなければ直前の値で置く', async () => {
    const { PreviewLibraryDrop } = require('../lib/browser/preview-library-drop.js');
    const drop = Object.create(PreviewLibraryDrop.prototype);
    drop.active = { kind: 'shape', preset: 'star-5' };
    drop.geometry = { rect: { x: 0, y: 0, width: 200, height: 200 }, time: 3,
        output: { width: 200, height: 200 }, canvases: [] };
    drop.widget = { node: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }) } };
    drop.pendingGeometryRequests = new Set();
    drop.fullscreen = () => false;
    drop.editUri = () => 'edit.json';
    drop.clear = () => {};
    drop.messages = { warn() {}, info() {} };
    drop.queryGeometry = async timeout => { assert.equal(timeout, 300); return undefined; };
    const commands = [];
    drop.commands = { executeCommand: async (...args) => {
        commands.push(args);
        return args[0] === 'akari.timeline.addShapeAt' ? 'shape-1' : 'seeked';
    } };
    await drop.drop({ clientX: 50, clientY: 50, altKey: false,
        dataTransfer: { getData: () => '' }, preventDefault() {}, stopPropagation() {} });
    assert.equal(commands[0][1].t, 3);
});
