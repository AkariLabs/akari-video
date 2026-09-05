import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { AkariPreviewServiceImpl } = require('../lib/node/akari-preview-service.js');

// バックエンドの preparePreviewAudioSidecar は同じプロセスで素材の HTTP Range 配信も担うため、
// media-bin の probe は非同期版（probePreviewAudioSourceAsync）を await しなければならない。
// 偽モジュールで「どの関数が何回呼ばれたか」と、heavyWavOnly ゲート・結果の写像・失敗時の
// reason が変わっていないことを固定する。
async function fixture(t) {
    const base = await mkdtemp(join(tmpdir(), 'akari-preview-audio-sidecar-'));
    t.after(() => rm(base, { recursive: true, force: true }));
    const project = join(base, 'project');
    await mkdir(join(project, 'assets'), { recursive: true });
    const heavy = join(project, 'assets', 'heavy.wav');
    const light = join(project, 'assets', 'light.wav');
    await Promise.all([
        writeFile(heavy, Buffer.alloc(8 * 1024 * 1024 + 1)),
        writeFile(light, Buffer.alloc(1024))
    ]);
    return { base, project, heavy, light, canonical: await realpath(project) };
}

function fakeModule(base, overrides = {}) {
    const calls = { probeSync: 0, probeAsync: 0, ensure: [] };
    const module = {
        probePreviewAudioSource() {
            calls.probeSync += 1;
            throw new Error('the synchronous probe must not run on the backend hot path');
        },
        async probePreviewAudioSourceAsync(sourcePath) {
            calls.probeAsync += 1;
            await new Promise(resolve => setTimeout(resolve, 5));
            return { ok: true, path: sourcePath, bytes: 1, durationSec: 12.5, sampleRate: 48000, channels: 2 };
        },
        async ensurePreviewAudioSidecar(options) {
            calls.ensure.push(options);
            const output = join(base, `sidecar-${calls.ensure.length}.flac`);
            await writeFile(output, Buffer.alloc(64));
            return {
                ok: true, skipped: false, path: output, key: 'fake-key',
                durationSec: options.outSec - options.inSec, sampleRate: 48000, channels: 2, reason: null
            };
        },
        sweepPreviewAudioSidecars() {
            return { removed: 0, bytes: 0 };
        },
        ...overrides
    };
    return { module, calls };
}

function serviceFor(project, module) {
    const service = new AkariPreviewServiceImpl();
    const root = pathToFileURL(project).toString();
    service.workspaceServer = {
        getMostRecentlyUsedWorkspace: async () => root,
        getRecentWorkspaces: async () => [root]
    };
    service.loadSpeechAtempoModule = async () => module;
    // ローカル HTTP Range サーバは起動しない（listen できない sandbox でも走らせる）。
    service.createAssetStream = async request => ({
        id: 'stream-1',
        url: `http://127.0.0.1:1/asset/stream-1?src=${encodeURIComponent(request.assetUri)}`
    });
    return service;
}

function requestFor(data, overrides = {}) {
    return {
        sourceUri: pathToFileURL(data.heavy).toString(),
        projectRootUri: pathToFileURL(data.project).toString(),
        workspaceRoots: [pathToFileURL(data.project).toString()],
        inSec: 0,
        speed: 1,
        ...overrides
    };
}

test('outSec 省略時は非同期 probe で尺を決め、同期 probe は呼ばない', async t => {
    const data = await fixture(t);
    const { module, calls } = fakeModule(data.base);
    const service = serviceFor(data.project, module);
    const result = await service.preparePreviewAudioSidecar(requestFor(data, { heavyWavOnly: true }));
    assert.equal(result.ok, true, result.reason);
    assert.equal(calls.probeAsync, 1);
    assert.equal(calls.probeSync, 0);
    assert.equal(calls.ensure.length, 1);
    assert.equal(calls.ensure[0].sourcePath, await realpath(data.heavy));
    assert.equal(calls.ensure[0].outSec, 12.5);
    assert.equal(calls.ensure[0].cacheDir, join(data.canonical, '.akari', 'cache'));
    assert.deepEqual([calls.ensure[0].padBeforeSec, calls.ensure[0].padAfterSec], [0, 0]);
    assert.equal(result.eligible, true);
    assert.equal(result.skipped, false);
    assert.equal(result.key, 'fake-key');
    assert.equal(result.durationSec, 12.5);
    assert.equal(result.sampleRate, 48000);
    assert.equal(result.channels, 2);
    assert.equal(result.bytes, 64);
    assert.ok(Number.isFinite(result.generatedMs) && result.generatedMs >= 0);
    assert.match(result.stream.url, /^http:\/\/127\.0\.0\.1:1\/asset\/stream-1\?src=file/u);
});

test('outSec 指定時は probe を一切呼ばず、pad をそのまま渡す', async t => {
    const data = await fixture(t);
    const { module, calls } = fakeModule(data.base);
    const service = serviceFor(data.project, module);
    const result = await service.preparePreviewAudioSidecar(requestFor(data, {
        inSec: 1.5, outSec: 4, speed: 1.25, padBeforeSec: 0.25, padAfterSec: 0.5
    }));
    assert.equal(result.ok, true, result.reason);
    assert.equal(calls.probeAsync, 0);
    assert.equal(calls.probeSync, 0);
    assert.equal(calls.ensure.length, 1);
    assert.equal(calls.ensure[0].inSec, 1.5);
    assert.equal(calls.ensure[0].outSec, 4);
    assert.equal(calls.ensure[0].speed, 1.25);
    assert.deepEqual([calls.ensure[0].padBeforeSec, calls.ensure[0].padAfterSec], [0.25, 0.5]);
    assert.equal(result.durationSec, 2.5);
});

test('heavyWavOnly は 8 MiB 以下の WAV を eligible: false で弾き、media-bin を呼ばない', async t => {
    const data = await fixture(t);
    const { module, calls } = fakeModule(data.base);
    const service = serviceFor(data.project, module);
    const result = await service.preparePreviewAudioSidecar(requestFor(data, {
        sourceUri: pathToFileURL(data.light).toString(), heavyWavOnly: true
    }));
    assert.equal(result.ok, false);
    assert.equal(result.eligible, false);
    assert.equal(result.skipped, false);
    assert.equal(result.reason, 'source is not a WAV over 8 MB');
    assert.deepEqual([calls.probeAsync, calls.probeSync, calls.ensure.length], [0, 0, 0]);

    // heavyWavOnly なし（台詞経路）なら小さな WAV でも生成する。
    const speech = await service.preparePreviewAudioSidecar(requestFor(data, {
        sourceUri: pathToFileURL(data.light).toString()
    }));
    assert.equal(speech.ok, true, speech.reason);
    assert.deepEqual([calls.probeAsync, calls.ensure.length], [1, 1]);
});

test('非同期 probe の失敗は reason へ載り、生成には進まない', async t => {
    const data = await fixture(t);
    const { module, calls } = fakeModule(data.base, {
        async probePreviewAudioSourceAsync() {
            calls.probeAsync += 1;
            return { ok: false, durationSec: 0, reason: 'ffprobe exploded' };
        }
    });
    const service = serviceFor(data.project, module);
    const result = await service.preparePreviewAudioSidecar(requestFor(data));
    assert.equal(result.ok, false);
    assert.equal(result.skipped, false);
    assert.equal(result.reason, 'ffprobe exploded');
    assert.equal(result.durationSec, 0);
    assert.ok(Number.isFinite(result.generatedMs));
    assert.deepEqual([calls.probeAsync, calls.ensure.length], [1, 0]);
});

test('生成失敗は eligible: true のまま media-bin の reason を返す', async t => {
    const data = await fixture(t);
    const { module } = fakeModule(data.base, {
        async ensurePreviewAudioSidecar() {
            return {
                ok: false, skipped: false, path: null, key: 'k',
                durationSec: 0, sampleRate: 0, channels: 0, reason: 'ffmpeg timed out after 1 ms'
            };
        }
    });
    const service = serviceFor(data.project, module);
    const result = await service.preparePreviewAudioSidecar(requestFor(data, { outSec: 2 }));
    assert.equal(result.ok, false);
    assert.equal(result.eligible, true);
    assert.equal(result.reason, 'ffmpeg timed out after 1 ms');
    assert.equal(result.stream, undefined);
});

function nonblockingService(t, data, result) {
    const resolver = require('../lib/node/hevc-proxy.js');
    // Resolving an executable is separate from invoking ffmpeg/probe to prepare audio.
    t.mock.method(resolver, 'resolveFfmpegPath', async () => 'fake-ffmpeg');
    const requests = [];
    const { module, calls } = fakeModule(data.base, {
        requestPreviewAudioSidecar(options) {
            requests.push(options);
            return result;
        }
    });
    return { service: serviceFor(data.project, module), module, calls, requests };
}

test('PCM ready resolves an asset stream target and preserves its complete metadata', async t => {
    const data = await fixture(t);
    const path = join(data.project, 'ready.pcm');
    await writeFile(path, Buffer.alloc(48000));
    const metadata = { format: 'pcm-s16le', sampleRate: 24000, channels: 1, frames: 24000, bytesPerSample: 2 };
    const { service } = nonblockingService(t, data, {
        state: 'ready', key: 'pcm-key', path, durationSec: 1, bytes: 48000, ...metadata
    });
    const targets = [];
    service.createAssetStream = async request => {
        targets.push(await service.resolveAssetStreamTarget(request));
        return { id: 'pcm-stream', url: 'http://127.0.0.1:1/asset/pcm-stream' };
    };
    const result = await service.requestPreviewAudioSidecar(requestFor(data, { format: 'pcm-s16le' }));
    assert.equal(result.state, 'ready', result.reason);
    assert.equal(targets.length, 1);
    assert.equal(targets[0].path, await realpath(path));
    assert.equal(targets[0].mimeType, 'application/octet-stream');
    assert.equal(result.stream.id, 'pcm-stream');
    for (const [field, value] of Object.entries(metadata)) assert.equal(result[field], value);
});

test('request forwards format and decodedBytesThreshold unchanged and omits undefined options', async t => {
    const data = await fixture(t);
    const { service, requests, calls } = nonblockingService(t, data, { state: 'queued', key: 'k' });
    for (const options of [
        { format: 'pcm-s16le', decodedBytesThreshold: 64 * 1024 * 1024 },
        { format: 'flac', decodedBytesThreshold: 12345 },
        { format: undefined, decodedBytesThreshold: undefined }
    ]) {
        assert.equal((await service.requestPreviewAudioSidecar(requestFor(data, options))).state, 'queued');
        const forwarded = requests.at(-1);
        for (const field of ['format', 'decodedBytesThreshold']) {
            assert.equal(forwarded[field], options[field]);
            assert.equal(field in forwarded, options[field] !== undefined);
        }
    }
    assert.deepEqual([calls.probeSync, calls.probeAsync, calls.ensure.length], [0, 0, 0]);
});

test('request not-needed returns unadorned state without creating a stream', async t => {
    const data = await fixture(t);
    const { service, calls } = nonblockingService(t, data, { state: 'not-needed' });
    service.createAssetStream = async () => assert.fail('not-needed must not create a stream');
    assert.deepEqual(await service.requestPreviewAudioSidecar(requestFor(data, {
        format: 'pcm-s16le', decodedBytesThreshold: 64 * 1024 * 1024
    })), { state: 'not-needed' });
    assert.deepEqual([calls.probeSync, calls.probeAsync, calls.ensure.length], [0, 0, 0]);
});

test('request ready は stream と key / duration / bytes / probe を写す', async t => {
    const data = await fixture(t);
    const path = join(data.project, 'ready.flac');
    await writeFile(path, Buffer.alloc(64));
    const raw = {
        state: 'ready', path, key: 'ready-key', durationSec: 2.5, bytes: 64,
        sampleRate: 48000, channels: 2, probe: { fingerprint: 'fingerprint' }
    };
    const { service, calls, requests } = nonblockingService(t, data, raw);
    const clipFx = { lowcut_hz: 100 };
    const result = await service.requestPreviewAudioSidecar(requestFor(data, {
        inSec: 1, outSec: 3, speed: 1.25, padBeforeSec: 0.25, padAfterSec: 0.5, clipFx
    }));
    assert.deepEqual(result, {
        state: 'ready', key: raw.key, durationSec: raw.durationSec, bytes: raw.bytes,
        sampleRate: 48000, channels: 2, probe: raw.probe, stream: result.stream
    });
    assert.match(result.stream.url, /\?src=file/u);
    assert.deepEqual(requests, [{
        sourcePath: await realpath(data.heavy), inSec: 1, outSec: 3, speed: 1.25,
        padBeforeSec: 0.25, padAfterSec: 0.5, clipFx, ffmpeg: 'fake-ffmpeg',
        cacheDir: join(data.canonical, '.akari', 'cache')
    }]);
    assert.deepEqual([calls.probeSync, calls.probeAsync, calls.ensure.length], [0, 0, 0]);
});

for (const state of ['queued', 'generating', 'no-audio', 'failed']) {
    test(`request ${state} は即返しで stream / probe / ensure を起動しない`, async t => {
        const data = await fixture(t);
        const raw = {
            state, key: null, probe: { fingerprint: 'pending-probe', pending: true },
            reason: 'known state', retryAfterMs: 60000
        };
        const { service, calls, requests } = nonblockingService(t, data, raw);
        service.createAssetStream = async () => assert.fail('only ready may create a stream');
        const result = await service.requestPreviewAudioSidecar(requestFor(data));
        assert.deepEqual(result, {
            state, probe: { fingerprint: 'pending-probe' }, reason: 'known state', retryAfterMs: 60000
        });
        assert.equal(requests.length, 1);
        assert.equal('outSec' in requests[0], false);
        assert.deepEqual([calls.probeSync, calls.probeAsync, calls.ensure.length], [0, 0, 0]);
    });
}

test('request heavyWavOnly は軽い WAV を not-eligible で返し module を読み込まない', async t => {
    const data = await fixture(t);
    const { service, requests } = nonblockingService(t, data, { state: 'queued' });
    service.loadSpeechAtempoModule = async () => assert.fail('ineligible request must not load media-bin');
    const result = await service.requestPreviewAudioSidecar(requestFor(data, {
        sourceUri: pathToFileURL(data.light).toString(), heavyWavOnly: true
    }));
    assert.deepEqual(result, { state: 'not-eligible' });
    assert.equal(requests.length, 0);
});

test('request は workspace 外の source / project と不正数値を unavailable にする', async t => {
    const data = await fixture(t);
    const outside = join(data.base, 'outside.wav');
    await writeFile(outside, Buffer.alloc(10));
    const { service, requests } = nonblockingService(t, data, { state: 'queued' });
    for (const patch of [
        { sourceUri: pathToFileURL(outside).toString() },
        { projectRootUri: pathToFileURL(data.base).toString() },
        { inSec: -1 }, { inSec: NaN }, { outSec: 0 }, { speed: 0 },
        { padBeforeSec: -1 }, { padAfterSec: Infinity }
    ]) {
        const result = await service.requestPreviewAudioSidecar(requestFor(data, patch));
        assert.equal(result.state, 'unavailable');
        assert.match(result.reason, /workspace|Invalid preview audio/u);
        assert.equal(result.stream, undefined);
    }
    assert.equal(requests.length, 0);
});

test('request は未知状態と例外と ffmpeg 不在を unavailable に写す', async t => {
    const data = await fixture(t);
    const { service, module, requests } = nonblockingService(t, data, { state: 'invalid', reason: 'invalid recipe' });
    for (const state of ['invalid', 'legacy', 'missing']) {
        module.requestPreviewAudioSidecar = () => ({ state, reason: 'invalid recipe' });
        assert.deepEqual(await service.requestPreviewAudioSidecar(requestFor(data)), {
            state: 'unavailable', reason: 'invalid recipe'
        });
    }
    module.requestPreviewAudioSidecar = () => { throw new Error('cache unavailable'); };
    assert.deepEqual(await service.requestPreviewAudioSidecar(requestFor(data)), {
        state: 'unavailable', reason: 'cache unavailable'
    });
    t.mock.method(require('../lib/node/hevc-proxy.js'), 'resolveFfmpegPath', async () => undefined);
    assert.deepEqual(await service.requestPreviewAudioSidecar(requestFor(data)), {
        state: 'unavailable', reason: 'ffmpeg-missing'
    });
    assert.equal(requests.length, 0);
});

test('sweep は keepProbes / minAgeMs を透過し、省略時は追加しない', async t => {
    const data = await fixture(t);
    const options = [];
    const { module } = fakeModule(data.base, {
        sweepPreviewAudioSidecars(value) {
            options.push(value);
            return { removed: 2, bytes: 64 };
        }
    });
    const service = serviceFor(data.project, module);
    const request = {
        projectRootUri: pathToFileURL(data.project).toString(),
        workspaceRoots: [pathToFileURL(data.project).toString()], keepKeys: ['key']
    };
    assert.deepEqual(await service.sweepPreviewAudioSidecars({
        ...request, keepProbes: ['fingerprint'], minAgeMs: 60 * 60 * 1000
    }), { removed: 2, bytes: 64 });
    await service.sweepPreviewAudioSidecars(request);
    assert.deepEqual(options, [
        { cacheDir: join(data.canonical, '.akari', 'cache'), keepKeys: ['key'], keepProbes: ['fingerprint'], minAgeMs: 3600000 },
        { cacheDir: join(data.canonical, '.akari', 'cache'), keepKeys: ['key'] }
    ]);
});
