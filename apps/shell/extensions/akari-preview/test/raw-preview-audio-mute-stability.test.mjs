import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readHandlerSource } from './helpers/handler-source.mjs';

const source = readHandlerSource();
const section = (start, end) => {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, `${start} … ${end}`);
    return source.slice(from, to);
};
const muteState = section('            const applyCutsMuteState = () => {', '            const liveDom =');
const rawSidecar = section("            if (initial.kind === 'raw' && initial.hasSourceAudio === true) {",
    '            window.akari.previewPlaybackRate =');

function preview(kind) {
    const mutedWrites = [];
    const datasetWrites = [];
    let muted = false;
    let globalMuted = false;
    let cutsTrackMuted = false;
    const video = {
        get muted() { return muted; },
        set muted(value) { mutedWrites.push(value); muted = value; },
        dataset: {
            get akariGlobalMuted() { return this.value; },
            set akariGlobalMuted(value) { datasetWrites.push(value); this.value = value; },
        },
        style: {},
    };
    const context = vm.createContext({
        video, initial: { kind }, window: { akari: { rawAudioActive: kind === 'raw', rawAudioSync() {} } },
        segments: [{ kind: 'src', track: 1 }], activeSegmentIndex: 0,
        allTracksMutedByScope: { cuts: false }, mutedTracksByScope: { cuts: new Set() },
        allTracksHiddenByScope: { cuts: false }, hiddenTracksByScope: { cuts: new Set() },
        applyCutsZIndex() {}, isCutAudioAudibleFn: (_segment, options) => !options.muted,
        isStillSegment: () => false, hideStillImage() {}, showStillImage() {},
        playbackErrored: false, globalMuted,
    });
    vm.runInContext(muteState, context);
    return {
        video, mutedWrites, datasetWrites,
        apply() { vm.runInContext('applyCutsMuteState()', context); },
        setGlobalMuted(value) { globalMuted = value; context.globalMuted = value; },
        setCutsTrackMuted(value) {
            cutsTrackMuted = value;
            if (cutsTrackMuted) context.mutedTracksByScope.cuts.add(1);
            else context.mutedTracksByScope.cuts.delete(1);
        },
    };
}

function sidecar() {
    const writes = { muted: [], volume: [], playbackRate: [], currentTime: [] };
    const videoMutedWrites = [];
    const handlers = {};
    const audio = { dataset: {}, readyState: 1, duration: 60, paused: true, seeking: false,
        currentTime: 0, muted: false, volume: 1, playbackRate: 1,
        addEventListener(name, handler) { handlers[name] = handler; },
        pause() {}, play() { return Promise.resolve(); }, remove() {}, load() {},
    };
    for (const key of Object.keys(writes)) {
        let value = audio[key];
        Object.defineProperty(audio, key, {
            get() { return value; },
            set(next) { writes[key].push(next); value = next; },
        });
    }
    const windowHandlers = {};
    const video = { muted: false, dataset: { akariGlobalMuted: 'false' },
        volume: 1, playbackRate: 1, currentTime: 3, paused: true, ended: false,
        addEventListener() {},
    };
    let videoMuted = false;
    Object.defineProperty(video, 'muted', {
        get() { return videoMuted; },
        set(next) { videoMutedWrites.push(next); videoMuted = next; },
    });
    const context = vm.createContext({
        video, initial: { kind: 'raw', hasSourceAudio: true, playbackPageId: 'page' },
        window: { akari: {}, addEventListener(name, handler) { windowHandlers[name] = handler; } },
        document: { createElement() { return audio; }, body: { append() {} } },
        vscode: { postMessage() {} },
    });
    vm.runInContext(rawSidecar, context);
    windowHandlers.message({ data: { type: 'akari-preview-raw-audio-ready', pageId: 'page', url: 'sidecar.flac' } });
    handlers.canplay();
    for (const values of Object.values(writes)) values.length = 0;
    videoMutedWrites.length = 0;
    return { audio, video, writes, videoMutedWrites,
        sync: context.window.akari.rawAudioSync, stop: () => windowHandlers.pagehide() };
}

test('素材プレビューのサイドカー中は100 tickでも映像をミュートに1回だけ設定する', () => {
    const state = preview('raw');
    for (let i = 0; i < 100; i++) state.apply();
    assert.deepEqual(state.mutedWrites, [true]);
    assert.deepEqual(state.datasetWrites, ['false']);
    state.setGlobalMuted(true);
    state.apply();
    state.setGlobalMuted(false);
    state.apply();
    assert.deepEqual(state.mutedWrites, [true]);
    assert.deepEqual(state.datasetWrites, ['false', 'true', 'false']);
});

test('出力プレビューでは全体とカットのミュートが切り替わり、同じ状態では書き直さない', () => {
    const state = preview('output');
    state.apply();
    state.apply();
    assert.deepEqual(state.mutedWrites, []);
    state.setGlobalMuted(true);
    state.apply();
    state.apply();
    assert.deepEqual(state.mutedWrites, [true]);
    state.setGlobalMuted(false);
    state.apply();
    assert.deepEqual(state.mutedWrites, [true, false]);
    state.setCutsTrackMuted(true);
    state.apply();
    state.apply();
    assert.deepEqual(state.mutedWrites, [true, false, true]);
    state.setCutsTrackMuted(false);
    state.apply();
    assert.deepEqual(state.mutedWrites, [true, false, true, false]);
});

test('サイドカー同期は同じ音声属性を書き直さず、シーク中は追いかけシークを積まない', () => {
    const { audio, video, writes, sync } = sidecar();
    video.currentTime = 0;
    audio.currentTime = 0;
    for (const values of Object.values(writes)) values.length = 0;
    sync();
    sync();
    assert.deepEqual(writes.muted, []);
    assert.deepEqual(writes.volume, []);
    assert.deepEqual(writes.playbackRate, []);
    video.currentTime = 1;
    audio.seeking = true;
    sync();
    assert.deepEqual(writes.currentTime, []);
    audio.seeking = false;
    sync();
    assert.deepEqual(writes.currentTime, [1]);
});

test('サイドカーの音量・速度・ミュートの変化は各1回反映し、停止時は映像音声へ戻す', () => {
    const { audio, video, writes, videoMutedWrites, sync, stop } = sidecar();
    video.dataset.akariGlobalMuted = 'true';
    video.volume = 0.4;
    video.playbackRate = 2;
    sync();
    sync();
    assert.equal(audio.muted, true);
    assert.equal(audio.volume, 0.4);
    assert.equal(audio.playbackRate, 2);
    assert.deepEqual(writes.muted, [true]);
    assert.deepEqual(writes.volume, [0.4]);
    assert.deepEqual(writes.playbackRate, [2]);
    stop();
    assert.deepEqual(videoMutedWrites, []);
    video.dataset.akariGlobalMuted = 'false';
    stop();
    stop();
    assert.deepEqual(videoMutedWrites, [false]);
});
