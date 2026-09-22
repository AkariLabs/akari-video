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
let refreshMethod, noteSwapReloadMethod, streamVideoMethod;
function visit(node) {
    if (ts.isMethodDeclaration(node) && node.name.getText(ast) === 'refreshPreview') refreshMethod = node.getText(ast);
    if (ts.isMethodDeclaration(node) && node.name.getText(ast) === 'resolveStreamVideoUri') streamVideoMethod = node.getText(ast);
    if (ts.isMethodDeclaration(node) && node.name.getText(ast) === 'noteSwapReload') noteSwapReloadMethod = node.getText(ast);
    ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(refreshMethod);
assert.ok(noteSwapReloadMethod);
const noteSwapReload = vm.runInNewContext(`({ ${noteSwapReloadMethod} }).noteSwapReload`, {
    swap_trial_playback_1: require('../lib/common/swap-trial-playback.js')
});
// Execute the actual host method without loading Theia's DOM-dependent application shell.
const refresh = vm.runInNewContext(`({ ${refreshMethod} }).refreshPreview`, {
    PLAYABLE_VIDEO_MIME_TYPES: new Map([['.mp4', 'video/mp4']]),
    frame_engine_render_scale_1: require('../lib/common/frame-engine-render-scale.js'),
    exports: { isImageLayerSrc: path => /\.(png|jpg)$/i.test(path) },
    UNSUPPORTED_FORMAT_MESSAGE: 'unsupported', EMPTY_PROJECT_MESSAGE: 'empty',
    OUTSIDE_WORKSPACE_MESSAGE: 'outside', console
});
const resolveStreamVideoUri = vm.runInNewContext(`({ ${streamVideoMethod} }).resolveStreamVideoUri`, {
    uri_1: { default: URI }, video_proxy_resolution_1: require('../lib/common/video-proxy-resolution.js')
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
        noteSwapReload, playbackPageSequence: 0,
        stopPreviewAudioPolling() {}, resolveFrameEngineEnabled: async () => frameEngine,
        loadPreviewModel: async () => model, loadRawPreviewModel: async () => model,
        getOverlayRuntimeAssets: async () => ({ origin: 'http://127.0.0.1:1234' }),
        previewModelSnapshot: () => ({}), isInsideWorkspace: async () => inside,
        resolveStreamVideoUri, hevcFallbackProxyUris: new Map(),
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
    return { calls, widget, host, model, run: (kind = 'output') => refresh.call(host, widget, sourceUri ?? editUri, kind) };
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
test('raw video outside the workspace remains blocked before streaming', async () => {
    const h = harness({ source: 'clip.mp4', inside: false }); await h.run('raw');
    assert.deepEqual(h.calls.cards, ['outside']);
    assert.deepEqual(h.calls.videos, []);
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

// Exercise the real refresh -> node resolver -> createVideoStream -> /media/ chain.
// The in-process response uses the actual handler and filesystem stream, without a listen socket.
async function referenceVideoFixture(t, primary, listen = false) {
    const { mkdtemp, mkdir, writeFile, realpath, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const { pathToFileURL } = await import('node:url');
    const { AkariPreviewServiceImpl } = await import('../lib/node/akari-preview-service.js');
    const { recordProjectReference } = await import('../../../../../packages/asset-resolver/src/project-references.mjs');
    const root = await realpath(await mkdtemp(join(tmpdir(), 'reference-video-stream-')));
    const project = join(root, 'project'), library = join(root, 'library');
    const env = { AKARI_HOME: join(root, 'home'), AKARI_CREATOR_ROOT: join(root, 'creator'), AKARI_LIBRARY_ROOT: library };
    const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
    Object.assign(process.env, env);
    const service = new AkariPreviewServiceImpl();
    service.resolveWorkspaceRoots = async () => [project];
    if (!listen) service.ensureServer = async () => 1234;
    t.after(async () => {
        if (service.server) await new Promise(resolve => service.server.close(resolve));
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
        await rm(root, { recursive: true, force: true });
    });
    const bytes = Buffer.from('0123456789abcdef');
    const directory = join(library, 'broll', 'ref-broll');
    await mkdir(directory, { recursive: true }); await mkdir(project);
    await writeFile(join(directory, 'ref-broll.mp4'), bytes);
    await writeFile(join(project, 'local.mp4'), bytes);
    const declaredPath = 'assets/broll/ref-broll/ref-broll.mp4';
    await recordProjectReference(project, { category: 'broll', id: 'ref-broll' });
    const resolved = await service.resolveProjectAssetUri({ projectRootUri: pathToFileURL(project).href, declaredPath });
    const uri = new URI(resolved), local = URI.fromFilePath(join(project, 'local.mp4'));
    const h = harness({ source: 'local.mp4' });
    h.model.editUri = URI.fromFilePath(join(project, 'edit.json'));
    h.model.sourceUri = primary ? uri : local;
    h.model.sourcesById = new Map([['local', { uri: local }], ['src-1', { uri }]]);
    h.model.summary.cuts = primary ? [{ src: 'src-1' }] : [{ src: 'local' }, { src: 'src-1' }];
    h.host.isInsideWorkspace = async candidate => candidate.toString().startsWith(pathToFileURL(project).href + '/');
    h.host.createVideoStream = async request => { h.calls.videos.push(request); return service.createVideoStream(request); };
    return { ...h, service, project, directory, declaredPath, uri, bytes, writeFile, join };
}

async function route(service, url, headers = {}) {
    const { Writable } = await import('node:stream');
    const { once } = await import('node:events');
    const chunks = [], responseHeaders = new Map();
    const response = new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
    response.setHeader = (name, value) => responseHeaders.set(name.toLowerCase(), String(value));
    const finished = once(response, 'finish');
    await service.handleRequest({ method: 'GET', url: new URL(url).pathname, headers }, response);
    await finished;
    return { status: response.statusCode, headers: responseHeaders, body: Buffer.concat(chunks) };
}

for (const primary of [true, false]) {
    test(`参照動画: ${primary ? '代表' : '追加'}ソースに frame-engine 用 /media/ URL を渡し GET 200 / Range 206`, async t => {
        const f = await referenceVideoFixture(t, primary);
        await f.run();
        assert.deepEqual(f.calls.cards, []);
        const url = f.calls.htmlArgs?.[6]?.['src-1']; // prepareHtml -> initial.videoSources
        assert.match(url ?? '', /^http:\/\/127\.0\.0\.1:1234\/media\/[a-f0-9]{64}$/);
        assert.equal(f.calls.htmlArgs[12], true, 'frame engine is enabled');
        assert.ok(f.calls.videos.some(request => request.videoUri === f.uri.toString()));
        const full = await route(f.service, url);
        assert.equal(full.status, 200); assert.deepEqual(full.body, f.bytes);
        assert.equal(full.headers.get('access-control-allow-origin'), '*');
        assert.equal(full.headers.get('content-type'), 'video/mp4');
        const part = await route(f.service, url, { range: 'bytes=2-5' });
        assert.equal(part.status, 206); assert.deepEqual(part.body, f.bytes.subarray(2, 6));
        assert.equal(part.headers.get('content-range'), 'bytes 2-5/16');
        t.diagnostic(`${url}: GET ${full.status}, Range ${part.status}`);
        const target = f.service.videoStreams.get(new URL(url).pathname.split('/').pop());
        assert.deepEqual(target.workspaceRoots, [f.project, f.uri.path.fsPath()]);
        // The library directory itself and other assets remain unauthorized.
        const other = f.join(f.directory, '..', 'unreferenced', 'other.mp4');
        const { mkdir, rm, symlink } = await import('node:fs/promises');
        await mkdir(f.join(other, '..'), { recursive: true }); await f.writeFile(other, f.bytes);
        await assert.rejects(f.service.createVideoStream({ videoUri: URI.fromFilePath(other).toString() }), /outside/);
        // Even an issued stream must reject a replacement symlink to a different file.
        await rm(f.uri.path.fsPath()); await symlink(other, f.uri.path.fsPath());
        assert.equal((await route(f.service, url)).status, 404);
    });
}

test('参照動画 HTTP: frame-engine に渡した /media/ URL が実 HTTP でも 200 / 206 を返す', async t => {
    const f = await referenceVideoFixture(t, false, true);
    await f.run();
    const url = f.calls.htmlArgs[6]['src-1'];
    assert.match(url, /\/media\/[a-f0-9]{64}$/);
    const full = await fetch(url);
    assert.equal(full.status, 200); assert.deepEqual(Buffer.from(await full.arrayBuffer()), f.bytes);
    const part = await fetch(url, { headers: { Range: 'bytes=2-5' } });
    assert.equal(part.status, 206); assert.equal(part.headers.get('content-range'), 'bytes 2-5/16');
    assert.deepEqual(Buffer.from(await part.arrayBuffer()), f.bytes.subarray(2, 6));
});
