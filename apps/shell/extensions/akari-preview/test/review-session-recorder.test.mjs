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

test('records completed strokes on the session clock and discards a pending stroke when playback starts', async () => {
    const stored = [];
    let now = 1_000;
    const service = {
        appendReviewSessionStroke: async request => stored.push(request.stroke),
        appendReviewSessionEvent: async () => undefined
    };
    const restorePerformance = replaceGlobal('performance', { now: () => now });
    const recorder = new ReviewSessionRecorder(service, () => undefined);
    const active = {
        editUri: 'file:///project/edit.json',
        sessionDir: 'file:///project/review/sessions/s-0001',
        monotonicStartedAt: 1_000,
        lastRecT: 0,
        transport: { timelineT: 4, playing: false, rate: 1 },
        writeTail: Promise.resolve(),
        nextStrokeNumber: 1
    };
    recorder.active = active;
    try {
        now = 1_250;
        recorder.handleStrokeStart(active.editUri, { timelineT: 4, sourceT: 14, cutIndex: 0 });
        now = 1_750;
        recorder.handleStrokeEnd(active.editUri, [[0.1, 0.2], [0.8, 0.9]]);
        await active.writeTail;
        assert.equal(stored.length, 1);
        assert.equal(stored[0].id, 'st-0001');
        assert.equal(stored[0].recTStart, 0.25);
        assert.equal(stored[0].recTEnd, 0.75);

        recorder.handleStrokeStart(active.editUri, { timelineT: 4, sourceT: 14, cutIndex: 0 });
        recorder.handleTransport(active.editUri, { type: 'play', timelineT: 4 });
        recorder.handleStrokeEnd(active.editUri, [[0, 0], [1, 1]]);
        await active.writeTail;
        assert.equal(stored.length, 1);
    } finally {
        recorder.active = undefined;
        restorePerformance();
    }
});

// docs/contract-2026-08-11-review-session-ui-events.md #2/#5: the three required unit cases --
// registered element click -> expected shape / unregistered element -> nothing emitted /
// outside a session -> nothing emitted. handleUiClick is exercised directly (protected method,
// callable at the JS runtime level) the same way the stroke tests above call handleStrokeStart
// directly, so these don't need a real DOM.

test('registered element click emits the expected ui.click event while recording', async () => {
    const events = [];
    const service = { appendReviewSessionEvent: async request => events.push(request.event) };
    const restorePerformance = replaceGlobal('performance', { now: () => 2_000 });
    const recorder = new ReviewSessionRecorder(service, () => undefined);
    const active = {
        sessionDir: 'file:///project/review/sessions/s-0001',
        monotonicStartedAt: 1_000,
        lastRecT: 0,
        writeTail: Promise.resolve()
    };
    recorder.active = active;
    recorder.status = 'recording';
    try {
        const target = {
            getAttribute: name => ({
                'data-akari-ui': 'asset:assets/broll/city.mp4',
                'data-akari-ui-label': 'city.mp4'
            }[name] ?? null),
            parentNode: null
        };
        recorder.handleUiClick({ target });
        await active.writeTail;
        assert.deepEqual(events, [{
            recT: 1, type: 'ui.click', target: 'asset:assets/broll/city.mp4', label: 'city.mp4'
        }]);
    } finally {
        recorder.active = undefined;
        recorder.status = 'idle';
        restorePerformance();
    }
});

test('registered panel: / tab: targets emit ui.panel / ui.tab respectively', async () => {
    const events = [];
    const service = { appendReviewSessionEvent: async request => events.push(request.event) };
    const restorePerformance = replaceGlobal('performance', { now: () => 1_000 });
    const recorder = new ReviewSessionRecorder(service, () => undefined);
    const active = {
        sessionDir: 'file:///project/review/sessions/s-0001',
        monotonicStartedAt: 1_000,
        lastRecT: 0,
        writeTail: Promise.resolve()
    };
    recorder.active = active;
    recorder.status = 'recording';
    try {
        recorder.handleUiClick({
            target: { getAttribute: name => (name === 'data-akari-ui' ? 'panel:assets' : null), parentNode: null }
        });
        recorder.handleUiClick({
            target: { getAttribute: name => (name === 'data-akari-ui' ? 'tab:inspector-cut-0' : null), parentNode: null }
        });
        await active.writeTail;
        assert.equal(events.length, 2);
        assert.equal(events[0].type, 'ui.panel');
        assert.equal(events[0].target, 'panel:assets');
        assert.equal(events[1].type, 'ui.tab');
        assert.equal(events[1].target, 'tab:inspector-cut-0');
    } finally {
        recorder.active = undefined;
        recorder.status = 'idle';
        restorePerformance();
    }
});

test('unregistered element click emits nothing', async () => {
    const events = [];
    const service = { appendReviewSessionEvent: async request => events.push(request.event) };
    const recorder = new ReviewSessionRecorder(service, () => undefined);
    const active = {
        sessionDir: 'file:///project/review/sessions/s-0001',
        monotonicStartedAt: 0,
        lastRecT: 0,
        writeTail: Promise.resolve()
    };
    recorder.active = active;
    recorder.status = 'recording';
    try {
        recorder.handleUiClick({ target: { getAttribute: () => null, parentNode: null } });
        await active.writeTail;
        assert.equal(events.length, 0);
    } finally {
        recorder.active = undefined;
        recorder.status = 'idle';
    }
});

test('click outside a recording session emits nothing, even for a registered element', async () => {
    const events = [];
    const service = { appendReviewSessionEvent: async request => events.push(request.event) };
    const recorder = new ReviewSessionRecorder(service, () => undefined);
    const target = {
        getAttribute: name => (name === 'data-akari-ui' ? 'panel:assets' : null),
        parentNode: null
    };
    // No active session at all.
    recorder.handleUiClick({ target });
    assert.equal(events.length, 0);

    // Active session, but not yet/no-longer in the 'recording' status (e.g. starting/stopping).
    recorder.active = { sessionDir: 'file:///project/review/sessions/s-0001', monotonicStartedAt: 0, lastRecT: 0, writeTail: Promise.resolve() };
    recorder.status = 'stopping';
    try {
        recorder.handleUiClick({ target });
        assert.equal(events.length, 0);
    } finally {
        recorder.active = undefined;
        recorder.status = 'idle';
    }
});

test('installs a capture-phase click listener only while recording, and removes it on stop', async () => {
    const listeners = [];
    const restoreDocument = replaceGlobal('document', {
        addEventListener: (type, listener, capture) => {
            if (type === 'click') {
                listeners.push({ listener, capture });
            }
        },
        removeEventListener: (type, listener) => {
            if (type === 'click') {
                const index = listeners.findIndex(entry => entry.listener === listener);
                if (index >= 0) {
                    listeners.splice(index, 1);
                }
            }
        }
    });
    const service = {
        startReviewSession: async () => ({
            id: 's-0001',
            sessionDir: 'file:///project/review/sessions/s-0001',
            startedAt: '2026-08-11T00:00:00.000Z',
            editHash: 'sha256:test'
        }),
        appendReviewSessionEvent: async () => undefined,
        endReviewSession: async () => undefined,
        listReviewSessions: async () => []
    };
    const stream = { getTracks: () => [{ stop: () => undefined }] };
    class FakeAudioContext {
        constructor(options) {
            this.sampleRate = options.sampleRate;
            this.destination = {};
        }
        async resume() {}
        async close() {}
        createMediaStreamSource() {
            return { connect: () => undefined, disconnect: () => undefined };
        }
        createScriptProcessor() {
            return { onaudioprocess: null, connect: () => undefined, disconnect: () => undefined };
        }
        createGain() {
            return { gain: { value: 1 }, connect: () => undefined, disconnect: () => undefined };
        }
    }
    const restoreNavigator = replaceGlobal('navigator', { mediaDevices: { getUserMedia: async () => stream } });
    const restoreWindow = replaceGlobal('window', { setInterval: () => 1, clearInterval: () => undefined });
    const restoreAudioContext = replaceGlobal('AudioContext', FakeAudioContext);
    const restorePerformance = replaceGlobal('performance', { now: () => 1_000 });
    const recorder = new ReviewSessionRecorder(service, () => undefined);
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
        assert.equal(listeners.length, 1);
        assert.equal(listeners[0].capture, true);
        await recorder.stop();
        assert.equal(listeners.length, 0);
    } finally {
        await recorder.dispose();
        restorePerformance();
        restoreAudioContext();
        restoreWindow();
        restoreNavigator();
        restoreDocument();
    }
});
