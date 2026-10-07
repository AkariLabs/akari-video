import assert from 'node:assert/strict';
import test from 'node:test';
import { methodBody, readHandlerCompiled, readHandlerSource } from './helpers/handler-source.mjs';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const handlerSource = readHandlerSource();
const here = dirname(fileURLToPath(import.meta.url));
const adapterSource = readFileSync(join(here, '../src/browser/preview-script-host-adapter.ts'), 'utf8');

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

test('host shares one dimension probe Promise for repeated stream URI', async () => {
    const raw = handlerSource.match(/const layerDimensions = \(uri: URI, layerId: string\) => \{[\s\S]*?\n            \};/u)?.[0];
    assert.ok(raw);
    const expression = raw.replace('(uri: URI, layerId: string)', '(uri, layerId)');
    let probes = 0;
    const service = { probeVideoDimensions: async () => { probes++; return { width: 960, height: 540 }; } };
    const pending = new Map();
    const host = { previewService: service, layerDimensionCache: new Map(), layerDimensionProbes: new Map() };
    const dimensions = new Function('pendingLayerDimensions', 'layerDimensionUrisById',
        `${expression}\nreturn layerDimensions;`).call(host, pending, new Map());
    const uri = { toString: () => 'file:///same-video.mp4' };
    assert.deepEqual([dimensions(uri, 'one'), dimensions(uri, 'two'), dimensions(uri, 'three')],
        [undefined, undefined, undefined]);
    assert.deepEqual(await pending.get(uri.toString()), { width: 960, height: 540 });
    assert.deepEqual(dimensions(uri, 'four'), { width: 960, height: 540 });
    assert.equal(probes, 1);
});

test('unresolved dimensions leave the summary available and send one update after page readiness', async () => {
    const body = methodBody('sendPendingLayerDimensions', { source: readHandlerCompiled() });
    const sendPendingLayerDimensions = new Function(`return ({ ${body} }).sendPendingLayerDimensions;`)();
    let resolveProbe;
    const pendingLayerDimensions = new Promise(resolve => { resolveProbe = resolve; });
    const summary = { layers: [{ id: 'one', src: 'stream' }] };
    const snapshot = { summary: { layers: [{ id: 'one', src: 'stable-asset' }] } };
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
    resolveProbe(new Map([['one', { width: 540, height: 960 }]]));
    await pendingLayerDimensions;
    await Promise.resolve();
    assert.deepEqual(sent, []);
    listeners[0]({ type: 'akari-preview-primary-selection-ready', pageId: 'page-1' });
    listeners[0]({ type: 'akari-preview-primary-selection-ready', pageId: 'page-1' });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, 'akari-preview-model-update');
    assert.deepEqual([widget.akariPreviewSummary.layers[0].sourceWidth,
        widget.akariPreviewModelSnapshot.summary.layers[0].sourceHeight], [540, 960]);
    assert.equal(summary.layers[0].sourceWidth, undefined);
});

test('every dimension request has an explicit frame engine guard', () => {
    const calls = [...handlerSource.matchAll(/layerDimensions\((?:colorUri|sidecarUri|streamUri), item\.id\)/gu)];
    assert.equal(calls.length, 4);
    for (const call of calls) {
        const declaration = handlerSource.lastIndexOf('const dimensions =', call.index);
        assert.ok(declaration >= 0);
        assert.match(handlerSource.slice(declaration, call.index), /options\.frameEngineEnabled === true/u);
    }
});
