import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import { previewMotionLiveItem } from '../lib/common/preview-motion-geometry.js';
import { readHandlerSource } from './helpers/handler-source.mjs';

const browser = readFileSync(new URL('../src/browser/preview-script-bootstrap.ts', import.meta.url), 'utf8');
const frameEngine = readFileSync(new URL('../src/browser/preview-script-frame-engine-bootstrap.ts', import.meta.url), 'utf8');
const adapter = readFileSync(new URL('../src/browser/preview-script-host-adapter.ts', import.meta.url), 'utf8');
const style = readFileSync(new URL('../src/browser/preview-selection-handles-style.ts', import.meta.url), 'utf8');
const handler = readHandlerSource();
const require = createRequire(import.meta.url);
const itemMotion = require('../../../../../packages/overlay-runtime/src/item-motion.js');
const section = (source, start, end) => {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, start);
    return source.slice(from, to);
};
const flags = section(browser, '            let selectionDragActive =', '            let suppressClick =');

test('クロップ確定・取消・選択変更の各経路を抜けたあと beginMediaTransformDrag が効く', async () => {
    const crop = section(browser, '            const setCropMode =', '            // click ではなく pointerdown+pointerup');
    const gate = section(browser, '            const beginMediaTransformDrag =', '                const pointerId =');
    const select = section(browser, '            const selectLayer =', '            const photoBrushMapPoint =');
    const cropButtons = section(browser,
        "            photoCropPanel.querySelector('[data-photo-crop-done]')",
        "            photoCropPanel.querySelector('[data-photo-crop-auto]')");
    const classList = { add() {}, remove() {}, toggle() {} };
    for (const route of ['done', 'cancel', 'selection']) {
        let resolveWrite;
        const clicks = new Map();
        const target = {
            kind: 'layer', entry: {}, cropNow: () => ({ x: 0.2 }), transformNow: () => ({ x: 20 }),
            restoreCrop() {}, flushCrop() {}, canWrite: () => true,
            write: () => new Promise(resolve => { resolveWrite = resolve; })
        };
        const context = vm.createContext({
            window: { akari: { reportGesture() {}, reportLayerSelection() {},
                interaction: { clearSelection() {} } } }, document: { body: { classList } },
            cropModeCancelRequested: false, cropModeActive: true, photoCropTarget: target,
            photoCropSnapshot: { restore: {}, transform: { x: 0 } }, photoCropDirty: route !== 'cancel',
            photoCropItemId: 'photo-a', selectedLayerId: 'photo-a', cutSelected: false,
            isPlaying: false,
            photoCropPanel: { classList, querySelector: name => ({
                addEventListener: (_event, listener) => clicks.set(name, listener)
            }) }, layerCropToggle: { classList }, layerCropBox: { classList },
            layerSelectBox: { classList }, cutSelectBox: { classList },
            photoCropTransformPatchFn: () => ({}), updateLayerSelectBox() {},
            findLayerEntry: id => ({ spec: { id } }), perspectivePanelOpen: false,
            layerPerspectivePresetButtons: [], deselectCut() {}, deselectCaption() {}
        });
        vm.runInContext(`${flags}\n${crop}\n${select}\n${cropButtons}\n${gate} return selectionDragActive; };\n`
            + 'globalThis.check = () => beginMediaTransformDrag({ kind: "layer", entry: {} },'
            + ' { preventDefault() {}, stopPropagation() {} });', context);
        if (route === 'selection') vm.runInContext("selectLayer('photo-b')", context);
        else clicks.get(`[data-photo-crop-${route}]`)();
        assert.equal(vm.runInContext('selectionDragActive', context), false, route);
        assert.equal(vm.runInContext('check()', context), true, route);
        resolveWrite?.();
    }
});

test('保存待ち中は移動・回転つまみの visibility が hidden にならない', () => {
    const report = section(adapter, '            window.akari.reportGesture = phase => {', '            let pendingLiveValues =');
    assert.doesNotMatch(report, /classList/u);
    assert.match(style, /body\.akari-selection-gesture-active :is\([^\n]*akari-layer-handle-move[^\n]*\) \{ visibility: hidden !important; \}/u);
    assert.match(browser, /selectionDragActive = true;\s*document\.body\.classList\.add\('akari-selection-gesture-active'\)/u);
    assert.match(browser, /selectionDragActive = false;\s*document\.body\.classList\.remove\('akari-selection-gesture-active'\)/u);
});

test('掴んでいる間のモデル更新は最新だけ保留し、離して保存後に一度だけ適用する', () => {
    const receive = section(browser, "                if (message && message.type === 'akari-preview-model-update') {",
        "                if (message && message.type === 'akari-preview-set-muted'");
    const applied = [];
    const context = vm.createContext({
        window: { akari: { reportGesture() {} } },
        clearLiveOverride() {}, applyIncrementalModel: summary => applied.push(summary)
    });
    vm.runInContext(`${flags}\nglobalThis.begin = beginSelectionGesture;`
        + `globalThis.end = endSelectionGesture;`
        + `globalThis.receive = message => { ${receive} };`, context);
    const gesture = context.begin({ kind: 'layer', entry: { spec: { id: 'image' } },
        transformNow: () => ({ x: 99 }), cropNow: () => ({ x: 0.2 }) });
    context.receive({ type: 'akari-preview-model-update', summary: {
        position: 1, layers: [{ id: 'image', transform: { x: 0 } }] } });
    context.receive({ type: 'akari-preview-model-update', summary: {
        position: 2, layers: [{ id: 'image', transform: { x: 1 } }] } });
    assert.equal(applied.length, 0);
    context.end(gesture);
    assert.deepEqual(JSON.parse(JSON.stringify(applied)), [{ position: 2, layers: [{ id: 'image',
        transform: { x: 99 }, crop: { x: 0.2 } }] }]);
    context.end(gesture);
    assert.equal(applied.length, 1);
});

for (const kind of ['layer', 'cut']) {
    for (const savedBeforeSecondGrab of [false, true]) {
        test(`${kind}: model-update 前に掴み直しても直前の位置から動き、保存値に残る（保存応答${savedBeforeSecondGrab ? '後' : '前'}）`, async () => {
            const drag = section(browser, '            const beginMediaTransformDrag =', '            const pointerTranslationFrom =');
            const listeners = new Map();
            const writes = [], pendingWrites = [];
            const staleItem = { at: 0, duration: 10, fps: 30, transform: {
                x: 600, y: 0, scale: 1, rotate: 0 } };
            let current = { x: 600, y: 0, scale: 1, rotate: 0 };
            const media = { dataset: { akariCutId: 'photo-3' } };
            const target = {
                kind, media, entry: kind === 'layer' ? { spec: { id: 'photo-3' } } : null,
                transformNow: () => ({ ...current }), cropNow: () => ({}),
                motionAt: () => ({ item: staleItem, parents: [], time: 0,
                    visible: itemMotion.evaluateItemMotion(staleItem, 0) }),
                applyTransform: transform => { current = { ...transform }; }, flushTransform() {},
                canWrite: () => true,
                write: patch => {
                    writes.push(patch);
                    return new Promise(resolve => pendingWrites.push(resolve));
                }
            };
            const classList = { add() {}, remove() {} };
            const context = vm.createContext({
                window: { akari: { itemMotion, reportGesture() {}, interaction: { hideSnapGuides() {} } },
                    addEventListener: (name, listener) => listeners.set(name, listener),
                    removeEventListener: name => listeners.delete(name) },
                document: { body: { classList, style: {}, appendChild() {} },
                    createElement: () => ({ style: {}, setAttribute() {}, remove() {} }) },
                previewMotionLiveItemFn: previewMotionLiveItem,
                isPlaying: false, CLICK_THRESHOLD_PX: 3
            });
            vm.runInContext(`${flags}\n${drag}\nglobalThis.begin = beginMediaTransformDrag;`, context);
            const capture = { getAttribute: () => null, setPointerCapture() {}, hasPointerCapture: () => false };
            const event = (x, y) => ({ pointerId: 1, currentTarget: capture, clientX: x, clientY: y,
                preventDefault() {}, stopPropagation() {} });
            const grab = () => context.begin(target, event(0, 0), (move, original) => ({
                ...original, x: original.x + move.clientX, y: original.y + move.clientY
            }));
            grab();
            listeners.get('pointerup')(event(-150, 0));
            assert.equal(writes[0].transform.x, 450);
            if (savedBeforeSecondGrab) {
                pendingWrites[0]();
                await new Promise(resolve => setImmediate(resolve));
            }
            grab();
            listeners.get('pointermove')(event(0, 20));
            assert.equal(current.x, 450, '最初の move で古い spec の x=600 へ戻さない');
            assert.equal(current.y, 20);
            listeners.get('pointerup')(event(0, 20));
            assert.equal(writes[1].transform.x, 450);
            assert.equal(writes[1].transform.y, 20);
            if (!savedBeforeSecondGrab) pendingWrites[0]();
            pendingWrites[1]();
            await new Promise(resolve => setImmediate(resolve));
        });
    }
}

test('字幕ドラッグ単独は即時適用し、画像保存中の保留は字幕ドラッグ中でも一度だけ適用する', () => {
    const receive = section(browser, "                if (message && message.type === 'akari-preview-model-update') {",
        "                if (message && message.type === 'akari-preview-set-muted'");
    assert.equal([...browser.matchAll(/flushPendingSelectionModel\(\)/gu)].length, 1);
    for (const imageSavePending of [false, true]) {
        const applied = [];
        const context = vm.createContext({
            window: { akari: { reportGesture() {} } },
            clearLiveOverride() {}, applyIncrementalModel: summary => applied.push(summary)
        });
        vm.runInContext(`${flags}\nglobalThis.begin = beginSelectionGesture;`
            + `globalThis.end = endSelectionGesture;`
            + `globalThis.grabCaption = () => { selectionDragActive = true; };`
            + `globalThis.releaseCaption = () => { selectionDragActive = false; };`
            + `globalThis.pending = () => pendingSelectionModel;`
            + `globalThis.receive = message => { ${receive} };`, context);
        const image = { kind: 'layer', entry: { spec: { id: 'image' } },
            transformNow: () => ({ x: 12 }), cropNow: () => ({ x: 0.1 }) };
        const gesture = imageSavePending ? context.begin(image) : null;
        if (imageSavePending) context.receive({ type: 'akari-preview-model-update',
            summary: { revision: 1, layers: [{ id: 'image', transform: { x: 0 } }] } });
        context.grabCaption();
        context.receive({ type: 'akari-preview-model-update',
            summary: { revision: 2, layers: [{ id: 'image', transform: { x: 0 } }] } });
        assert.equal(applied.length, imageSavePending ? 0 : 1);
        if (gesture) context.end(gesture);
        assert.equal(applied.length, 1);
        assert.equal(applied[0].revision, 2);
        if (imageSavePending) assert.equal(applied[0].layers[0].transform.x, 12);
        assert.equal(context.pending(), null);
        context.releaseCaption();
        assert.equal(applied.length, 1);
    }
});

test('ページ作り直しと widget 消滅で previewGestureGuards が解ける', async () => {
    assert.match(handler, /widget\.disposed\.connect\(\(\) => \{\s*disposables\.dispose\(\);\s*this\.previewGestureGuards\?\.delete\(widget\)/u);
    assert.match(handler, /this\.previewGestureGuards\?\.delete\(widget\);\s*widget\.setHTML\(this\.prepareHtml/u);
    assert.match(handler, /this\.previewGestureGuards\?\.delete\(widget\);\s*widget\.setHTML\(this\.prepareMessageHtml/u);
    const guards = new WeakMap();
    const widget = {};
    guards.set(widget, { active: true });
    vm.runInNewContext('this.previewGestureGuards.delete(widget)', { previewGestureGuards: guards, widget });
    assert.equal(guards.has(widget), false);
    assert.match(handler, /const previousSnapshot = widget\.akariPreviewModelSnapshot;\s*const previousSummary = widget\.akariPreviewSummary;/u);
    const sendGuard = section(handler, '                if (this.previewGestureGuards?.get(widget)?.active) {',
        "                widget.sendMessage({ type: 'akari-preview-captions-update'");
    const savedSnapshot = { generation: 1 }, savedSummary = { generation: 1 };
    const queued = [];
    widget.akariPreviewModelSnapshot = { generation: 2 };
    widget.akariPreviewSummary = { generation: 2 };
    guards.set(widget, { active: true });
    const host = { previewGestureGuards: guards, queueRefresh: (...args) => queued.push(args),
        disposeAssetStreams: async () => {} };
    const recheck = vm.runInNewContext(`(async function () { ${sendGuard} })`, {
        widget, previousSnapshot: savedSnapshot, previousSummary: savedSummary,
        identityUri: {}, kind: 'output', initialSeekTime: 3, forceRebuild: false,
        model: { assetStreamIds: [] }
    });
    await recheck.call(host);
    assert.equal(widget.akariPreviewModelSnapshot, savedSnapshot);
    assert.equal(widget.akariPreviewSummary, savedSummary);
    assert.equal(queued.length, 1);
    assert.equal(queued[0][4], false, '送る直前の再確認は forceRebuild を立てない');
});

test('frame-engine のライブ更新では audio と cuts を stringify しない', () => {
    const audio = section(frameEngine, '                    const audioChanged =', '                    if (rebuildServices) {');
    const cuts = section(frameEngine, '                        const retainAudioSupply =', '                        const resume =');
    let calls = 0;
    vm.runInNewContext(`${audio}\n${cuts}`, {
        rebuildServices: false, engineSummary: { audio: {} }, nextSummary: { audio: {} },
        nextDuration: 1, totalDuration: 1, nextCuts: [], normalizedCuts: [],
        JSON: { stringify: () => { calls += 1; return '{}'; } }
    });
    assert.equal(calls, 0);
});
