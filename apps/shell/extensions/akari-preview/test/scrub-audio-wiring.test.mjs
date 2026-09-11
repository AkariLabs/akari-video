import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createScrubAudioController } from '../../../../../packages/preview-server/public/audio-scrub.js';
import { createScrubFetchGate, resolveScrubSeek } from '../lib/common/scrub-audio-wiring.js';

const handlerSource = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const frontendSource = readFileSync(new URL('../src/browser/akari-preview-frontend-module.ts', import.meta.url), 'utf8');

function section(start, end) {
    const from = handlerSource.indexOf(start);
    const to = handlerSource.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, `section not found: ${start}`);
    return handlerSource.slice(from, to);
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

function pendingFetchGate() {
    const calls = [];
    const timers = [];
    const gate = createScrubFetchGate({
        fetch: (input, init) => {
            calls.push({ input, signal: init?.signal });
            return new Promise(() => undefined);
        },
        setTimeout: fn => { timers.push(fn); return timers.length; }
    });
    return { gate, calls, timers };
}

test('新しい seek は前世代の小さい Range fetch をすべて abort する', () => {
    const { gate, calls } = pendingFetchGate();
    gate.beginSeek();
    void gate.fetchFn('/source.mp4', { headers: { Range: 'bytes=0-1023' } });
    void gate.fetchFn('/source.mp4', { headers: { Range: 'bytes=2048-3071' } });
    assert.equal(gate.inFlight(), 2);
    gate.beginSeek();
    assert.equal(calls[0].signal.aborted, true);
    assert.equal(calls[1].signal.aborted, true);
    assert.equal(gate.inFlight(), 0);
});

test('seek の macrotask 終了後に始まる fetch は札付けも abort もされない', () => {
    const { gate, calls, timers } = pendingFetchGate();
    gate.beginSeek();
    void gate.fetchFn('/source.mp4', { headers: { Range: 'bytes=0-1023' } });
    for (const run of timers.splice(0)) run();
    void gate.fetchFn('/source.mp4', { headers: { Range: 'bytes=2048-3071' } });
    assert.equal(calls[1].signal, undefined);
    gate.beginSeek();
    assert.equal(calls[1].signal, undefined);
});

test('8 KB を超える moov 用 Range は seek 中でも abort 対象にしない', () => {
    const { gate, calls } = pendingFetchGate();
    gate.beginSeek();
    void gate.fetchFn('/source.mp4', { headers: { Range: 'bytes=32-157373' } });
    assert.equal(calls[0].signal, undefined);
    assert.equal(gate.inFlight(), 0);
    gate.beginSeek();
    assert.equal(calls[0].signal, undefined);
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

test('scrub controller は fetch gate を使い onSeek の直前に世代を切り替える', () => {
    const ensure = section('const ensureScrubAudio = () =>', 'let scrubAudioEnabled =');
    assert.match(ensure, /fetchFn: scrubFetchGate\.fetchFn/);
    const notify = section('const notifyScrubSeek = () =>', 'window.akari.scrubAudioDebug = () =>');
    assert.match(notify, /scrubFetchGate\.beginSeek\(\);\s*controller\.onSeek\(input\);/);
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
