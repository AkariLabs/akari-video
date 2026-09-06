import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import { sortSidecarRequestsByFirstUse } from '../lib/common/preview-audio-eligibility.js';
import { toV2Edit } from './helpers/v2-fixture.mjs';

const compiledUrl = new URL('../lib/browser/akari-preview-open-handler.js', import.meta.url);
const compiled = readFileSync(compiledUrl, 'utf8');
const require = createRequire(compiledUrl);
const expected = ['bgm', 'narration', 'speech(0)', 'sfx(5)', 'speech(10.4)'];

test('first-use sorting is stable, regular precedes speech, and inputs are untouched', () => {
    const requests = Object.freeze([
        { at: 10.4, kind: 'speech', id: 'late' },
        { at: 0, kind: 'speech', id: 'speech-a' },
        { at: 5, kind: 'sfx', id: 'sfx' },
        { at: 0, kind: 'narration', id: 'narration' },
        { at: 0, kind: 'speech', id: 'speech-b' },
        { at: 0, kind: 'bgm', id: 'bgm' }
    ].map(Object.freeze));
    const sorted = sortSidecarRequestsByFirstUse(requests);
    assert.deepEqual(sorted.map(item => item.id), ['narration', 'bgm', 'speech-a', 'speech-b', 'sfx', 'late']);
    assert.equal(sorted[0], requests[3]);
    assert.equal(requests[0].id, 'late');
    assert.notEqual(sorted, requests);
    assert.deepEqual(sortSidecarRequestsByFirstUse([]), []);
    assert.deepEqual(sortSidecarRequestsByFirstUse([requests[0]]), [requests[0]]);
});

// As in preview-audio-nonblocking, execute the compiled host methods without Theia's DOM/DI.
// All imported model readers, projections and eligibility functions are the real modules.
function method(name) {
    const start = compiled.search(new RegExp(`^    (?:async )?${name}\\(`, 'mu'));
    assert.ok(start >= 0, name);
    const end = compiled.indexOf('\n    }', start);
    assert.ok(end > start, name);
    return compiled.slice(start, end + '\n    }'.length);
}

function fixture(audioOverrides = {}) {
    return toV2Edit({
        version: 1,
        output: { width: 1280, height: 720, fps: 30 },
        sources: [{ id: 'camera', path: 'camera.mp4' }],
        cuts: [
            { id: 'early', src: 'camera', in: 0, out: 10.4 },
            { id: 'late', src: 'camera', in: 20, out: 30 }
        ],
        overlays: [],
        audio: {
            bgm: { path: 'bgm.m4a', in: 7, gain_db: -6, ducking: true },
            sfx: [{ path: 'sfx.wav', t: 5, gain_db: -3 }],
            narration: [{ id: 'voice', path: 'narration.wav', t: 0, gain_db: -2, provenance: { provider: 'test' } }],
            ...audioOverrides
        }
    });
}

function harness(resultFor = () => ({ state: 'queued' }), streamFor) {
    const body = [
        'loadPreviewModel', 'resolveAudioAssets', 'previewAudioSidecarFields',
        'startPreviewAudioTracking', 'stopPreviewAudioPolling', 'positiveNumber', 'finiteNumber', 'transform'
    ].map(method).join('\n');
    const bindings = {};
    for (const [, name, path] of compiled.matchAll(/^const (\w+) = require\("([^"]+)"\);$/gmu)) {
        if (new RegExp(`\\b${name}\\b`, 'u').test(body)) bindings[name] = require(path);
    }
    const warnings = [];
    const timers = new Map();
    let timerId = 0;
    const Host = vm.runInNewContext(`(class { ${body} })`, {
        ...bindings,
        console: { warn: (...args) => warnings.push(args) },
        // No captions or visual overlays in these fixtures; retain the real image classifier for layers.
        exports: {
            normalizePreviewCaptionClock: captions => captions,
            isImageLayerSrc: vm.runInNewContext([
                compiled.match(/^const IMAGE_LAYER_SRC_PATTERN = .*$/mu)[0],
                compiled.match(/^const isImageLayerSrc = .*$/mu)[0],
                'isImageLayerSrc;'
            ].join('\n'))
        },
        EMPTY_SUMMARY: { output: { width: 1280, height: 720, fps: 30 } },
        LAYER_BLEND_TO_CSS: new Map([['normal', 'normal']]),
        setTimeout: (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; },
        clearTimeout: id => timers.delete(id)
    });
    const host = new Host();
    const calls = [];
    const requests = [];
    host.workspaceService = { roots: Promise.resolve([]) };
    host.lastRawEditVersionByUri = new Map();
    host.migrationCompactionPrompted = new Set();
    host.loadPreviewCaptions = async () => ({ captions: [] });
    host.readText = async () => '';
    host.normalizeEmphasisWords = () => [];
    host.previewCaptionTimelineSegments = () => [];
    host.resolveEditAssetUri = (path, editUri) => editUri.parent.resolve(path);
    host.createAssetStream = async request => streamFor ? streamFor(request)
        : { id: request.assetUri, url: request.assetUri };
    host.disposeAssetStreams = async () => {};
    host.previewService = {
        requestPreviewAudioSidecar: async request => {
            const name = request.sourceUri.endsWith('camera.mp4')
                ? request.inSec === 0 ? 'speech(0)' : 'speech(10.4)'
                : request.sourceUri.endsWith('sfx.wav') ? 'sfx(5)'
                    : request.sourceUri.endsWith('bgm.m4a') ? 'bgm' : 'narration';
            calls.push(name);
            requests.push(request);
            return resultFor(name, request);
        },
        sweepPreviewAudioSidecars: async () => {}
    };
    const URI = require('@theia/core/lib/common/uri').default;
    const load = async (edit = fixture()) => {
        const model = await host.loadPreviewModel(new URI('file:///project/edit.json'), JSON.stringify(edit), { frameEngineEnabled: true });
        assert.equal(model.compositeError, undefined, JSON.stringify(warnings));
        assert.ok(model.summary.audio, JSON.stringify(warnings));
        return model;
    };
    const poll = async () => {
        const [id, timer] = [...timers].find(([, value]) => value.delay === 1000) ?? [];
        assert.ok(timer, 'poll timer exists');
        timers.delete(id);
        timer.fn();
        await new Promise(resolve => setImmediate(resolve));
    };
    return { host, calls, requests, warnings, load, timers, poll };
}

test('loadPreviewModel streams a projected relative mask path into layer.mask and retains the asset', async () => {
    const streams = [];
    const f = harness(() => ({ state: 'not-needed' }), request => {
        streams.push(request.assetUri);
        return { id: request.assetUri, url: `stream://asset/${streams.length}` };
    });
    f.host.resolveStreamVideoUri = async uri => uri;
    const edit = toV2Edit({
        version: 1,
        output: { width: 1280, height: 720, fps: 30 },
        sources: [{ id: 'camera', path: 'camera.mp4' }, { id: 'maskgrad', path: 'assets/mask.mp4' }],
        cuts: [{ src: 'camera', in: 0, out: 4 }],
        layers: [{ id: 'masked', t: 0, duration: 4, kind: 'video',
            src: 'assets/red.mp4', mask: 'assets/mask.mp4' }],
        overlays: [], audio: {}
    });
    const model = await f.load(edit);
    const maskUri = 'file:///project/assets/mask.mp4';
    const maskIndex = streams.indexOf(maskUri);
    assert.ok(maskIndex >= 0, JSON.stringify(f.warnings));
    assert.equal(model.summary.layers.find(layer => layer.id === 'masked').mask, `stream://asset/${maskIndex + 1}`);
    assert.ok(model.assetUris.some(uri => uri.toString() === maskUri));
    assert.equal(f.warnings.length, 0, JSON.stringify(f.warnings));
});

test('loadPreviewModel issues the combined fixture in first-use order and retains pending metadata', async () => {
    const f = harness(name => ({ state: 'queued', key: name, probe: { fingerprint: `probe:${name}` } }));
    const model = await f.load();
    assert.deepEqual(f.calls, expected);
    assert.deepEqual([...model.previewAudioPendingRequests].map(item => item.at), [0, 0, 0, 5, 10.4]);
    assert.deepEqual([...model.previewAudioKeepKeys], expected);
    assert.deepEqual([...model.previewAudioKeepProbes], expected.map(name => `probe:${name}`));
    const audio = model.summary.audio;
    for (const target of [audio.bgm, ...audio.sfx, ...audio.narration, ...audio.speech]) {
        assert.equal(target.sidecarState, 'queued');
        assert.equal(target.sidecar, undefined);
    }
    assert.equal(audio.bgm.in, 7);
    assert.equal(audio.bgm.gainDb, -6);
    assert.equal(audio.bgm.ducking, true);
    assert.equal(audio.sfx[0].gainDb, -3);
    assert.equal(audio.narration[0].gainDb, -2);
});

test('ready results are written back to each declaration with the original stream keys', async () => {
    const f = harness(name => ({
        state: 'ready', key: name, stream: { id: `stream:${name}`, url: `pcm:${name}` },
        format: 'pcm-s16le', sampleRate: 24000, channels: 1, frames: 24000, bytesPerSample: 2
    }));
    const model = await f.load();
    assert.deepEqual(f.calls, expected);
    const audio = model.summary.audio;
    const targets = [audio.bgm, audio.narration[0], audio.speech[0], audio.sfx[0], audio.speech[1]];
    const prefixes = ['audio.bgm', 'audio.narration voice', `speech:${audio.speech[0].id}`, 'audio.sfx[0]', `speech:${audio.speech[1].id}`];
    expected.forEach((name, index) => {
        const target = targets[index];
        assert.equal(target.sidecarState, 'ready');
        assert.equal(target.sidecar.path, `pcm:${name}`);
        assert.equal(target.sidecar.frames, 24000);
        assert.equal(target.sidecar.format, 'pcm-s16le');
        const key = `preview-audio:${prefixes[index]}:${name}`;
        assert.ok(model.previewAudioStreams.has(key), `${key}: ${[...model.previewAudioStreams.keys()]}`);
        assert.equal(model.previewAudioStreams.get(key).id, `stream:${name}`);
        assert.equal(model.assetUrlByUri.get(key), `pcm:${name}`);
        assert.ok(model.assetStreamIds.includes(`stream:${name}`));
    });
    assert.equal(model.previewAudioPendingRequests.length, 0);
});

test('polling reorders pending requests and preserves each request object across retries', async () => {
    let ready = false;
    const f = harness(() => ({ state: ready ? 'not-needed' : 'generating' }));
    const model = await f.load();
    const originals = [...f.requests];
    const pending = model.previewAudioPendingRequests;
    model.previewAudioPendingRequests = [pending[4], pending[3], pending[2], pending[0], pending[1]];
    const widget = {
        isDisposed: false, disposed: { connect() {} },
        akariPreviewSummary: model.summary, sendMessage() {}
    };
    f.host.startPreviewAudioTracking(widget, model, true);
    await f.poll();
    ready = true;
    await f.poll();
    assert.deepEqual(f.calls, [...expected, ...expected, ...expected]);
    originals.forEach((request, index) => {
        assert.equal(f.requests[index + 5], request);
        assert.equal(f.requests[index + 10], request);
    });
    assert.equal(widget.akariPreviewAudioPendingRequests.length, 0);
    for (const target of [model.summary.audio.bgm, ...model.summary.audio.sfx, ...model.summary.audio.narration, ...model.summary.audio.speech]) {
        assert.equal('sidecarState' in target, false);
        assert.equal('sidecar' in target, false);
    }
});

test('initial not-needed results add no state, keys, probes or polling requests', async () => {
    const f = harness(() => ({ state: 'not-needed' }));
    const model = await f.load();
    assert.deepEqual(f.calls, expected);
    for (const target of [model.summary.audio.bgm, ...model.summary.audio.sfx, ...model.summary.audio.narration, ...model.summary.audio.speech]) {
        assert.equal('sidecarState' in target, false);
        assert.equal('sidecar' in target, false);
    }
    assert.equal(model.previewAudioKeepKeys.size, 0);
    assert.equal(model.previewAudioKeepProbes.size, 0);
    assert.equal(model.previewAudioPendingRequests.length, 0);
    assert.equal(model.previewAudioStreams.size, 0);
});

test('pending priority metadata preserves timeline duration and learns keys from polling', async () => {
    let probed = false;
    const f = harness(name => ({ state: probed ? 'generating' : 'queued', ...(probed ? { key: name } : {}) }));
    const model = await f.load(fixture({ sfx: [{ path: 'sfx.wav', t: 5, in: 2, out: 8, lowcut_hz: 100 }] }));
    const pending = model.previewAudioPendingRequests;
    assert.deepEqual([...pending].map(item => item.durationSec === undefined ? undefined : +item.durationSec.toFixed(6)),
        [undefined, undefined, 10.4, 6, 10]);
    assert.ok(pending.every(item => item.key === undefined));
    const widget = { isDisposed: false, disposed: { connect() {} }, akariPreviewSummary: model.summary, sendMessage() {} };
    f.host.startPreviewAudioTracking(widget, model, true);
    probed = true;
    await f.poll();
    assert.deepEqual([...widget.akariPreviewAudioPendingRequests].map(item => item.key), expected);
    assert.ok(widget.akariPreviewAudioPendingRequests.every(item => item.state === 'generating'));
});

test('concurrent regular stream resolution retains declaration order and issues no early RPCs', async () => {
    const f = harness();
    const entries = [];
    const streams = [];
    const URI = require('@theia/core/lib/common/uri').default;
    const resolve = f.host.resolveAudioAssets(
        { sfx: [{ path: 'first.wav', t: 5 }, { path: 'second.wav', t: 5 }] },
        new URI('file:///project/edit.json'), new Map(), [], new Set(), [], entries,
        f.host.previewService, new Set(), key => new Promise(done => streams.push(() => done({ id: key, url: key })))
    );
    assert.equal(streams.length, 2);
    streams[1]();
    await new Promise(done => setImmediate(done));
    assert.deepEqual(f.calls, []);
    streams[0]();
    const audio = await resolve;
    assert.deepEqual(f.calls, []);
    assert.equal(audio.sfx.length, 2);
    for (const entry of sortSidecarRequestsByFirstUse(entries)) await entry.resolve();
    assert.deepEqual(f.requests.map(request => request.sourceUri), ['file:///project/first.wav', 'file:///project/second.wav']);
});

test('regular RPC rejection still drops only that declaration and lets other requests finish', async () => {
    const f = harness(name => {
        if (name === 'narration') throw new Error('fixture RPC failure');
        return { state: 'queued' };
    });
    const model = await f.load();
    assert.deepEqual(f.calls, expected);
    assert.equal(model.summary.audio.narration.length, 0);
    assert.equal(model.summary.audio.sfx.length, 1);
    assert.equal(model.previewAudioPendingRequests.length, 4);
});

test('short trimmed regular audio creates its original stream without requesting a sidecar', async () => {
    const f = harness();
    const model = await f.load(fixture({ sfx: [{ path: 'sfx.wav', t: 5, in: 0, out: 3 }] }));
    assert.deepEqual(f.calls, expected.filter(name => name !== 'sfx(5)'));
    assert.equal(model.summary.audio.sfx[0].src, 'file:///project/sfx.wav');
    assert.equal('sidecarState' in model.summary.audio.sfx[0], false);
});
