import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePreviewItemStackOrder } from '../lib/common/caption-track-order.js';
import { partitionPreviewMediaPlanes } from '../lib/common/preview-media-planes.js';
import { frontmostPreviewHit } from '../lib/common/preview-photo-hit.js';
import { harness } from './caption-animator-webview-harness.mjs';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('seeking away releases every selected visual kind for host notification', () => {
    const view = harness({ cues: [{ id: 'caption-a', start: 0, end: 3, text: 'A' }] });
    const notified = [];
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
    view.tick(6);
    assert.equal(view.context.selectedCaptionId, null);
    assert.equal(view.context.selectedLayerId, null);
    assert.equal(view.context.requestedCutId, undefined);
    assert.equal(view.run('requestedOverlayId'), undefined);
    assert.deepEqual(notified, [['caption', null], ['layer', null], ['cut', null], ['overlay', null]]);
});

test('a caption explicitly selected while invisible survives until it becomes visible and leaves again', () => {
    const view = harness({ cues: [{ id: 'caption-a', start: 0, end: 3, text: 'A' }] });
    const notified = [];
    view.context.stage = { querySelector: () => null, querySelectorAll: () => [] };
    view.context.window.akari.reportCaptionSelection = id => notified.push(id);
    view.context.outputTime = 6;
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

test('an echo of the same selection cannot erase a recorded visible hit', () => {
    const view = harness();
    view.context.window.akari.notePreviewSelection('layer', 'photo-a', true);
    view.context.window.akari.notePreviewSelection('layer', 'photo-a', false);
    assert.equal(view.context.window.akari.previewSelectionWasVisible('layer', 'photo-a'), true);
});

test('invisible layer, cut and overlay requests survive until each crosses out of visibility', () => {
    const view = harness();
    const notified = [];
    view.context.stage = { querySelector: () => null, querySelectorAll: () => [] };
    view.context.window.akari.reportLayerSelection = id => notified.push(['layer', id]);
    view.context.window.akari.reportCutSelection = id => notified.push(['cut', id]);
    view.context.window.akari.reportOverlaySelection = id => notified.push(['overlay', id]);
    view.context.window.akari.interaction.clearSelection = () => {};
    view.context.summary.layers = [{ id: 'photo-a', t: 0, duration: 3 }];
    view.context.summary.overlays = [{ id: 'shape-a', start: 0, duration: 3 }];
    view.context.findLayerEntry = () => ({ spec: view.context.summary.layers[0] });
    view.context.cutInteractionSegment = () => ({ id: 'cut-a', outStart: 0, outEnd: 3 });
    view.context.selectedLayerId = 'photo-a';
    view.context.requestedCutId = 'cut-a';
    view.context.cutSelected = true;
    view.run("requestedOverlayId = 'shape-a';");
    for (const [kind, id] of [['layer', 'photo-a'], ['cut', 'cut-a'], ['overlay', 'shape-a']]) {
        view.context.window.akari.notePreviewSelection(kind, id, false);
    }
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
        window: { akari: { interaction: { hasSelectionTree: true, selectedId: null, selectedIds: [] },
            previewSelectionWasVisible: () => false,
            reportOverlaySelection: id => notified.push(id) } }
    });
    vm.runInContext(source.slice(start, end), context);
    vm.runInContext('reportOverlaySelectionChange(true, false);', context);
    assert.equal(vm.runInContext('requestedOverlayId', context), 'shape-a');
    assert.deepEqual(notified, []);
    context.window.akari.previewSelectionWasVisible = () => true;
    vm.runInContext('reportOverlaySelectionChange(true);', context);
    assert.equal(vm.runInContext('requestedOverlayId', context), undefined);
    assert.deepEqual(notified, [null]);
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
