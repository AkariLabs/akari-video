import assert from 'node:assert/strict';
import test from 'node:test';
import { ReviewSessionRecorder } from '../lib/browser/review-session-recorder.js';

const MICROPHONE_DENIED_MESSAGE = 'マイクの使用が許可されませんでした。設定で権限を確認してください。';

function replaceGlobal(name, value) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {
        configurable: true,
        writable: true,
        value
    });
    return () => {
        if (previous) {
            Object.defineProperty(globalThis, name, previous);
        } else {
            delete globalThis[name];
        }
    };
}

test('rejects denied microphone access before creating any session files', async () => {
    let backendStarts = 0;
    const service = {
        listReviewSessions: async () => [],
        startReviewSession: async () => {
            backendStarts += 1;
            throw new Error('must not be called');
        }
    };
    const states = [];
    const recorder = new ReviewSessionRecorder(service, state => states.push(state));
    const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: {
            mediaDevices: {
                getUserMedia: async () => {
                    throw new DOMException('denied', 'NotAllowedError');
                }
            }
        }
    });
    try {
        await recorder.start({
            projectRootUri: 'file:///project',
            editUri: 'file:///project/edit.json',
            timelineT: 0,
            playing: false
        }, {
            timelineT: 0,
            playing: false,
            rate: 1
        });
    } finally {
        if (previousNavigator) {
            Object.defineProperty(globalThis, 'navigator', previousNavigator);
        } else {
            delete globalThis.navigator;
        }
    }
    assert.equal(backendStarts, 0);
    assert.equal(states.at(-1).status, 'error');
    assert.equal(states.at(-1).active, false);
    assert.match(states.at(-1).error, /マイク/);
});

test('captures non-silent oscillator samples through the recorder audio path', async () => {
    const pcmChunks = [];
    const states = [];
    const intervalCallbacks = new Map();
    let processor;
    const service = {
        startReviewSession: async () => ({
            id: 's-0001',
            sessionDir: 'file:///project/review/sessions/s-0001',
            startedAt: '2026-07-24T00:00:00.000Z',
            editHash: 'sha256:test'
        }),
        appendReviewSessionAudio: async request => {
            pcmChunks.push(Buffer.from(request.pcmBase64, 'base64'));
        },
        appendReviewSessionEvent: async () => undefined,
        endReviewSession: async () => undefined,
        listReviewSessions: async () => []
    };
    const stream = {
        getTracks: () => [{ stop: () => undefined }]
    };
    class FakeAudioContext {
        constructor(options) {
            this.sampleRate = options.sampleRate;
            this.destination = {};
        }
        async resume() {}
        async close() {}
        createMediaStreamSource() {
            return {
                connect: () => undefined,
                disconnect: () => undefined
            };
        }
        createScriptProcessor() {
            processor = {
                onaudioprocess: null,
                connect: () => undefined,
                disconnect: () => undefined
            };
            return processor;
        }
        createGain() {
            return {
                gain: { value: 1 },
                connect: () => undefined,
                disconnect: () => undefined
            };
        }
    }
    let now = 1_000;
    const restoreNavigator = replaceGlobal('navigator', {
        mediaDevices: { getUserMedia: async () => stream }
    });
    const restoreWindow = replaceGlobal('window', {
        setInterval: (callback, interval) => {
            intervalCallbacks.set(interval, callback);
            return interval;
        },
        clearInterval: interval => intervalCallbacks.delete(interval)
    });
    const restoreAudioContext = replaceGlobal('AudioContext', FakeAudioContext);
    const restorePerformance = replaceGlobal('performance', { now: () => now });
    const restoreBtoa = replaceGlobal('btoa', value => Buffer.from(value, 'binary').toString('base64'));
    const recorder = new ReviewSessionRecorder(service, state => states.push(state));
    try {
        await recorder.start({
            projectRootUri: 'file:///project',
            editUri: 'file:///project/edit.json',
            timelineT: 0,
            playing: false
        }, {
            timelineT: 0,
            playing: false,
            rate: 1
        });
        assert.equal(typeof processor?.onaudioprocess, 'function');
        assert.equal(typeof intervalCallbacks.get(250), 'function');
        const samples = new Float32Array(4096);
        for (let index = 0; index < samples.length; index += 1) {
            samples[index] = Math.sin(2 * Math.PI * 440 * index / 16_000) * 0.5;
        }
        const audioEvent = channelData => ({
            inputBuffer: {
                length: channelData.length,
                numberOfChannels: 1,
                getChannelData: () => channelData
            }
        });
        now = 6_001;
        processor.onaudioprocess(audioEvent(new Float32Array(4096)));
        intervalCallbacks.get(250)();
        assert.equal(states.at(-1).silenceWarning, true);
        for (let index = 0; index < 4; index += 1) {
            now += 256;
            processor.onaudioprocess(audioEvent(samples));
            if (index === 0) {
                intervalCallbacks.get(250)();
                assert.ok(states.at(-1).level > 0);
                assert.equal(states.at(-1).silenceWarning, false);
            }
        }
        await recorder.stop();
    } finally {
        await recorder.dispose();
        restoreBtoa();
        restorePerformance();
        restoreAudioContext();
        restoreWindow();
        restoreNavigator();
    }
    assert.ok(pcmChunks.length > 0);
    let maxAmplitude = 0;
    for (const pcm of pcmChunks) {
        for (let offset = 0; offset < pcm.length; offset += 2) {
            maxAmplitude = Math.max(maxAmplitude, Math.abs(pcm.readInt16LE(offset)));
        }
    }
    assert.ok(maxAmplitude > 0);
});

test('routes a denied Electron TCC request through the existing microphone error path', async () => {
    let backendStarts = 0;
    let mediaRequests = 0;
    const service = {
        startReviewSession: async () => {
            backendStarts += 1;
            throw new Error('must not be called');
        }
    };
    const states = [];
    const restoreNavigator = replaceGlobal('navigator', {
        mediaDevices: {
            getUserMedia: async () => {
                mediaRequests += 1;
                throw new Error('must not be called');
            }
        }
    });
    const restoreWindow = replaceGlobal('window', {
        electronAkariPreview: {
            askForMicrophoneAccess: async () => false
        }
    });
    const recorder = new ReviewSessionRecorder(service, state => states.push(state));
    try {
        await recorder.start({
            projectRootUri: 'file:///project',
            editUri: 'file:///project/edit.json',
            timelineT: 0,
            playing: false
        }, {
            timelineT: 0,
            playing: false,
            rate: 1
        });
    } finally {
        restoreWindow();
        restoreNavigator();
    }
    assert.equal(mediaRequests, 0);
    assert.equal(backendStarts, 0);
    assert.equal(states.at(-1).status, 'error');
    assert.equal(states.at(-1).active, false);
    assert.equal(states.at(-1).error, MICROPHONE_DENIED_MESSAGE);
});
