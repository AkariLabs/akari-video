import assert from 'node:assert/strict';
import test from 'node:test';
import { methodBody, readHandlerCompiled, readHandlerSource } from './helpers/handler-source.mjs';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cutLayerStyleBoxPx } from '../lib/common/cut-layer-style-entry.js';

const handlerSource = readHandlerSource();
const here = dirname(fileURLToPath(import.meta.url));
const adapterSource = readFileSync(join(here, '../src/browser/preview-script-host-adapter.ts'), 'utf8');
const engineSource = readFileSync(join(here, '../src/browser/preview-script-frame-engine-bootstrap.ts'), 'utf8');

function layoutMedia(media, output = { width: 1920, height: 1080 }) {
    const natural = adapterSource.match(/const mediaNaturalSize = media => \{[\s\S]*?\n            \};/u)?.[0];
    const layout = adapterSource.match(/const applyLayerStyleMediaLayout = \(media, outputWidth, outputHeight, cut = false\) => \{[\s\S]*?\n            \};/u)?.[0];
    assert.ok(natural);
    assert.ok(layout);
    const apply = new Function('output', 'photoFrameVisualFn', 'preparePhotoMask',
        'computeLayerPerspectiveVisualFn', 'perspectiveVisualWarned', 'resolveLayerHitRegionClipFn',
        'photoCropClipPolygonFn', `${natural}\n${layout}\nreturn applyLayerStyleMediaLayout;`)(
        output, () => null, () => {}, () => null, false, () => '', () => '');
    assert.equal(apply(media, output.width, output.height), true);
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
            akariCropX: '0.14', akariCropW: '0.5', akariCropH: '1' } };
    const style = layoutMedia(media);
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
        previewDiagnostics: { note: message => notes.push(message) } };
    const dimensions = new Function('pendingLayerDimensions', 'dimensionUrisByItem',
        `${expression}\nreturn itemDimensions;`).call(host, pending, new Map());
    const original = { toString: () => 'file:///original.mp4' };
    const proxy = { toString: () => 'file:///proxy.mp4' };
    assert.equal(dimensions(original, 'cut:one', proxy), undefined);
    assert.equal(await pending.get(original.toString()), undefined);
    assert.match(notes.join('\n'), /原本の寸法を取得できません/u);
    assert.match(notes.join('\n'), /原本とプロキシの寸法を取得できません/u);
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
    resolveProbe(new Map([['layer:one', { width: 540, height: 960 }],
        ['cut:cut-one', { width: 1920, height: 1080 }]]));
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
    assert.equal(summary.layers[0].sourceWidth, undefined);
});

test('layer dimensions use the original URI and keep stream URI only for fallback', () => {
    const calls = [...handlerSource.matchAll(/layerDimensions\(sourceUri, item\.id, (?:colorUri|sidecarUri|streamUri)\)/gu)];
    assert.equal(calls.length, 4);
});
