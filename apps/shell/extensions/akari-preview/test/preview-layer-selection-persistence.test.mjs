import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readHandlerSource } from './helpers/handler-source.mjs';

const source = readHandlerSource();
const between = (start, end) => {
    const first = source.indexOf(start);
    const last = source.indexOf(end, first + start.length);
    assert.ok(first >= 0 && last > first, `${start} / ${end}`);
    return source.slice(first, last);
};

test('layer selected outside its interval survives entry and releases when its track is hidden', () => {
    const layer = { id: 'photo', t: 3, duration: 4, track: 'photo-track' };
    const reports = [];
    const context = vm.createContext({
        outputTime: 1, selectedLayerId: layer.id, selectedCaptionId: null,
        requestedCutId: undefined, requestedOverlayId: undefined,
        summary: { layers: [layer], cuts: [], overlays: [] }, captions: [],
        findLayerEntry: id => id === layer.id ? { spec: layer } : null,
        cutInteractionSegment: () => null,
        previewSelectionLeavesRangeFn: (before, now, start, end, hidden) =>
            before >= start && before < end && (now < start || now >= end || hidden),
        allTracksHiddenByScope: { layers: false, cuts: false },
        hiddenTracksByScope: { layers: new Set(), cuts: new Set() },
        hiddenTracks: new Set(),
        window: { akari: { interaction: {}, reportContextBox: message => reports.push(message.user) } },
        selectLayer: id => { context.selectedLayerId = id; reports.push(['layer', id]); }
    });
    vm.runInContext(between('let previousPreviewSelectionTime =', 'const renderCaption = () => {'), context);
    for (const time of [1.5, 3, 5.5]) {
        context.window.akari.expirePreviewSelections(time);
        assert.equal(context.selectedLayerId, 'photo', `time ${time}`);
    }
    assert.deepEqual(reports, []);
    context.hiddenTracksByScope.layers.add('photo-track');
    context.window.akari.expirePreviewSelections(5.5);
    assert.equal(context.selectedLayerId, null);
    assert.deepEqual(reports, ['seek', ['layer', null]]);
});

test('host selection outside the layer interval immediately marks the selection box dashed', () => {
    const classes = new Set();
    const box = { style: {}, dataset: {}, classList: {
        add: name => classes.add(name), remove: name => classes.delete(name),
        toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name)
    } };
    const layer = { spec: { id: 'photo', t: 3, duration: 4, track: 'photo-track',
        transform: { x: 12, y: 4, scale: 1 } },
    video: { videoWidth: 0, videoHeight: 0, readyState: 0, addEventListener() {} } };
    const context = vm.createContext({
        selectedLayerId: null, outputTime: 1, cropModeActive: false,
        perspectivePanelOpen: false, activePerspectivePreset: null,
        layerPerspectivePresetButtons: [],
        findLayerEntry: id => id === 'photo' ? layer : null,
        frameEngineMediaIdle: true, window: { akari: { interaction: { clearSelection() {} } } },
        summary: { output: { width: 1280, height: 720 } },
        allTracksHiddenByScope: { layers: false }, hiddenTracksByScope: { layers: new Set() },
        layerSelectBox: box, positionLayerCropToggle() {}, positionLayerPerspectiveToggle() {},
        motionAtForSpec: () => ({ visible: { opacity: 1 } }),
        layerTransformNow: () => ({ x: 0, y: 0, scale: 1, rotate: 0 }),
        layerCropNow: () => ({ x: 0, y: 0, w: 1, h: 1 }),
        layerScreenRectForVideoRect: () =>
            ({ left: 12, top: 4, width: 1280, height: 720, rotOffX: 0, rotOffY: 0 }),
        deselectCut() {}, deselectCaption() {},
        applyCropEdgeVisibility() {},
        layerPerspectiveToggle: { classList: { toggle() {} } }, layerPerspectiveNow: () => null,
        message: { type: 'akari-preview-select-layer', layerId: 'photo' }
    });
    const update = between('const updateLayerSelectBox = () => {', "window.addEventListener('message', event => {")
        .replaceAll('(${resolveLayerDeclaredSize.toString()})',
            '((w, h, output) => w > 0 && h > 0 ? { width: w, height: h } : output)');
    const select = between('const selectLayer = (layerId, options) => {', 'const photoBrushMapPoint =');
    const host = between("if (message && message.type === 'akari-preview-select-layer'",
        "if (message && message.type === 'akari-preview-adjust-bypass'");
    vm.runInContext(`${update}\n${select}\n${host}`, context);
    assert.equal(context.selectedLayerId, 'photo');
    assert.equal(classes.has('is-active'), true);
    assert.equal(classes.has('akari-selected-invisible'), true);
    assert.equal(box.style.width, '1280px');
    context.outputTime = 5.5;
    vm.runInContext('updateLayerSelectBox()', context);
    assert.equal(classes.has('is-active'), true);
    assert.equal(classes.has('akari-selected-invisible'), false);
});

test('both preview tick paths update the layer box after rendering layer visibility', () => {
    const tick = between('const tick = (immediatePlaybackTick = false) => {', 'const startAnimation =');
    assert.equal((tick.match(/renderLayers\(outputTime\);\s*if \(typeof syncVideoCandidatePreview[^;]+;\s*updateLayerSelectBox\(\);/gu) || []).length, 2);
});
