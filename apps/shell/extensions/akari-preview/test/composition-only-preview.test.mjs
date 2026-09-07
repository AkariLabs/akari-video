import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const URI = require('@theia/core/lib/common/uri').default;
const compiled = readFileSync(new URL('../lib/browser/akari-preview-open-handler.js', import.meta.url), 'utf8');
const ast = ts.createSourceFile('handler.js', compiled, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let refreshMethod;
function visit(node) {
    if (ts.isMethodDeclaration(node) && node.name.getText(ast) === 'refreshPreview') refreshMethod = node.getText(ast);
    ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(refreshMethod);
// Execute the actual host method without loading Theia's DOM-dependent application shell.
const refresh = vm.runInNewContext(`({ ${refreshMethod} }).refreshPreview`, {
    PLAYABLE_VIDEO_MIME_TYPES: new Map([['.mp4', 'video/mp4']]),
    exports: { isImageLayerSrc: path => /\.(png|jpg)$/i.test(path) },
    UNSUPPORTED_FORMAT_MESSAGE: 'unsupported', EMPTY_PROJECT_MESSAGE: 'empty',
    OUTSIDE_WORKSPACE_MESSAGE: 'outside', console
});
function harness({ source, empty = false, frameEngine = true, inside = true } = {}) {
    const editUri = new URI('file:///project/edit.json');
    const sourceUri = source ? new URI(`file:///project/${source}`) : undefined;
    const model = {
        editUri, sourceUri, emptyProject: empty,
        summary: { output: { width: 1280, height: 720 }, cuts: source ? [{ src: 'visual' }] : [], layers: [], overlays: [] },
        sourcesById: new Map([
            ['bgm', { uri: new URI('file:///project/bgm.mp3') }],
            ...(sourceUri ? [['visual', { uri: sourceUri }]] : [])
        ]),
        overlayUris: [], assetUris: [], assetStreamIds: ['audio-stream'], captions: []
    };
    const calls = { videos: [], assets: [], probes: [], cards: [], disposed: [] };
    const widget = { title: {}, setContentOptions() {}, setHTML(html) { this.html = html; } };
    const host = {
        stopPreviewAudioPolling() {}, resolveFrameEngineEnabled: async () => frameEngine,
        loadPreviewModel: async () => model, loadRawPreviewModel: async () => model,
        getOverlayRuntimeAssets: async () => ({ origin: 'http://127.0.0.1:1234' }),
        previewModelSnapshot: () => ({}), isInsideWorkspace: async () => inside,
        resolveStreamVideoUri: async uri => uri,
        createVideoStream: async request => { calls.videos.push(request); return { id: 'video', url: 'http://127.0.0.1:1234/video' }; },
        createAssetStream: async request => { calls.assets.push(request); return { id: 'image', url: 'http://127.0.0.1:1234/image' }; },
        previewService: { probeAudioPresence: async request => { calls.probes.push(request); return { hasAudio: true }; } },
        disposeAssetStreams: async ids => calls.disposed.push(...ids),
        disposePreviewStreams: async () => {},
        showMessageCard: (_widget, _uri, message) => calls.cards.push(message),
        resourceSuffix: uri => uri.path.base, previewSessionSettings: new Map(),
        preferences: { get: (_key, fallback) => fallback },
        envVariables: { getValue: async () => undefined }, resolveFrameEngineReadyTimeoutMs: async () => undefined,
        prepareHtml: (...args) => { calls.htmlArgs = args; return '<html>composition</html>'; },
        startPreviewAudioTracking: () => { calls.audioTracking = true; }
    };
    return { calls, widget, run: (kind = 'output') => refresh.call(host, widget, sourceUri ?? editUri, kind) };
}
for (const frameEngine of [true, false]) {
    test(`HTML + BGM opens without a base video stream (frame engine ${frameEngine})`, async () => {
        const h = harness({ frameEngine });
        await h.run();
        assert.equal(h.widget.akariPreviewSeekable, true);
        assert.equal(h.widget.html, '<html>composition</html>');
        assert.deepEqual(h.calls.cards, []);
        assert.deepEqual(h.calls.videos, []);
        assert.deepEqual(h.calls.probes, []);
        assert.equal(h.calls.htmlArgs[1], '');
        assert.deepEqual([...h.widget.akariPreviewAssetStreamIds], ['audio-stream']);
        assert.equal(h.calls.audioTracking, true);
    });
}
test('a video cut after BGM still opens and probes the actual video', async () => {
    const h = harness({ source: 'clip.mp4' }); await h.run();
    assert.equal(h.calls.videos.length, 1);
    assert.match(h.calls.videos[0].videoUri, /clip.mp4$/);
    assert.equal(h.calls.probes.length, 1);
    assert.equal(h.widget.akariPreviewStreamId, 'video');
});
test('still-image cuts use asset streams and skip audio probing', async () => {
    const h = harness({ source: 'image.png' }); await h.run();
    assert.equal(h.calls.assets.length, 1);
    assert.equal(h.calls.probes.length, 0);
    assert.equal(h.widget.akariPreviewStreamId, undefined);
    assert.ok(h.widget.akariPreviewAssetStreamIds.includes('image'));
});
test('unsupported raw media still shows the format card', async () => {
    const h = harness({ source: 'clip.mkv' }); await h.run('raw');
    assert.deepEqual(h.calls.cards, ['unsupported']);
});
test('an empty project retains the empty-project guidance', async () => {
    const h = harness({ empty: true }); await h.run();
    assert.deepEqual(h.calls.cards, ['empty']);
});
test('compositions retain workspace boundary checks', async () => {
    const h = harness({ inside: false }); await h.run();
    assert.deepEqual(h.calls.cards, ['outside']);
    assert.deepEqual(h.calls.disposed, ['audio-stream']);
});

const previewItems = require('../lib/common/preview-items.js');
// Run the actual selection block from loadPreviewModel against normalized edit.json data.
const selectionStart = compiled.indexOf('const cutItems =');
const selectionEnd = compiled.indexOf('\n            const isTruthyObject', selectionStart);
assert.ok(selectionStart >= 0 && selectionEnd > selectionStart);
const selection = compiled.slice(selectionStart, selectionEnd);
function primarySource(edit) {
    const internal = previewItems.readPreviewInternalEdit(JSON.stringify(edit), false);
    const sourcesById = new Map(internal.sources.map(source => [source.id, { uri: source.declaredPath }]));
    return vm.runInNewContext(`let sourceUri; ${selection}; sourceUri`, {
        internal, sourcesById, preview_items_1: previewItems,
        itemWarningState: { warnedKinds: new Set(), warn: () => {} }
    });
}
const htmlTrack = { id: 'visual', lane: 'visual', items: [
    { id: 'scene', at: 0, duration: 90, source: { kind: 'html', path: 'scene.html' } }
] };
const editBase = { version: 2, output: { width: 1280, height: 720, fps: 30 }, tracks: [htmlTrack] };
test('normalization does not select the first BGM declaration as a video source', () => {
    assert.equal(primarySource({ ...editBase, sources: [{ id: 'bgm', path: 'bgm.mp3' }] }), undefined);
});
test('HTML-only composition needs no declared media source', () => {
    assert.equal(primarySource({ ...editBase, sources: [] }), undefined);
});
test('normalization selects the cut source even when BGM is declared first', () => {
    const edit = { ...editBase, sources: [{ id: 'bgm', path: 'bgm.mp3' }, { id: 'clip', path: 'clip.mp4' }],
        tracks: [{ id: 'visual', lane: 'visual', items: [
            { id: 'clip', at: 0, duration: 90, source: { kind: 'media', src: 'clip', in: 0, out: 3 } }
        ] }] };
    assert.equal(primarySource(edit), 'clip.mp4');
});
