import assert from 'node:assert/strict';
import test from 'node:test';
import { methodBody, readHandlerCompiled, readHandlerSource } from './helpers/handler-source.mjs';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cutLayerStyleBoxPx } from '../lib/common/cut-layer-style-entry.js';
import { toV2Edit } from './helpers/v2-fixture.mjs';
import { createPreviewAudioHost } from './helpers/preview-audio-host.mjs';

const handlerSource = readHandlerSource();
const here = dirname(fileURLToPath(import.meta.url));
const adapterSource = readFileSync(join(here, '../src/browser/preview-script-host-adapter.ts'), 'utf8');
const engineSource = readFileSync(join(here, '../src/browser/preview-script-frame-engine-bootstrap.ts'), 'utf8');
const bootstrapSource = readFileSync(join(here, '../src/browser/preview-script-bootstrap.ts'), 'utf8');

const simpleEdit = () => toV2Edit({ version: 1, output: { width: 1920, height: 1080, fps: 30 },
    sources: [{ id: 'video', path: 'video.mp4', proxy: 'video-proxy.mp4' },
        { id: 'still', path: 'still.jpg' }],
    cuts: [{ id: 'cut-video', src: 'video', in: 0, out: 2 },
        { id: 'cut-still', src: 'still', in: 0, out: 2 }],
    layers: [{ id: 'layer-video', t: 0, duration: 2, kind: 'video', src: 'video.mp4',
        crop: { x: 0.25, y: 0, w: 0.5, h: 1 } }],
    overlays: [], audio: {} });

function layoutMedia(media, output = { width: 1920, height: 1080 }, cut = false, frameEngineEnabled = true) {
    const natural = adapterSource.match(/const mediaNaturalSize = media => \{[\s\S]*?\n            \};/u)?.[0];
    const layout = adapterSource.match(/const applyLayerStyleMediaLayout = \(media, outputWidth, outputHeight, cut = false\) => \{[\s\S]*?\n            \};/u)?.[0];
    assert.ok(natural);
    assert.ok(layout);
    const cutLayout = adapterSource.match(/const applyCutLayerStyleLayout = media => \{[\s\S]*?\n            \};/u)?.[0];
    assert.ok(cutLayout);
    const apply = new Function('output', 'photoFrameVisualFn', 'preparePhotoMask',
        'computeLayerPerspectiveVisualFn', 'perspectiveVisualWarned', 'resolveLayerHitRegionClipFn',
        'photoCropClipPolygonFn', 'initial', 'window', 'cut',
        `${natural}\n${layout}\n${cutLayout}\nreturn cut ? applyCutLayerStyleLayout : applyLayerStyleMediaLayout;`)(
        output, () => null, () => {}, () => null, false, () => '', () => '',
        { frameEngineEnabled }, { akari: {} }, cut);
    assert.equal(cut ? apply(media) : apply(media, output.width, output.height), true);
    return media.style;
}

test('layer box uses declared 1280x720 with 960x540 decoded media', () => {
    const media = { tagName: 'VIDEO', videoWidth: 960, videoHeight: 540, style: {},
        dataset: { akariSourceWidth: '1280', akariSourceHeight: '720', akariTransformScale: '1.5',
            akariCropX: '0.25', akariCropW: '0.5', akariCropH: '1' } };
    const style = layoutMedia(media);
    assert.deepEqual([style.width, style.height], ['1920px', '1080px']);
});

test('crop cut uses declared 1920x1080 with 960x540 decoded media', () => {
    const media = { tagName: 'VIDEO', videoWidth: 960, videoHeight: 540, style: {},
        dataset: { akariSourceWidth: '1920', akariSourceHeight: '1080', akariTransformScale: '1',
            akariCropX: '0.14', akariCropW: '0.5', akariCropH: '1',
            akariCutLayerStyleActive: 'true', akariCutCropDeclared: 'true' } };
    const style = layoutMedia(media, undefined, true);
    assert.deepEqual([style.width, style.height], ['1920px', '1080px']);
    assert.deepEqual(cutLayerStyleBoxPx({ width: 1920, height: 1080 },
        { x: 0.14, y: 0, w: 0.5, h: 1 }, 1), { width: 960, height: 1080 });
    assert.match(engineSource, /source\.logicalSize = declaredSizeForSource\(id\)/u);
});

test('unproxied media preserves the existing size and layout', () => {
    const media = { tagName: 'VIDEO', videoWidth: 1920, videoHeight: 1080, style: {},
        dataset: { akariSourceWidth: '1920', akariSourceHeight: '1080', akariTransformScale: '1' } };
    assert.deepEqual([layoutMedia(media).width, media.style.height], ['1920px', '1080px']);
});

test('layout falls back to media dimensions then output dimensions', () => {
    const media = { tagName: 'VIDEO', videoWidth: 960, videoHeight: 540, style: {}, dataset: {} };
    assert.deepEqual([layoutMedia(media).width, media.style.height], ['960px', '540px']);
    media.videoWidth = 0;
    media.videoHeight = 0;
    assert.deepEqual([layoutMedia(media).width, media.style.height], ['1920px', '1080px']);
});

test('legacy layout keeps media dimensions and leaves unloaded media unplaced', () => {
    const media = { tagName: 'VIDEO', videoWidth: 960, videoHeight: 540, style: {}, dataset: {} };
    assert.deepEqual([layoutMedia(media, undefined, false, false).width, media.style.height],
        ['960px', '540px']);
    media.videoWidth = 0;
    media.videoHeight = 0;
    const natural = adapterSource.match(/const mediaNaturalSize = media => \{[\s\S]*?\n            \};/u)?.[0];
    assert.ok(natural);
    const size = new Function('initial', 'output', `${natural}\nreturn mediaNaturalSize;`)(
        { frameEngineEnabled: false }, { width: 1920, height: 1080 });
    assert.deepEqual(size(media), { width: 0, height: 0 });
});

test('loadPreviewModel skips all dimension probes and declarations on the legacy face', async () => {
    const fixture = createPreviewAudioHost();
    fixture.host.fileService = { exists: async () => true };
    fixture.host.resolveStreamVideoUri = async uri => uri;
    const probes = [];
    fixture.host.previewService.probeVideoDimensions = async request => {
        probes.push(request.videoUri);
        return { width: 1920, height: 1080 };
    };
    const model = await fixture.load(simpleEdit(), { frameEngineEnabled: false });
    await model.pendingLayerDimensions;
    assert.deepEqual(probes, []);
    assert.ok(model.summary.cuts.length > 0 && model.summary.layers.length > 0);
    for (const item of [...model.summary.cuts, ...model.summary.layers]) {
        assert.equal(Object.hasOwn(item, 'sourceWidth'), false, item.id);
    }
});

test('legacy reload after an engine attempt does not reuse declared dimensions', async () => {
    const fixture = createPreviewAudioHost();
    fixture.host.fileService = { exists: async () => true };
    fixture.host.resolveStreamVideoUri = async uri => uri;
    let probes = 0;
    fixture.host.previewService.probeVideoDimensions = async () => {
        probes += 1;
        return { width: 1920, height: 1080 };
    };
    const engine = await fixture.load(simpleEdit());
    await engine.pendingLayerDimensions;
    assert.ok(probes > 0);
    const before = probes;
    const legacy = await fixture.load(simpleEdit(), { frameEngineEnabled: false });
    assert.equal(probes, before);
    assert.equal(legacy.pendingLayerDimensions, undefined);
    assert.ok(legacy.summary.cuts.length > 0 && legacy.summary.layers.length > 0);
    for (const item of [...legacy.summary.cuts, ...legacy.summary.layers]) {
        assert.equal(Object.hasOwn(item, 'sourceWidth'), false, item.id);
    }
});

test('fallback dimensions are cached under the original URI for the next model load', async () => {
    const fixture = createPreviewAudioHost();
    fixture.host.fileService = { exists: async () => true };
    fixture.host.resolveStreamVideoUri = async uri => uri.path.base === 'video.mp4'
        ? uri.parent.resolve('video-proxy.mp4') : uri;
    const probes = [];
    const notes = [];
    fixture.host.previewDiagnostics = { note: message => notes.push(message) };
    fixture.host.previewService.probeVideoDimensions = async ({ videoUri }) => {
        probes.push(videoUri);
        if (videoUri.endsWith('/video.mp4')) throw new Error('original unavailable');
        return { width: 960, height: 540 };
    };
    const first = await fixture.load(simpleEdit());
    assert.equal(first.summary.cuts[0].sourceWidth, undefined);
    const resolved = await first.pendingLayerDimensions;
    const firstCutSize = resolved.get(`cut:${first.summary.cuts[0].id}`);
    assert.ok(firstCutSize, JSON.stringify({ cuts: first.summary.cuts.map(cut => [cut.id, cut.src]),
        dimensions: [...resolved], probes }));
    assert.deepEqual([firstCutSize.width, firstCutSize.height, firstCutSize.sourceSizeFallback],
        [960, 540, true]);
    const before = probes.length;
    const second = await fixture.load(simpleEdit());
    assert.equal(second.summary.cuts[0].sourceWidth, 960);
    assert.equal(second.summary.cuts[0].sourceSizeFallback, true);
    assert.equal(second.summary.layers[0].sourceSizeFallback, true);
    assert.equal(probes.length, before);
    assert.equal(probes.some(uri => uri.endsWith('/still.jpg')), false);
    assert.equal(notes.filter(note => note.includes('video.mp4')).length, 1);
    fixture.host.layerDimensionCache.get('file:///project/video.mp4').expiresAt = Date.now() - 1;
    const retried = await fixture.load(simpleEdit());
    await retried.pendingLayerDimensions;
    assert.equal(probes.filter(uri => uri.endsWith('/video.mp4')).length, 2);
    assert.equal(notes.filter(note => note.includes('video.mp4')).length, 1);
});

test('cut natural size uses declarations on engine and decoded media pixels on legacy', () => {
    const expression = bootstrapSource.match(/const cutNaturalSizeNow = \(\) => \{[\s\S]*?\n            \};/u)?.[0];
    assert.ok(expression);
    const createSize = new Function('summary', 'cutInteractionSegment', 'mediaNaturalSizeOf',
        'cutMediaNow', 'ensureCutSourceNaturalSize', `${expression}\nreturn cutNaturalSizeNow;`)(
        { cuts: [{ id: 'cut-id', sourceWidth: 1920, sourceHeight: 1080 }] },
        () => ({ id: 'cut-id' }), () => ({ width: 960, height: 540 }), () => null,
        () => ({ width: 1920, height: 1080 }));
    assert.deepEqual(createSize(), { width: 1920, height: 1080 });
    const legacySize = new Function('summary', 'cutInteractionSegment', 'mediaNaturalSizeOf',
        'cutMediaNow', 'ensureCutSourceNaturalSize', `${expression}\nreturn cutNaturalSizeNow;`)(
        { cuts: [{ id: 'cut-id' }] }, () => ({ id: 'cut-id' }),
        () => ({ width: 960, height: 540 }), () => null,
        () => ({ width: 1920, height: 1080 }));
    assert.deepEqual(legacySize(), { width: 960, height: 540 });
});

test('engine declaration lookup matches cut source id and layer stream URL', () => {
    const expression = engineSource.match(/const declaredSizeForSource = id => \{[\s\S]*?\n                \};/u)?.[0];
    assert.ok(expression);
    const lookup = new Function('engineSummary', 'sourceUrls', `${expression}\nreturn declaredSizeForSource;`)(
        { cuts: [{ src: 'cut-source', sourceWidth: 1920, sourceHeight: 1080 }],
            layers: [{ src: 'stream://layer', sourceWidth: 1280, sourceHeight: 720 }] },
        new Map([['layer-source', 'stream://layer']]));
    assert.deepEqual(lookup('cut-source'), { width: 1920, height: 1080 });
    assert.deepEqual(lookup('layer-source'), { width: 1280, height: 720 });
});

test('cut source probe skips declared engine size and keeps unknown, fallback, and legacy probes', () => {
    const expression = bootstrapSource.match(/const ensureCutSourceNaturalSize = \(\) => \{[\s\S]*?\n            \};/u)?.[0];
    assert.ok(expression);
    const segment = { kind: 'src', src: 'source-id', id: 'cut-id' };
    const initial = { imageSources: {}, videoSourceOriginals: { 'source-id': 'stream://original' },
        videoSources: { 'source-id': 'stream://proxy' } };
    const run = (frameEngineMediaIdle, cuts) => {
        const created = [];
        const urls = [];
        const sizes = new Map();
        const document = { createElement: tag => {
            created.push(tag);
            return { addEventListener() {}, set src(value) { urls.push(value); } };
        } };
        const probe = new Function('cutInteractionSegment', 'cutSourceNaturalSizes', 'initial',
            'document', 'frameEngineMediaIdle', 'summary',
            `${expression}\nreturn ensureCutSourceNaturalSize;`)(
            () => segment, sizes, initial, document, frameEngineMediaIdle, { cuts });
        assert.equal(probe(), null);
        return { created, urls, sizes };
    };
    const declared = { id: 'cut-id', sourceWidth: 1920, sourceHeight: 1080 };
    const skipped = run(true, [declared]);
    assert.deepEqual(skipped.created, []);
    assert.deepEqual(skipped.urls, []);
    assert.equal(skipped.sizes.size, 0);
    assert.deepEqual(run(true, [{ ...declared, id: 'other-cut' }]).urls, ['stream://original']);
    assert.deepEqual(run(true, [{ ...declared, sourceSizeFallback: true }]).urls, ['stream://original']);
    for (const cuts of [[], [declared]]) {
        assert.deepEqual(run(false, cuts).urls, ['stream://proxy']);
    }
});

test('crop size gate uses original on engine and passes legacy and source geometry', () => {
    const ensure = bootstrapSource.match(/const ensureCutSourceNaturalSize = \(\) => \{[\s\S]*?\n            \};/u)?.[0];
    const ready = bootstrapSource.match(/const cutCropEntrySizeReady = \(\) => \{[\s\S]*?\n            \};/u)?.[0];
    assert.ok(ensure);
    assert.ok(ready);
    const probedUrls = [];
    const document = { createElement: () => ({ addEventListener() {},
        set src(value) { probedUrls.push(value); } }) };
    const segment = { kind: 'src', src: 'source-id', id: 'cut-id' };
    const initial = { imageSources: {}, videoSourceOriginals: { 'source-id': 'stream://original' },
        videoSources: { 'source-id': 'stream://proxy' } };
    const createProbe = frameEngineMediaIdle => new Function('cutInteractionSegment',
        'cutSourceNaturalSizes', 'initial', 'document', 'frameEngineMediaIdle', 'summary',
        `${ensure}\nreturn ensureCutSourceNaturalSize;`)(
        () => segment, new Map(), initial, document, frameEngineMediaIdle, { cuts: [] });
    const probe = createProbe(true);
    assert.equal(probe(), null);
    assert.equal(probedUrls.at(-1), 'stream://original');
    assert.equal(createProbe(false)(), null);
    assert.equal(probedUrls.at(-1), 'stream://proxy');
    const summary = { cuts: [{ id: 'cut-id', sourceWidth: 960, sourceHeight: 540,
        sourceSizeFallback: true }] };
    const selection = { dataset: { akariCutCropDeclared: '' } };
    const createReady = (frameEngineMediaIdle, outputGeometryIsSource) =>
        new Function('cutSelectionVideo', 'cutInteractionSegment', 'summary',
            'ensureCutSourceNaturalSize', 'frameEngineMediaIdle', 'outputGeometryIsSource',
            `${ready}\nreturn cutCropEntrySizeReady;`)(
            () => selection, () => segment, summary, probe, frameEngineMediaIdle, outputGeometryIsSource);
    const isReady = createReady(true, false);
    assert.equal(isReady(), false);
    assert.equal(createReady(false, false)(), true);
    assert.equal(createReady(true, true)(), true);
    const dragPrefix = bootstrapSource.slice(
        bootstrapSource.indexOf('const beginMediaCropDrag = (target, dir, event) => {'),
        bootstrapSource.indexOf('const restorePoint = target.cropRestorePoint();',
            bootstrapSource.indexOf('const beginMediaCropDrag = (target, dir, event) => {')));
    assert.ok(dragPrefix.includes('cutCropEntrySizeReady()'));
    let errors = 0;
    let baked = 0;
    const begin = new Function('selectionDragActive', 'cutCropEntrySizeReady',
        'reportUnknownCutCropSize', `${dragPrefix}\n}; return beginMediaCropDrag;`)(
        false, isReady, () => { errors += 1; });
    begin({ kind: 'cut', naturalSize: () => { baked += 1; return { width: 960, height: 540 }; } },
        'e', {});
    assert.equal(errors, 1);
    assert.equal(baked, 0);
    const beginLegacy = new Function('selectionDragActive', 'cutCropEntrySizeReady',
        'reportUnknownCutCropSize', `${dragPrefix}\n}; return beginMediaCropDrag;`)(
        false, createReady(false, false), () => { errors += 1; });
    beginLegacy({ kind: 'cut', naturalSize: () => { baked += 1; return { width: 0, height: 0 }; } },
        'e', {});
    assert.equal(errors, 1);
    assert.equal(baked, 1);
    summary.cuts[0].sourceSizeFallback = false;
    summary.cuts[0].sourceWidth = 0;
    summary.cuts[0].sourceHeight = 0;
    assert.equal(isReady(), false);
    summary.cuts[0].sourceSizeFallback = false;
    summary.cuts[0].sourceWidth = 1920;
    summary.cuts[0].sourceHeight = 1080;
    assert.equal(isReady(), true);
    selection.dataset.akariCutCropDeclared = 'true';
    summary.cuts[0].sourceSizeFallback = true;
    assert.equal(isReady(), true);
});

test('loadedmetadata asks the adapter to lay out only its layer', () => {
    const positionAndListener = handlerSource.match(/const position = \(\) => \{[\s\S]*?\n                \};\s*layerVideo\.addEventListener\('loadedmetadata', \(\) => \{[\s\S]*?\n                \}\);/u)?.[0];
    assert.ok(positionAndListener);
    const assignment = adapterSource.match(/window\.akari\.updateLayerLayout = media => \{[\s\S]*?\n            \};/u)?.[0];
    assert.ok(assignment);
    const calls = [];
    const window = { akari: {} };
    new Function('window', 'applyLayerStyleMediaLayout', 'updateStageScale', 'output', assignment)(
        window, media => calls.push(media.dataset.akariLayerId), () => calls.push('all'),
        { width: 1920, height: 1080 });
    const videos = ['first', 'selected', 'last'].map(id => {
        const listeners = new Map();
        const video = { videoWidth: 960, videoHeight: 540, dataset: { akariLayerId: id },
            addEventListener: (type, listener) => listeners.set(type, listener) };
        new Function('layerVideo', 'window', 'tick', positionAndListener)(video, window, () => {});
        return { video, listeners };
    });
    videos[1].listeners.get('loadedmetadata')();
    assert.deepEqual(calls, ['selected']);
    window.akari.updateLayerLayout();
    assert.deepEqual(calls, ['selected', 'all']);
});

test('host probes the original once for cuts and layers without probing a proxy', async () => {
    const body = methodBody('loadPreviewModel', { source: readHandlerCompiled() });
    const expression = body.match(/const probeDimensions = [\s\S]*?\n            const isTruthyObject =/u)?.[0]
        .replace(/\n            const isTruthyObject =$/u, '');
    assert.ok(expression);
    const probed = [];
    const service = { probeVideoDimensions: async ({ videoUri }) => {
        probed.push(videoUri); return { width: 1280, height: 720 };
    } };
    const pending = new Map();
    const host = { previewService: service, layerDimensionCache: new Map(), layerDimensionProbes: new Map(),
        layerDimensionNotedUris: new Set(), layerDimensionFailureReasons: new Map(),
        previewDiagnostics: { note() {} } };
    const dimensions = new Function('pendingLayerDimensions', 'dimensionUrisByItem',
        `${expression}\nreturn itemDimensions;`).call(host, pending, new Map());
    const uri = { toString: () => 'file:///original.mp4' };
    const proxy = { toString: () => 'file:///proxy.mp4' };
    assert.deepEqual([dimensions(uri, 'cut:one', proxy), dimensions(uri, 'layer:two', proxy)],
        [undefined, undefined]);
    assert.deepEqual(await pending.get(uri.toString()), { width: 1280, height: 720 });
    assert.deepEqual(probed, [uri.toString()]);
});

test('synchronous probe failures keep dimensions optional and record diagnostics', async () => {
    const body = methodBody('loadPreviewModel', { source: readHandlerCompiled() });
    const expression = body.match(/const probeDimensions = [\s\S]*?\n            const isTruthyObject =/u)?.[0]
        .replace(/\n            const isTruthyObject =$/u, '');
    assert.ok(expression);
    const pending = new Map();
    const notes = [];
    const host = { previewService: { probeVideoDimensions: () => { throw new Error('probe failed'); } },
        layerDimensionCache: new Map(), layerDimensionProbes: new Map(),
        layerDimensionNotedUris: new Set(),
        layerDimensionFailureReasons: new Map(),
        previewDiagnostics: { note: message => notes.push(message) } };
    const dimensions = new Function('pendingLayerDimensions', 'dimensionUrisByItem',
        `${expression}\nreturn itemDimensions;`).call(host, pending, new Map());
    const original = { toString: () => 'file:///original.mp4' };
    const proxy = { toString: () => 'file:///proxy.mp4' };
    assert.equal(dimensions(original, 'cut:one', proxy), undefined);
    assert.equal(await pending.get(original.toString()), undefined);
    assert.match(notes.join('\n'), /原本とプロキシの寸法を取得できません/u);
    assert.match(notes.join('\n'), /probe failed/u);
    assert.equal(notes.length, 1);
});

test('fallback bookkeeping errors resolve pending dimensions without rejecting', async () => {
    const body = methodBody('loadPreviewModel', { source: readHandlerCompiled() });
    const expression = body.match(/const probeDimensions = [\s\S]*?\n            const isTruthyObject =/u)?.[0]
        .replace(/\n            const isTruthyObject =$/u, '');
    assert.ok(expression);
    const pending = new Map();
    const host = { previewService: { probeVideoDimensions: async () => undefined },
        layerDimensionCache: new Map(), layerDimensionProbes: new Map(),
        layerDimensionNotedUris: new Set(), layerDimensionFailureReasons: new Map(),
        previewDiagnostics: { note: () => { throw new Error('diagnostic unavailable'); } } };
    const dimensions = new Function('pendingLayerDimensions', 'dimensionUrisByItem',
        `${expression}\nreturn itemDimensions;`).call(host, pending, new Map());
    const original = { toString: () => 'file:///original.mp4' };
    assert.equal(dimensions(original, 'cut:one'), undefined);
    assert.equal(await pending.get(original.toString()), undefined);
});

test('unresolved dimensions leave the summary available and send one update after page readiness', async () => {
    const body = methodBody('sendPendingLayerDimensions', { source: readHandlerCompiled() });
    const sendPendingLayerDimensions = new Function(`return ({ ${body} }).sendPendingLayerDimensions;`)();
    let resolveProbe;
    const pendingLayerDimensions = new Promise(resolve => { resolveProbe = resolve; });
    const summary = { layers: [{ id: 'one', src: 'stream' }], cuts: [{ id: 'cut-one' }] };
    const snapshot = { summary: { layers: [{ id: 'one', src: 'stable-asset' }], cuts: [{ id: 'cut-one' }] } };
    const listeners = [];
    const sent = [];
    const widget = { isDisposed: false, akariPreviewPlaybackPageId: 'page-1',
        akariPreviewSummary: summary, akariPreviewModelSnapshot: snapshot,
        onMessage: listener => {
            let active = true;
            listeners.push(message => { if (active) listener(message); });
            return { dispose() { active = false; } };
        },
        disposed: { connect() {} }, sendMessage: message => sent.push(message) };
    const host = { previewMessageReadyPages: new WeakMap() };
    sendPendingLayerDimensions.call(host, widget, { pendingLayerDimensions }, summary);
    assert.equal(summary.layers[0].sourceWidth, undefined);
    assert.deepEqual(sent, []);
    resolveProbe(new Map([['layer:one', { width: 540, height: 960, sourceSizeFallback: true }],
        ['cut:cut-one', { width: 1920, height: 1080, sourceSizeFallback: true }]]));
    await pendingLayerDimensions;
    await Promise.resolve();
    assert.deepEqual(sent, []);
    listeners[0]({ type: 'akari-preview-primary-selection-ready', pageId: 'page-1' });
    listeners[0]({ type: 'akari-preview-primary-selection-ready', pageId: 'page-1' });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, 'akari-preview-model-update');
    assert.deepEqual([widget.akariPreviewSummary.layers[0].sourceWidth,
        widget.akariPreviewModelSnapshot.summary.layers[0].sourceHeight], [540, 960]);
    assert.deepEqual([widget.akariPreviewSummary.cuts[0].sourceWidth,
        widget.akariPreviewModelSnapshot.summary.cuts[0].sourceHeight], [1920, 1080]);
    assert.equal(widget.akariPreviewSummary.layers[0].sourceSizeFallback, true);
    assert.equal(widget.akariPreviewModelSnapshot.summary.cuts[0].sourceSizeFallback, true);
    assert.equal(summary.layers[0].sourceWidth, undefined);
});

test('layer dimensions use the original URI and keep stream URI only for fallback', () => {
    const calls = [...handlerSource.matchAll(/layerDimensions\(sourceUri, item\.id, (?:colorUri|sidecarUri|streamUri)\)/gu)];
    assert.equal(calls.length, 4);
});
