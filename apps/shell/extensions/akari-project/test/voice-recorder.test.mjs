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
    const stream = { getTracks: () => [{ stop() {} }] };
    const devices = {
        getUserMedia: async () => stream,
        enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'mic-1', label: 'USB マイク' },
            { kind: 'videoinput', deviceId: 'camera', label: 'Camera' }]
    };
    const restore = [
        replaceGlobal('navigator', { mediaDevices: devices }),
        replaceGlobal('window', { electronAkariPreview: { askForMicrophoneAccess: async () => permission },
            dispatchEvent: event => { events.push(event); return true; } }),
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
    return { service, appended, finished, events, get processor() { return processor; }, get gain() { return inputGain; },
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
