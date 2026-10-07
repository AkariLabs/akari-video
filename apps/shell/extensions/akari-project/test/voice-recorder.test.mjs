import assert from 'node:assert/strict';
import test from 'node:test';
import { VoiceRecorder } from '../lib/browser/voice-recording/voice-recorder.js';

function replaceGlobal(name, value) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    return () => previous ? Object.defineProperty(globalThis, name, previous) : delete globalThis[name];
}

function setup(permission = true) {
    let processor;
    let gain;
    let inputGain;
    const appended = [];
    const finished = [];
    const events = [];
    const listeners = new Map();
    const storage = new Map();
    let now = 1000;
    const stream = { getTracks: () => [{ stop() {} }] };
    const devices = {
        getUserMedia: async () => stream,
        enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'mic-1', label: 'USB マイク' },
            { kind: 'videoinput', deviceId: 'camera', label: 'Camera' }]
    };
    const restore = [
        replaceGlobal('navigator', { mediaDevices: devices }),
        replaceGlobal('window', { electronAkariPreview: { askForMicrophoneAccess: async () => permission },
            localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
            addEventListener: (name, listener) => listeners.set(name, listener),
            removeEventListener: (name, listener) => { if (listeners.get(name) === listener) listeners.delete(name); },
            dispatchEvent: event => { events.push(event); listeners.get(event.type)?.(event); return true; } }),
        replaceGlobal('performance', { now: () => now }),
        replaceGlobal('CustomEvent', class { constructor(type, options) { this.type = type; this.detail = options.detail; } }),
        replaceGlobal('AudioContext', class {
            constructor() { this.sampleRate = 48000; this.destination = {}; }
            async resume() {}
            async close() {}
            createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
            createGain() { gain = { gain: { value: 1 }, connect() {}, disconnect() {} }; inputGain ??= gain; return gain; }
            createScriptProcessor() { processor = { connect() {}, disconnect() {}, onaudioprocess: null }; return processor; }
        })
    ];
    const service = {
        startVoiceRecording: async () => ({ recordingId: 'take-1', relativePath: 'assets/afreco/test.wav' }),
        appendVoiceRecording: async request => { appended.push(request); },
        finishVoiceRecording: async request => {
            finished.push(request);
            return { assetPath: 'assets/afreco/test.wav', durationSec: 1, eventUri: 'file:///event.json' };
        }
    };
    return { service, appended, finished, events, storage, advance: ms => { now += ms; },
        tick: detail => listeners.get('akari.preview.playbackTick')?.({ detail }),
        get processor() { return processor; }, get gain() { return inputGain; },
        cleanup: () => restore.reverse().forEach(fn => fn()) };
}

test('monitor, device list, gain, append and finish event', async () => {
    const fake = setup();
    const states = [];
    const recorder = new VoiceRecorder(fake.service, state => states.push(state));
    try {
        await recorder.openMonitor();
        assert.equal(recorder.state.phase, 'monitoring');
        assert.deepEqual(recorder.state.devices, [{ deviceId: 'mic-1', label: 'USB マイク' }]);
        recorder.setGain(200);
        assert.equal(fake.gain.gain.value, 2);
        await recorder.start('file:///project');
        assert.equal(recorder.state.phase, 'recording');
        const data = new Float32Array(48000).fill(.5);
        fake.processor.onaudioprocess({ inputBuffer: { numberOfChannels: 1, getChannelData: () => data } });
        await recorder.stop();
        assert.equal(fake.appended.length, 1);
        assert.equal(fake.appended[0].recordingId, 'take-1');
        assert.ok(Buffer.from(fake.appended[0].pcmBase64, 'base64').length > 0);
        assert.deepEqual(fake.finished, [{ recordingId: 'take-1' }]);
        assert.equal(fake.events[0].type, 'akari.material.added');
        assert.deepEqual(fake.events[0].detail, { projectUri: 'file:///project', assetPath: 'assets/afreco/test.wav' });
        assert.equal(recorder.state.phase, 'monitoring');
    } finally {
        await recorder.dispose();
        fake.cleanup();
    }
});

test('sync recording seeks, plays, unmutes, and places one speech take with script and denoise', async () => {
    const fake = setup();
    const editUri = 'file:///tmp/project/edit.json';
    const previewUri = 'file:///private/tmp/project/edit.json';
    const order = [];
    const originalStart = fake.service.startVoiceRecording;
    const originalFinish = fake.service.finishVoiceRecording;
    fake.service.startVoiceRecording = async (...args) => { order.push('startVoiceRecording'); return originalStart(...args); };
    fake.service.finishVoiceRecording = async (...args) => { order.push('finishVoiceRecording'); return originalFinish(...args); };
    const calls = [];
    const commands = { executeCommand: async (name, args) => {
        order.push(name); calls.push([name, args]);
        return name === 'akari.timeline.addMaterialAtOutputPoint' ? 'audio-1' : 'seeked';
    } };
    const recorder = new VoiceRecorder(fake.service, () => undefined, commands);
    try {
        await recorder.openMonitor();
        recorder.attachTransport(editUri);
        recorder.setOption('denoise', true);
        recorder.setScript({ text: '読む文', captionId: 'c-0001', start: 12.5, end: 15 });
        await recorder.start('file:///project', editUri);
        assert.deepEqual(fake.events.slice(0, 3).map(event => [event.type, event.detail.muted]), [
            ['akari.timeline.setTrackVisibility', true], ['akari.timeline.setAudioMuted', true],
            ['akari.timeline.setLayersMuted', true]
        ]);
        assert.deepEqual(fake.events.slice(0, 3).map(event => event.detail.videoUri ?? event.detail.editUri),
            [editUri, editUri, editUri]);
        assert.deepEqual(order.slice(0, 3), ['akari.preview.seekOutput', 'startVoiceRecording', 'akari.preview.play']);
        assert.deepEqual(calls[0][1], { editUri, time: 12.5, waitForReady: true });
        fake.advance(250);
        fake.tick({ videoUri: previewUri, time: 12.6, playing: true });
        fake.tick({ videoUri: 'file:///elsewhere/edit.json', time: 50, playing: false });
        assert.equal(recorder.state.phase, 'recording');
        fake.tick({ videoUri: previewUri, time: 13, playing: false });
        await recorder.stop();
        assert.deepEqual(order.slice(3), ['akari.preview.pause', 'finishVoiceRecording', 'akari.timeline.addMaterialAtOutputPoint']);
        assert.deepEqual(calls.map(([, args]) => args.editUri), [editUri, editUri, editUri, editUri]);
        assert.deepEqual(fake.events.filter(event => event.detail?.muted === false).map(event => event.type), [
            'akari.timeline.setTrackVisibility', 'akari.timeline.setAudioMuted', 'akari.timeline.setLayersMuted'
        ]);
        assert.deepEqual(fake.events.filter(event => event.detail?.muted === false)
            .map(event => event.detail.videoUri ?? event.detail.editUri), [editUri, editUri, editUri]);
        const placed = calls.at(-1)[1];
        assert.equal(placed.t, 12.5);
        assert.equal(placed.voiceTrack, true);
        assert.equal(placed.audio.in, .25);
        assert.deepEqual(placed.audio.denoise, { method: 'nlm', strength: 1 });
        assert.equal(placed.audio.script, '読む文');
        assert.equal(placed.audio.captionRef, 'c-0001');
        assert.deepEqual(recorder.state.placed, { itemId: 'audio-1', t: 12.5 });
    } finally { await recorder.dispose(); fake.cleanup(); }
});

test('playing ticks stop a stalled preview after 1.0 seconds but keep recording while time advances', async () => {
    const fake = setup();
    const recorder = new VoiceRecorder(fake.service, () => undefined, { executeCommand: async name =>
        name === 'akari.timeline.addMaterialAtOutputPoint' ? 'audio-1' : 'seeked' });
    const stop = recorder.stop.bind(recorder);
    let stopCalls = 0;
    recorder.stop = async () => { stopCalls++; await stop(); };
    const tick = time => fake.tick({ videoUri: 'file:///project/edit.json', time, playing: true });
    try {
        await recorder.openMonitor();
        recorder.attachTransport('file:///project/edit.json');
        await recorder.start('file:///project', 'file:///project/edit.json');
        fake.advance(1200);
        tick(0); // 最初の playing tick が停滞監視の起点。開始待ちの 1.2 秒は数えない。
        assert.equal(stopCalls, 0);
        fake.advance(400);
        tick(.4);
        fake.advance(400);
        tick(.8);
        fake.advance(500);
        tick(1.3);
        assert.equal(stopCalls, 0);
        fake.advance(600);
        tick(1.3);
        assert.equal(stopCalls, 0);
        fake.advance(600);
        tick(1.3);
        assert.equal(stopCalls, 1);
        await stop();
        assert.equal(recorder.state.phase, 'monitoring');
        assert.deepEqual(fake.finished, [{ recordingId: 'take-1' }]);
    } finally { await recorder.dispose(); fake.cleanup(); }
});

test('sync OFF keeps v0 behavior and options are restored from localStorage', async () => {
    const fake = setup();
    const calls = [];
    try {
        const recorder = new VoiceRecorder(fake.service, () => undefined, { executeCommand: async name => calls.push(name) });
        recorder.setOption('sync', false);
        recorder.setOption('muteProject', false);
        recorder.setOption('denoise', true);
        const restored = new VoiceRecorder(fake.service, () => undefined);
        assert.deepEqual([restored.state.sync, restored.state.muteProject, restored.state.denoise], [false, false, true]);
        await recorder.openMonitor();
        await recorder.start('file:///project', 'file:///project/edit.json');
        await recorder.stop();
        assert.deepEqual(calls, []);
        assert.deepEqual(fake.events.map(event => event.type), ['akari.material.added']);
        await recorder.dispose();
        await restored.dispose();
    } finally { fake.cleanup(); }
});

test('pause failure still restores sound and saves a take without optional metadata', async () => {
    const fake = setup();
    const calls = [];
    const recorder = new VoiceRecorder(fake.service, () => undefined, { executeCommand: async (name, args) => {
        calls.push([name, args]);
        if (name === 'akari.preview.pause') throw new Error('preview closed');
        if (name === 'akari.timeline.addMaterialAtOutputPoint') return 'audio-2';
        return 'seeked';
    } });
    try {
        await recorder.openMonitor();
        await recorder.start('file:///project', 'file:///project/edit.json');
        await recorder.stop();
        assert.deepEqual(fake.finished, [{ recordingId: 'take-1' }]);
        assert.deepEqual(fake.events.filter(event => event.detail?.muted === false).map(event => event.type), [
            'akari.timeline.setTrackVisibility', 'akari.timeline.setAudioMuted', 'akari.timeline.setLayersMuted'
        ]);
        const audio = calls.find(([name]) => name === 'akari.timeline.addMaterialAtOutputPoint')[1].audio;
        assert.equal(audio.in, 0);
        assert.equal('denoise' in audio, false);
        assert.equal('script' in audio, false);
        assert.equal('captionRef' in audio, false);
        assert.deepEqual(recorder.state.placed, { itemId: 'audio-2', t: 0 });
    } finally { await recorder.dispose(); fake.cleanup(); }
});

test('placement failure preserves the WAV and explains the timeline failure', async () => {
    const fake = setup();
    const recorder = new VoiceRecorder(fake.service, () => undefined, { executeCommand: async name =>
        name === 'akari.timeline.addMaterialAtOutputPoint' ? undefined : 'seeked' });
    try {
        await recorder.openMonitor();
        await recorder.start('file:///project', 'file:///project/edit.json');
        await recorder.stop();
        assert.deepEqual(fake.finished, [{ recordingId: 'take-1' }]);
        assert.equal(recorder.state.lastSaved.assetPath, 'assets/afreco/test.wav');
        assert.match(recorder.state.placeError, /^素材には保存しました。タイムラインには置けませんでした:/);
        assert.equal(fake.events.at(-1).type, 'akari.material.added');
    } finally { await recorder.dispose(); fake.cleanup(); }
});

test('denied microphone permission reports the required error', async () => {
    const fake = setup(false);
    const recorder = new VoiceRecorder(fake.service, () => undefined);
    try {
        await recorder.openMonitor();
        assert.equal(recorder.state.phase, 'error');
        assert.match(recorder.state.error, /マイクの使用が許可されていません/);
    } finally {
        await recorder.dispose();
        fake.cleanup();
    }
});

test('closing while the recording RPC starts still finishes the take', async () => {
    const fake = setup();
    let releaseStart;
    fake.service.startVoiceRecording = () => new Promise(resolve => { releaseStart = resolve; });
    const recorder = new VoiceRecorder(fake.service, () => undefined);
    try {
        await recorder.openMonitor();
        const starting = recorder.start('file:///project');
        const disposing = recorder.dispose();
        releaseStart({ recordingId: 'take-1', relativePath: 'assets/afreco/test.wav' });
        await Promise.all([starting, disposing]);
        assert.deepEqual(fake.finished, [{ recordingId: 'take-1' }]);
        assert.equal(recorder.state.phase, 'idle');
    } finally {
        fake.cleanup();
    }
});
