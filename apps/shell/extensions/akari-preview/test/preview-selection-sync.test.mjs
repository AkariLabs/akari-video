import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePreviewItemStackOrder } from '../lib/common/caption-track-order.js';
import { partitionPreviewMediaPlanes } from '../lib/common/preview-media-planes.js';
import { frontmostPreviewHit } from '../lib/common/preview-photo-hit.js';
import { harness as captionHarness } from './caption-animator-webview-harness.mjs';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const harness = options => {
    const view = captionHarness(options);
    view.context.document.getElementById('caption-plate').style = { visibility: 'visible' };
    Object.assign(view.context, {
        hiddenTracks: new Set(), hiddenTracksByScope: { cuts: new Set(), layers: new Set() },
        allTracksHiddenByScope: { cuts: false, layers: false },
        stage: { querySelector: () => null, querySelectorAll: () => [] }
    });
    view.context.window.akari.interaction.selectFromTimeline = () => {};
    return view;
};
const openHandlerSource = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');

test('seeking away releases every selected visual kind for host notification', () => {
    const view = harness({ cues: [{ id: 'caption-a', start: 0, end: 3, text: 'A' }] });
    const notified = [];
    const events = [];
    view.context.window.akari.reportContextBox = message => events.push(['context', message.user]);
    view.context.window.akari.reportCaptionSelection = id => notified.push(['caption', id]);
    view.context.window.akari.reportLayerSelection = id => notified.push(['layer', id]);
    view.context.window.akari.reportCutSelection = id => notified.push(['cut', id]);
    view.context.window.akari.reportOverlaySelection = id => notified.push(['overlay', id]);
    view.context.window.akari.interaction.clearSelection = () => {};
    view.context.stage = { querySelector: () => null, querySelectorAll: () => [] };
    view.context.summary.layers = [{ id: 'photo-a', t: 0, duration: 3 }];
    view.context.summary.overlays = [{ id: 'shape-a', start: 0, duration: 3 }];
    view.context.findLayerEntry = () => ({ spec: view.context.summary.layers[0] });
    view.context.cutInteractionSegment = () => ({ id: 'cut-a', outStart: 0, outEnd: 3 });
    view.run("selectCaption('caption-a', { report: false });");
    view.context.selectedLayerId = 'photo-a';
    view.context.requestedCutId = 'cut-a';
    view.context.cutSelected = true;
    view.run("requestedOverlayId = 'shape-a';");
    view.context.window.akari.interaction.selectedId = 'shape-a';
    view.tick(1);
    assert.equal(view.context.selectedCaptionId, 'caption-a');
    view.tick(2);
    assert.deepEqual(events, [], 'an in-range tick sends no user input');
    view.tick(6);
    assert.equal(view.context.selectedCaptionId, null);
    assert.equal(view.context.selectedLayerId, null);
    assert.equal(view.context.requestedCutId, undefined);
    assert.equal(view.run('requestedOverlayId'), undefined);
    assert.deepEqual(notified, [['caption', null], ['layer', null], ['cut', null], ['overlay', null]]);
    assert.deepEqual(events, [['context', 'seek']], 'one user input precedes all release reports');
});

test('a caption explicitly selected while invisible survives until it becomes visible and leaves again', () => {
    const view = harness({ cues: [{ id: 'caption-a', start: 0, end: 3, text: 'A' }] });
    const notified = [];
    view.context.stage = { querySelector: () => null, querySelectorAll: () => [] };
    view.context.window.akari.reportCaptionSelection = id => notified.push(id);
    view.tick(6);
    view.run("selectCaption('caption-a', { report: false });");
    view.tick(6);
    assert.equal(view.context.selectedCaptionId, 'caption-a');
    assert.deepEqual(notified, []);
    view.tick(1);
    assert.equal(view.context.selectedCaptionId, 'caption-a');
    view.tick(6);
    assert.equal(view.context.selectedCaptionId, null);
    assert.deepEqual(notified, [null]);
});

test('range crossing depends on time rather than a reloaded DOM selection', () => {
    const view = harness();
    assert.equal(view.run('previewSelectionLeavesRangeFn(1, 6, 0, 3)'), true);
    assert.equal(view.run('previewSelectionLeavesRangeFn(6, 7, 0, 3)'), false);
    assert.equal(view.run('previewSelectionLeavesRangeFn(1, 1, 0, 3)'), false);
});

test('invisible layer, cut and overlay requests survive until each crosses out of visibility', () => {
    const view = harness();
    const notified = [];
    view.context.stage = { querySelector: () => null, querySelectorAll: () => [] };
    view.context.window.akari.reportLayerSelection = id => notified.push(['layer', id]);
    view.context.window.akari.reportCutSelection = id => notified.push(['cut', id]);
    view.context.window.akari.reportOverlaySelection = id => notified.push(['overlay', id]);
    view.context.window.akari.interaction.clearSelection = () => {};
    view.tick(6);
    view.context.summary.layers = [{ id: 'photo-a', t: 0, duration: 3 }];
    view.context.summary.overlays = [{ id: 'shape-a', start: 0, duration: 3 }];
    view.context.findLayerEntry = () => ({ spec: view.context.summary.layers[0] });
    view.context.cutInteractionSegment = () => ({ id: 'cut-a', outStart: 0, outEnd: 3 });
    view.context.selectedLayerId = 'photo-a';
    view.context.requestedCutId = 'cut-a';
    view.context.cutSelected = true;
    view.run("requestedOverlayId = 'shape-a';");
    view.tick(6);
    assert.equal(view.context.selectedLayerId, 'photo-a');
    assert.equal(view.context.requestedCutId, 'cut-a');
    assert.equal(view.run('requestedOverlayId'), 'shape-a');
    assert.deepEqual(notified, []);
    view.context.window.akari.interaction.selectedId = 'shape-a';
    view.tick(1);
    view.tick(6);
    assert.deepEqual(notified, [['layer', null], ['cut', null], ['overlay', null]]);
});

test('a clicked photo and cut release on the first seek without an intervening tick', () => {
    for (const kind of ['layer', 'cut']) {
        const view = harness();
        const notified = [];
        view.context.stage = { querySelector: () => null, querySelectorAll: () => [] };
        view.context.outputTime = 1;
        if (kind === 'layer') {
            const entry = { spec: { id: 'photo-a', t: 0, duration: 3 }, video: { style: { display: 'block' } } };
            view.context.findLayerEntry = () => entry;
            view.context.window.akari.reportLayerSelection = id => notified.push(id);
            view.run("selectLayer('photo-a', { visibleHit: true });");
            assert.equal(view.context.selectedLayerId, 'photo-a');
        } else {
            view.context.video.dataset = { akariCutId: 'cut-a', akariCutIndex: '0' };
            view.context.cutSelectionVideo = () => view.context.video;
            view.context.cutInteractionSegment = () => ({ id: 'cut-a', outStart: 0, outEnd: 3 });
            view.context.window.akari.reportCutSelection = id => notified.push(id);
            view.run('selectCut({ visibleHit: true });');
            assert.equal(view.context.requestedCutId, 'cut-a');
        }
        view.tick(6);
        assert.deepEqual(notified, [kind === 'layer' ? 'photo-a' : 'cut-a', null]);
    }
});

test('the requested cut expires by its own range after another cut becomes active', () => {
    const view = harness();
    const notified = [];
    view.context.summary.cuts = [{ id: 'cut-a', outStart: 0, outEnd: 3 }];
    view.context.cutInteractionSegment = () => ({ id: 'cut-b', outStart: 6, outEnd: 9 });
    view.context.requestedCutId = 'cut-a';
    view.context.cutSelected = true;
    view.context.window.akari.reportCutSelection = id => notified.push(id);
    view.tick(1);
    view.tick(6);
    assert.equal(view.context.requestedCutId, undefined);
    assert.deepEqual(notified, [null]);
});

test('IX selection of a shape or HTML releases on the first seek without an intervening tick', () => {
    const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
    const start = source.indexOf('let lastReportedOverlayId = null;');
    const end = source.indexOf("window.addEventListener('akari-preview-scope-selection'", start);
    for (const id of ['shape-a', 'html-a-item']) {
        const view = harness();
        const notified = [];
        view.context.outputTime = 1;
        view.context.summary.overlays = [{ id, start: 0, duration: 3 }];
        view.context.stage = { querySelector: () => null, querySelectorAll: () => [] };
        Object.assign(view.context.window.akari.interaction,
            { hasSelectionTree: true, selectedId: id, selectedIds: [id], selectFromTimeline() {}, clearSelection() {} });
        view.context.window.akari.reportOverlaySelection = value => notified.push(value);
        view.run(source.slice(start, end));
        view.run('reportOverlaySelectionChange(true);');
        assert.equal(view.run('requestedOverlayId'), id);
        view.tick(6);
        assert.equal(view.run('requestedOverlayId'), undefined);
        assert.deepEqual(notified, [id, null]);
    }
});

test('the overlay selection bridge preserves an explicit invisible request', () => {
    const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
    const start = source.indexOf('let lastReportedOverlayId = null;');
    const end = source.indexOf("window.addEventListener('akari-preview-scope-selection'", start);
    assert.ok(start >= 0 && end > start);
    const notified = [];
    const context = vm.createContext({
        stage: { querySelector: () => null }, requestedOverlayId: 'shape-a', applyingOverlaySelection: undefined,
        summary: { overlays: [{ id: 'shape-a', start: 0, duration: 3 }] }, outputTime: 6,
        overlaySelectionInRange: (id, time) => id === 'shape-a' && time >= 0 && time < 3,
        window: { akari: { interaction: { hasSelectionTree: true, selectedId: null, selectedIds: [] },
            reportOverlaySelection: id => notified.push(id) } }
    });
    vm.runInContext(source.slice(start, end), context);
    vm.runInContext('reportOverlaySelectionChange(true, false);', context);
    assert.equal(vm.runInContext('requestedOverlayId', context), 'shape-a');
    assert.deepEqual(notified, []);
    context.outputTime = 1;
    vm.runInContext('reportOverlaySelectionChange(true);', context);
    assert.equal(vm.runInContext('requestedOverlayId', context), undefined);
    assert.deepEqual(notified, [null]);
});

test('reload null report and host resend still release a dragged shape or HTML on seek', () => {
    const start = openHandlerSource.indexOf('let lastReportedOverlayId = null;');
    const end = openHandlerSource.indexOf("window.addEventListener('akari-preview-scope-selection'", start);
    const resendStart = openHandlerSource.indexOf("if (message && message.type === 'akari-preview-select-overlay'");
    const resendEnd = openHandlerSource.indexOf("if (message && message.type === 'akari-preview-select-layer'", resendStart);
    for (const id of ['shape-a', 'html-a-item']) {
        const view = harness();
        const notified = [];
        const events = [];
        view.context.summary.overlays = [{ id, start: 0, duration: 3 }];
        view.context.stage = { querySelector: () => null, querySelectorAll: () => [] };
        Object.assign(view.context.window.akari.interaction, {
            hasSelectionTree: true, selectedId: id, selectedIds: [id], clearSelection() {}
        });
        view.context.window.akari.reportOverlaySelection = value => {
            notified.push(value);
            events.push(['overlay', value]);
        };
        view.context.window.akari.reportContextBox = message => events.push(['context', message.user]);
        view.run(openHandlerSource.slice(start, end));
        view.tick(1);
        view.run('reportOverlaySelectionChange(true);');
        view.context.window.akari.interaction.selectedId = null;
        view.context.window.akari.interaction.selectedIds = [];
        view.run('reportOverlaySelectionChange(true);'); // IX selection lost during reload
        view.context.message = { type: 'akari-preview-select-overlay', overlayId: id };
        view.run(openHandlerSource.slice(resendStart, resendEnd)); // host resend, no DOM
        events.length = 0;
        view.tick(6);
        assert.equal(view.run('requestedOverlayId'), undefined);
        assert.equal(view.context.window.akari.interaction.selectedId, null);
        assert.equal(notified.at(-1), null);
        assert.deepEqual(events, [['context', 'seek'], ['overlay', null]]);
    }
});

test('reload and host resend release a dragged photo on seek', () => {
    const view = harness();
    const notified = [];
    const events = [];
    const entry = { spec: { id: 'photo-a', t: 0, duration: 3 }, video: { style: { display: 'none' } } };
    view.context.findLayerEntry = () => entry;
    view.context.window.akari.reportLayerSelection = id => {
        notified.push(id);
        events.push(['layer', id]);
    };
    view.context.window.akari.reportContextBox = message => events.push(['context', message.user]);
    view.tick(1);
    view.run("selectLayer('photo-a', { report: false });");
    const start = openHandlerSource.indexOf("if (message && message.type === 'akari-preview-select-layer'");
    const end = openHandlerSource.indexOf("if (message && message.type === 'akari-preview-adjust-bypass'", start);
    view.context.message = { type: 'akari-preview-select-layer', layerId: 'photo-a' };
    view.run(openHandlerSource.slice(start, end)); // host resend, no visible DOM
    events.length = 0;
    view.tick(6);
    assert.equal(view.context.selectedLayerId, null);
    assert.deepEqual(notified, [null]);
    assert.deepEqual(events, [['context', 'seek'], ['layer', null]]);
});

test('captions update after a drag does not lose subtitle or output text seek release', () => {
    for (const cue of [
        { id: 'subtitle-a', start: 0, end: 3, text: 'subtitle' },
        { id: 'text-a', sourceCueId: 'text-source', time_domain: 'output', start: 0, end: 3, text: 'text' }
    ]) {
        const view = harness({ cues: [cue] });
        const notified = [];
        const events = [];
        view.context.window.akari.reportCaptionSelection = id => {
            notified.push(id);
            events.push(['caption', id]);
        };
        view.context.window.akari.reportContextBox = message => events.push(['context', message.user]);
        view.tick(1);
        view.run(`selectCaption(${JSON.stringify(cue.sourceCueId || cue.id)}, { report: false });`);
        view.context.captions = [{ ...cue }]; // captions-update after the write
        view.tick(6);
        assert.equal(view.context.selectedCaptionId, null);
        assert.deepEqual(notified, [null]);
        assert.deepEqual(events, [['context', 'seek'], ['caption', null]]);
    }
});

test('pointerdown passes invisible layer and overlay rectangles through to the visible cut', () => {
    const hitStart = openHandlerSource.indexOf('const findVisualMediaHitAt = event => {');
    const hitEnd = openHandlerSource.indexOf('libraryMediaHitAt = findVisualMediaHitAt;', hitStart);
    const downStart = openHandlerSource.indexOf('const handleVisualMediaPointerDown = event => {');
    const downEnd = openHandlerSource.indexOf("layersStage.addEventListener('pointerdown', handleVisualMediaPointerDown", downStart);
    assert.ok(hitStart >= 0 && hitEnd > hitStart && downStart >= 0 && downEnd > downStart);
    const cut = { dataset: { akariCutIndex: '0', akariCutId: 'cut-base' }, style: { zIndex: '1' },
        getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 100 }) };
    const stage = { closest: () => null };
    const overlay = { start: 0, duration: 3, style: { visibility: 'hidden' } };
    for (const hidden of [
        { t: 0, duration: 3, style: { display: 'none', zIndex: '10' }, time: 6 },
        { t: 0, duration: 3, style: { visibility: 'hidden', zIndex: '10' }, time: 6 },
        { t: 0, duration: 3, opacity: 0, style: { zIndex: '10' }, time: 1 }
    ]) {
        const selected = [];
        const stale = { spec: { id: 'photo-b', t: hidden.t, duration: hidden.duration,
            opacity: hidden.opacity, track: 1 },
        video: { style: hidden.style, videoWidth: 100, videoHeight: 100 } };
        const context = vm.createContext({
            window: { akari: { frameEngineClock: {}, shouldStartPreviewMarquee: () => false,
                interaction: {} } }, frameEngineMediaIdle: true, outputTime: hidden.time,
            layerEntries: [stale], summary: { output: { width: 100, height: 100 } },
            video: cut, stillImage: {}, previewStage: stage, layersStage: {}, stage: {},
            segments: [{ kind: 'src', track: 0 }], activeSegmentIndex: 0,
            allTracksHiddenByScope: { cuts: false, layers: false },
            hiddenTracksByScope: { cuts: new Set(), layers: new Set() }, hiddenTracks: new Set(),
            layerGeometryHitAt: () => true, motionAtForSpec: () => null,
            initial: { imageSources: {} }, cutInteractionSegment: () => ({ id: 'cut-base' }),
            pointerTranslationFrom: () => () => ({ x: 0, y: 0 }), cutDragTarget: () => ({}),
            beginMediaTransformDrag() {}, selectCut: () => selected.push('cut-base'),
            selectLayer: id => selected.push(id), findLayerEntry: () => stale,
            deselectCaption: () => selected.push('caption-cleared'), selectedCaptionId: 'caption-a',
            penModeActive: false, rectModeActive: false, cropModeActive: false,
            activeCaptionEdit: null, handledVisualPointerDownEvents: new WeakSet(),
            lastPhotoPointerDown: null, previewPhotoSourcePointFn: null,
            frontmostPreviewHitFn: frontmostPreviewHit,
            motionDraw: null
        });
        vm.runInContext(openHandlerSource.slice(hitStart, hitEnd)
            + openHandlerSource.slice(downStart, downEnd), context);
        const overlayReceivesPointer = hidden.time >= overlay.start
            && hidden.time < overlay.start + overlay.duration && overlay.style.visibility !== 'hidden';
        const event = { target: overlayReceivesPointer ? overlay : stage, button: 0, clientX: 50, clientY: 50,
            stopPropagation() {}, preventDefault() {} };
        assert.equal(vm.runInContext('findVisualMediaHitAt', context)(event), cut);
        vm.runInContext('handleVisualMediaPointerDown', context)(event);
        assert.deepEqual(selected, ['caption-cleared', 'cut-base']);
    }
});

test('media planes use the same item z scale as DOM overlays with a grouped caption', () => {
    const tracks = [{ id: 'base', items: [{ id: 'cut-a', source: { kind: 'media' } }] },
        { id: 'shape-track', items: [{ id: 'shape', source: { kind: 'html' } },
            { id: 'group', source: { kind: 'group' }, items: [{ id: 'caption', source: { kind: 'caption' } }] }] },
        { id: 'photo-track', items: [{ id: 'photo', source: { kind: 'media' } }] }];
    const order = resolvePreviewItemStackOrder(tracks);
    const summary = { timelineTracks: tracks, ...order, captionTrackId: 'shape-track',
        overlays: [{ id: 'shape', trackId: 'shape-track' }],
        cuts: [{ id: 'cut-a', trackId: 'base', renderTrack: 0 }],
        layers: [{ id: 'photo', trackId: 'photo-track', renderTrack: 2 }] };
    const bands = partitionPreviewMediaPlanes({ base: [{ id: 'cut-0', visual: {} }],
        layers: [{ id: 'photo', visual: {} }] }, summary);
    const photoBand = bands.find(band => band.entries.some(entry => entry.spec.id === 'photo'));
    assert.equal(photoBand.zIndex, order.itemStackZ.photo);
    assert.ok(order.itemStackZ.shape < photoBand.zIndex);
    assert.ok(order.itemStackZ.caption < photoBand.zIndex);
});

test('plain tracks and simultaneous base cuts preserve their track order', () => {
    const summary = { timelineTracks: [{ id: 'base' }, { id: 'shape' }, { id: 'photo' }],
        overlays: [{ id: 'shape', trackId: 'shape' }], captionTrackId: undefined,
        cuts: [{ id: 'a', trackId: 'base', renderTrack: 0 },
            { id: 'b', trackId: 'base', renderTrack: 0 }],
        layers: [{ id: 'photo', trackId: 'photo', renderTrack: 2 }] };
    const bands = partitionPreviewMediaPlanes({ base: [{ id: 'cut-0', visual: {} },
        { id: 'cut-1', visual: {} }], layers: [{ id: 'photo', visual: {} }] }, summary);
    assert.deepEqual(bands[0].baseIndices, [0, 1]);
    assert.equal(bands.find(band => band.entries.some(entry => entry.spec.id === 'photo')).zIndex, 2);
});

test('simultaneous cuts on opposite sides of a shape occupy separate media planes', () => {
    const summary = { timelineTracks: [{ id: 'back' }, { id: 'shape' }, { id: 'front' }],
        overlays: [{ id: 'shape', trackId: 'shape' }],
        cuts: [{ id: 'back-cut', trackId: 'back', renderTrack: 0 },
            { id: 'front-cut', trackId: 'front', renderTrack: 2 }], layers: [] };
    const bands = partitionPreviewMediaPlanes({ base: [{ id: 'cut-0', visual: {} },
        { id: 'cut-1', visual: {} }], layers: [] }, summary);
    assert.deepEqual(bands[0].baseIndices, [0]);
    assert.deepEqual(bands[1].baseIndices, []);
    assert.equal(bands[1].entries[0].baseIndex, 1);
    assert.ok(bands[0].zIndex < 1 && bands[1].zIndex > 1);
});

test('one click resolves the visible top media above an old caption or lower shape', () => {
    const hits = [{ element: 'shape', z: 4, order: 0 },
        { element: 'photo', z: 7, order: 1 }];
    assert.equal(frontmostPreviewHit(hits), 'photo');
    assert.equal(frontmostPreviewHit(hits.filter(hit => hit.element !== 'photo')), 'shape');
    const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
    assert.match(source, /const captionRow = target\?\.closest\?\.\('\.caption-row-plate'\)/);
    assert.match(source, /Number\(mediaHit\.style\.zIndex\) <= domZ/);
});

test('interaction runtime publishes an out-of-range overlay release to the host', () => {
    const source = readFileSync(new URL('../../../../../packages/overlay-runtime/src/interaction.js', import.meta.url), 'utf8');
    const unavailable = source.slice(source.indexOf('function handleSelectedOverlayUnavailable('),
        source.indexOf('function selectOverlay(', source.indexOf('function handleSelectedOverlayUnavailable(')));
    assert.match(unavailable, /clearSelection\(\);\s*publishScopedSelection\(\);/);
});

test('seek tick releases stale selection before announcing its new playhead', () => {
    const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
    const tick = source.slice(source.indexOf('window.akari.playbackTick ='),
        source.indexOf('window.akari.persistPlaybackRate ='));
    assert.ok(tick.indexOf('expirePreviewSelections?.(time)') < tick.indexOf("type: 'akari-preview-playback-tick'"));
});
