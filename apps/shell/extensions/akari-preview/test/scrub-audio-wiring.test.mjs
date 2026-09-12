import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createScrubAudioController } from '../../../../../packages/preview-server/public/audio-scrub.js';
import { resolveScrubSeek } from '../lib/common/scrub-audio-wiring.js';

const handlerSource = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const frontendSource = readFileSync(new URL('../src/browser/akari-preview-frontend-module.ts', import.meta.url), 'utf8');
const wiringSource = readFileSync(new URL('../src/common/scrub-audio-wiring.ts', import.meta.url), 'utf8');

function section(start, end) {
    const from = handlerSource.indexOf(start);
    const to = handlerSource.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, `section not found: ${start}`);
    return handlerSource.slice(from, to);
}

function scrubMp4Fixture() {
    const concat = (...parts) => {
        const result = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
        let offset = 0;
        for (const part of parts) { result.set(part, offset); offset += part.byteLength; }
        return result;
    };
    const bytes = (...values) => Uint8Array.from(values);
    const ascii = value => Uint8Array.from(value, character => character.charCodeAt(0));
    const u16 = value => bytes(value >>> 8, value);
    const u32 = value => bytes(value >>> 24, value >>> 16, value >>> 8, value);
    const box = (type, ...payload) => {
        const body = concat(...payload);
        return concat(u32(body.byteLength + 8), ascii(type), body);
    };
    const fullBox = (type, ...payload) => box(type, bytes(0, 0, 0, 0), ...payload);
    const descriptor = (tag, payload) => concat(bytes(tag, payload.byteLength), payload);
    const ftyp = box('ftyp', ascii('isom'), u32(0));
    const media = bytes(...Array.from({ length: 64 }, (_, index) => index + 1));
    const mediaOffset = ftyp.byteLength + 8;
    const mdat = box('mdat', media);
    const esdsPayload = descriptor(0x03, concat(u16(1), bytes(0), descriptor(0x04, concat(
        bytes(0x40, 0x15), u32(0), u32(0), u32(0), descriptor(0x05, bytes(0x11, 0x90))
    ))));
    const entry = box('mp4a', bytes(0, 0, 0, 0, 0, 0), u16(1), u32(0), u32(0),
        u16(2), u16(16), u16(0), u16(0), u32(48000 << 16), fullBox('esds', esdsPayload));
    const stbl = box('stbl',
        fullBox('stsd', u32(1), entry),
        fullBox('stts', u32(1), u32(16), u32(1024)),
        fullBox('stsc', u32(1), u32(1), u32(16), u32(1)),
        fullBox('stsz', u32(0), u32(16), ...Array(16).fill(u32(4))),
        fullBox('stco', u32(1), u32(mediaOffset))
    );
    const mdhd = fullBox('mdhd', u32(0), u32(0), u32(48000), u32(16384), u16(0), u16(0));
    const hdlr = fullBox('hdlr', u32(0), ascii('soun'), new Uint8Array(12), bytes(0));
    const trak = box('trak', fullBox('tkhd', u32(0)), box('mdia', mdhd, hdlr, box('minf', stbl)));
    const moov = box('moov', fullBox('mvhd', u32(0), u32(0), u32(1000), u32(1000)), trak);
    return { file: concat(ftyp, mdat, moov), mediaOffset };
}

async function until(predicate) {
    for (let index = 0; index < 100; index++) {
        if (predicate()) return;
        await new Promise(resolve => setImmediate(resolve));
    }
    assert.fail('condition was not reached');
}

test('resolveScrubSeek はタイムライン位置を正しい音源 URL と source time へ解決する', () => {
    const base = {
        outputTime: 4,
        isPlaying: false,
        mapped: { index: 0, kind: 'src', time: 2.5 },
        segment: { kind: 'src', src: 'camera' },
        isStill: false,
        videoSources: { camera: '/proxy.mp4' },
        videoSourceOriginals: {},
        fallbackSrc: '/fallback.mp4'
    };
    assert.deepEqual(resolveScrubSeek(base), {
        outputTime: 4, sourceTime: 2.5, src: '/proxy.mp4', isPlaying: false
    });
    assert.equal(resolveScrubSeek({ ...base, isPlaying: true }).isPlaying, true);
    assert.equal(resolveScrubSeek({ ...base, videoSourceOriginals: { camera: '/original.mp4' } }).src, '/original.mp4');
    assert.equal(resolveScrubSeek({ ...base, mapped: { index: 0, kind: 'gap' } }), null);
    assert.equal(resolveScrubSeek({ ...base, isStill: true }), null);
    assert.equal(resolveScrubSeek({ ...base, videoSources: {}, segment: { kind: 'src', src: 'missing' } }).src,
        '/fallback.mp4');
    assert.equal(resolveScrubSeek({
        ...base, videoSources: {}, segment: { kind: 'src', src: 'missing' }, fallbackSrc: ''
    }), null);
});

function untouchedController({ muted = false, isPlaying = false, enabled = true } = {}) {
    const calls = [];
    const audioContext = {
        currentTime: 0,
        state: 'running',
        destination: {},
        createGain() { calls.push('createGain'); return { gain: { value: 1 }, connect() {} }; },
        createBufferSource() { calls.push('createBufferSource'); return {}; },
        createBuffer() { calls.push('createBuffer'); return {}; },
        async resume() { calls.push('resume'); },
        async suspend() { calls.push('suspend'); }
    };
    const controller = createScrubAudioController({
        audioContext,
        video: { muted, volume: 1 },
        enabled,
        fetchFn: async () => { calls.push('fetch'); throw new Error('unexpected fetch'); },
        setTimeoutFn: () => 1,
        clearTimeoutFn: () => undefined,
        AudioDecoderCtor: class { static async isConfigSupported() { return { supported: true }; } }
    });
    controller.onSeek({ outputTime: 4, sourceTime: 2.5, src: '/source.mp4', isPlaying });
    return calls;
}

test('controller は globalMuted・通常再生中・設定 OFF では取得も発音もしない', () => {
    assert.deepEqual(untouchedController({ muted: true }), []);
    assert.deepEqual(untouchedController({ isPlaying: true }), []);
    assert.deepEqual(untouchedController({ enabled: false }), []);
});

test('正本 controller が追い越された Range fetch を abort する', async () => {
    const fixture = scrubMp4Fixture();
    const moovSignals = [];
    let packetSignal;
    let packetFetches = 0;
    const fetchFn = async (_src, options) => {
        const match = /^bytes=(\d+)-(\d+)$/.exec(options.headers.Range);
        const start = Number(match[1]);
        const end = Math.min(fixture.file.byteLength - 1, Number(match[2]));
        if (start >= fixture.mediaOffset && start < fixture.mediaOffset + 64 && ++packetFetches === 1) {
            packetSignal = options.signal;
            return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => {
                const error = new Error('aborted');
                error.name = 'AbortError';
                reject(error);
            }, { once: true }));
        }
        if (!(start >= fixture.mediaOffset && start < fixture.mediaOffset + 64)) {
            moovSignals.push('signal' in options ? options.signal : null);
        }
        const chunk = fixture.file.slice(start, end + 1);
        return {
            status: 206,
            headers: { get: name => name.toLowerCase() === 'content-range'
                ? `bytes ${start}-${end}/${fixture.file.byteLength}` : null },
            arrayBuffer: async () => chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength)
        };
    };
    class Chunk { constructor(init) { Object.assign(this, init); } }
    class Decoder {
        static async isConfigSupported(config) { return { supported: true, config }; }
        constructor(callbacks) { this.callbacks = callbacks; this.state = 'unconfigured'; this.chunks = []; }
        configure() { this.state = 'configured'; }
        decode(chunk) { this.chunks.push(chunk); }
        async flush() {
            for (const chunk of this.chunks) this.callbacks.output({
                timestamp: chunk.timestamp, numberOfChannels: 2, numberOfFrames: 1024, sampleRate: 48000,
                copyTo(target) { target.fill(0); }, close() {}
            });
        }
        close() { this.state = 'closed'; }
    }
    const audioContext = {
        currentTime: 0, state: 'running', destination: {},
        createBuffer(channels, length, sampleRate) {
            const planes = Array.from({ length: channels }, () => new Float32Array(length));
            return { numberOfChannels: channels, length, duration: length / sampleRate,
                getChannelData: channel => planes[channel] };
        },
        createGain() { return { gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} }; },
        createBufferSource() { return { connect() {}, start() {}, stop() {} }; },
        async resume() {}, async suspend() {}
    };
    let wallMs = 0;
    const controller = createScrubAudioController({
        audioContext, video: { muted: false, volume: 1 }, getBgm: () => ({}), fetchFn,
        now: () => wallMs, AudioDecoderCtor: Decoder, EncodedAudioChunkCtor: Chunk,
        setTimeoutFn: () => 1, clearTimeoutFn: () => undefined,
        tuning: { velocitySamples: 2, fastSpeedEnterRatio: 1000 }
    });
    await controller.prepare('/source.mp4');
    assert.ok(moovSignals.every(signal => signal === null));
    controller.onSeek({ outputTime: 0.04, sourceTime: 0.04, src: '/source.mp4', isPlaying: false });
    await until(() => packetSignal);
    wallMs = 1000;
    controller.onSeek({ outputTime: 0.12, sourceTime: 0.12, src: '/source.mp4', isPlaying: false });
    assert.equal(packetSignal.aborted, true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(controller.lastError, null);
});

test('webview 配線は共有 AudioContext を BGM の有無と分離して使う', () => {
    const host = section('    protected hostAdapterScript(): string {', '    protected previewBootstrapScript(): string {');
    const ensureAt = host.indexOf('window.akari.ensurePreviewAudioContext = () =>');
    const createAt = host.indexOf('const createPreviewAudio = () =>');
    assert.ok(ensureAt >= 0 && ensureAt < createAt);
    assert.match(host, /const context = window\.akari\.ensurePreviewAudioContext\(\);/);
    assert.doesNotMatch(section('const createPreviewAudio = () =>', '// frame-engine 経路の音は'), /new AudioContext\(/);
    assert.match(section('const ensureScrubAudio = () =>', 'let scrubAudioEnabled ='),
        /window\.akari\.ensurePreviewAudioContext\(\)/);
    assert.match(section('const rebuildSegments = () =>', 'const syncSegmentPlaybackRate ='),
        /prepareScrubAudioSources\(\);/);
});

test('scrubBgm は既存 envelope の参照エラーを 0 dB へ隔離する', () => {
    const scrubBgm = section('scrubBgm: timelineTime => {', 'updateConfig: async');
    assert.match(scrubBgm,
        /let envelopeDb = 0;\s*try \{[\s\S]*?envelopeDbAt\([\s\S]*?\}\s*catch \(_error\) \{\s*envelopeDb = 0;\s*\}/);
    assert.match(scrubBgm,
        /dbToLinear\(decoded\.bgm\.gainDb \+ envelopeDb\)\s*\* fadeMultiplierAt\(timelineTime\)/);
});

test('seek・transport・設定変更の scrub 配線を固定する', () => {
    const throttle = section('const scrubThrottle = createRafThrottleFn(() =>', 'const requestScrub = timelineValue =>');
    assert.match(throttle, /seekTimelineTime\(target\);\s*notifyScrubSeek\(\);/);
    const toggle = section('const togglePlayback = () =>', 'restoreInitialPlayback = () =>');
    assert.match(toggle, /isPlaying = true;\s*if \(scrubAudio\) scrubAudio\.stop\(\);/);
    assert.ok(toggle.indexOf('scrubAudio.stop()') < toggle.indexOf('window.akari.frameEngineClock.play'));
    assert.match(toggle, /isPlaying = false;\s*if \(scrubAudio\) scrubAudio\.onPlaybackPaused\(\);/);
    assert.match(handlerSource,
        /message\.type === 'akari-preview-set-scrub-audio'[\s\S]*?setScrubAudioEnabled\(message\.enabled\)/);
    assert.doesNotMatch(section('const applyInitialPosition = () =>', 'const showPlaybackError ='), /notifyScrubSeek/);
});

test('shell 暫定 fetch gate を撤去し正本 controller の観測値を使う', () => {
    const ensure = section('const ensureScrubAudio = () =>', 'let scrubAudioEnabled =');
    assert.doesNotMatch(ensure, /fetchFn:/);
    const notify = section('const notifyScrubSeek = () =>', 'window.akari.scrubAudioDebug = () =>');
    assert.doesNotMatch(handlerSource, /createScrubFetchGate|beginSeek/);
    assert.doesNotMatch(wiringSource, /createScrubFetchGate/);
    assert.match(notify, /controller\.onSeek\(input\);/);
    assert.match(handlerSource, /inFlightFetches: scrubAudio \? scrubAudio\.inFlightFetches : null/);
});

test('設定・初期状態・原本 URL は host から webview まで伝播する', () => {
    assert.match(frontendSource,
        /'akari\.preview\.scrubAudio': \{\s*type: 'boolean',\s*default: true,/);
    assert.match(handlerSource, /preferences\.get<boolean>\('akari\.preview\.scrubAudio', true\)/);
    assert.match(handlerSource, /scrubAudioEnabled,\s*previewAudioWorkletUrl:/);
    assert.match(handlerSource, /onPreferenceChanged\(event => \{[\s\S]*?'akari\.preview\.scrubAudio'/);
    assert.doesNotMatch(handlerSource,
        /if \(frameEngineEnabled && stream(?:Video)?Uri\.toString\(\) !== (?:videoUri|entry\.uri)\.toString\(\)\)/);
});
