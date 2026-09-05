import assert from 'node:assert/strict';
import test from 'node:test';
import { measureBlock, linearToDbfs, holdPeak, latchClip, meterFraction, isAudioMeterFrame } from '../lib/common/audio-meter-model.js';

const closeTo = (actual, expected, epsilon = 1e-6) =>
    assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);
const frame = () => ({ type: 'akari-preview-audio-meter', peak: [0.5, 1.2], rms: [0.3, 0.8], clip: true,
    playing: true, channels: 2, engine: 'frame-engine', t: 12.5 });

test('silence and empty blocks have zero peak and RMS', () => {
    assert.deepEqual(measureBlock(new Float32Array(2048)), { peak: 0, rms: 0 });
    assert.deepEqual(measureBlock(new Float32Array()), { peak: 0, rms: 0 });
    assert.equal(linearToDbfs(0), -Infinity);
});
test('full scale bipolar square wave has 0 dBFS peak and RMS', () => {
    const measured = measureBlock(Float32Array.from([1, -1, 1, -1]));
    assert.deepEqual(measured, { peak: 1, rms: 1 });
    assert.equal(linearToDbfs(measured.rms), 0);
});
test('-6 dBFS sine has approximately -9.01 dBFS RMS', () => {
    const samples = Float32Array.from({ length: 2048 }, (_, i) => 10 ** (-6 / 20) * Math.sin(2 * Math.PI * i / 64));
    const measured = measureBlock(samples);
    closeTo(linearToDbfs(measured.peak), -6);
    closeTo(linearToDbfs(measured.rms), -9.0102999566);
});
test('overload amplitudes are preserved and nonfinite samples are ignored', () => {
    assert.deepEqual(measureBlock(Float32Array.from([2, -2])), { peak: 2, rms: 2 });
    assert.deepEqual(measureBlock(Float32Array.from([NaN, Infinity])), { peak: 0, rms: 0 });
});
test('peak holds for 1500 ms then decays 20 dB per second', () => {
    const initial = holdPeak(null, 1, 100);
    assert.deepEqual(holdPeak(initial, 0, 1600), initial);
    const decayed = holdPeak(initial, 0, 2100);
    closeTo(linearToDbfs(decayed.value), -10);
    closeTo(linearToDbfs(holdPeak(decayed, 0, 2600).value), -20);
});
test('peak refreshes on a higher input and catches a new peak during decay', () => {
    assert.deepEqual(holdPeak({ value: 0.5, heldAt: 0 }, 1, 100), { value: 1, heldAt: 100 });
    assert.deepEqual(holdPeak({ value: 1, heldAt: 0 }, 0.5, 2500), { value: 0.5, heldAt: 2500 });
});
test('clip latch holds until the caller resets it', () => {
    assert.equal(latchClip(false, -0.11), false);
    assert.equal(latchClip(false, -0.1), true);
    assert.equal(latchClip(true, -Infinity), true);
    assert.equal(latchClip(false, -Infinity), false);
});
test('meter fractions clamp the floor and overload and support another floor', () => {
    for (const db of [-Infinity, -80, -60, NaN]) assert.equal(meterFraction(db), 0);
    assert.equal(meterFraction(-30), 0.5);
    assert.equal(meterFraction(-24, -48), 0.5);
    assert.equal(meterFraction(0), 1);
    assert.equal(meterFraction(6), 1);
});
test('frame guard accepts stereo overload and silent mono legacy', () => {
    assert.equal(isAudioMeterFrame(frame()), true);
    assert.equal(isAudioMeterFrame({ ...frame(), peak: [0, 0], rms: [0, 0], playing: false, clip: false, channels: 1, engine: 'legacy' }), true);
});
test('frame guard rejects malformed messages and amplitudes', () => {
    for (const value of [null, [], {}, { ...frame(), type: 'other' }, { ...frame(), peak: [0] },
        { ...frame(), peak: [0, 0, 0] }, { ...frame(), peak: [NaN, 0] }, { ...frame(), rms: [-1, 0] },
        { ...frame(), rms: [Infinity, 0] }, { ...frame(), rms: ['0', 0] },
        { ...frame(), peak: new Array(2) }, { ...frame(), channels: 3 }, { ...frame(), engine: 'unknown' },
        { ...frame(), playing: 1 }, { ...frame(), clip: 'true' }, { ...frame(), t: -1 }, { ...frame(), t: Infinity }]) {
        assert.equal(isAudioMeterFrame(value), false, JSON.stringify(value));
    }
});

// Exercise the actual injected metering bridge without loading Theia or a browser.
async function meterBridge() {
    const { readFileSync } = await import('node:fs');
    const { runInNewContext } = await import('node:vm');
    const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
    let script = source.slice(source.indexOf('            const measureAudioMeterBlock ='),
        source.indexOf('            window.akari.playbackTick ='));
    for (const [name, fn] of Object.entries({ measureBlock, linearToDbfs, latchClip })) {
        script = script.replace('${' + name + '.toString()}', fn.toString());
    }
    const frames = [];
    let now = 0;
    const window = { akari: {}, addEventListener() {} };
    runInNewContext(script, { window, Float32Array, performance: { now: () => now },
        initial: { frameEngineEnabled: true }, vscode: { postMessage: f => frames.push(JSON.parse(JSON.stringify(f))) } });
    function tap(channels = 2, samples = [0.5, 0.25]) {
        const nodes = [];
        const context = { state: 'running',
            createChannelSplitter: () => node(),
            createAnalyser: () => {
                const channel = nodes.length - 1;
                const analyser = node();
                analyser.getFloatTimeDomainData = data => data.fill(samples[channel]);
                return analyser;
            }
        };
        function node() {
            const result = { connections: [], connect(target, output = 0) { this.connections.push([target, output]); },
                disconnect(target) { this.connections = target ? this.connections.filter(([n]) => n !== target) : []; } };
            nodes.push(result);
            return result;
        }
        const master = { context, channelCount: channels, connections: ['audible-destination'],
            connect(target) { this.connections.push(target); },
            disconnect(target) { this.connections = this.connections.filter(n => n !== target); } };
        return { master, nodes };
    }
    return { ...window.akari, api: window.akari, frames, tap, at: value => { now = value; } };
}

test('meter taps split L/R without connecting their outputs or detaching the audible destination', async () => {
    const bridge = await meterBridge();
    const first = bridge.tap();
    bridge.attachAudioMeter(first.master, 'frame-engine');
    assert.equal(first.nodes[1].fftSize, 2048);
    assert.equal(first.nodes[2].fftSize, 2048);
    assert.equal(first.nodes[0].connections.length, 2);
    assert.equal(first.nodes[1].connections.length, 0);
    assert.equal(first.nodes[2].connections.length, 0);
    const second = bridge.tap();
    bridge.attachAudioMeter(second.master, 'frame-engine');
    assert.deepEqual(first.master.connections, ['audible-destination']);
    assert.equal(first.nodes[0].connections.length, 0);
    bridge.attachAudioMeter(null, 'frame-engine');
    assert.deepEqual(second.master.connections, ['audible-destination']);
});
test('meter bridge throttles playing frames, sends a single stop frame and stays idle', async () => {
    const bridge = await meterBridge();
    bridge.attachAudioMeter(bridge.tap().master, 'frame-engine');
    for (const now of [0, 16, 32, 33, 49, 66]) {
        bridge.at(now);
        bridge.audioMeterTick(now / 1000, true);
    }
    assert.equal(bridge.frames.length, 3);
    assert.deepEqual(bridge.frames[0].peak, [0.5, 0.25]);
    bridge.audioMeterTick(0.066, false, true);
    bridge.at(100);
    bridge.audioMeterTick(0.066, false, true);
    bridge.at(500);
    bridge.audioMeterTick(0.066, false);
    assert.equal(bridge.frames.length, 4);
    assert.deepEqual(bridge.frames.at(-1).peak, [0, 0]);
    assert.equal(bridge.frames.at(-1).playing, false);
    assert.ok(bridge.frames.every(isAudioMeterFrame));
});
test('mono metering duplicates L into R and emits the engine and overload flag', async () => {
    const bridge = await meterBridge();
    bridge.attachAudioMeter(bridge.tap(1, [1.1, 0]).master, 'legacy');
    bridge.audioMeterTick(0, true);
    const frame = bridge.frames[0];
    assert.equal(frame.channels, 1);
    assert.equal(frame.engine, 'legacy');
    assert.equal(frame.peak[0], frame.peak[1]);
    assert.equal(frame.rms[0], frame.rms[1]);
    assert.equal(frame.clip, true);
});
test('seek flushes a zero frame and playback resumes after the throttle interval', async () => {
    const bridge = await meterBridge();
    bridge.attachAudioMeter(bridge.tap().master, 'frame-engine');
    bridge.audioMeterTick(0, true);
    bridge.at(10);
    bridge.audioMeterTick(4, true, true);
    assert.equal(bridge.frames.at(-1).playing, false);
    assert.deepEqual(bridge.frames.at(-1).rms, [0, 0]);
    bridge.at(43);
    bridge.audioMeterTick(4.033, true);
    assert.equal(bridge.frames.at(-1).playing, true);
    assert.deepEqual(bridge.frames.at(-1).rms, [0.5, 0.25]);
});


test('frame-engine end sends one zero even when the outer playback flag has not caught up', async () => {
    const bridge = await meterBridge();
    bridge.api.frameEngineClock = { totalDuration: 1 };
    bridge.attachAudioMeter(bridge.tap().master, 'frame-engine');
    bridge.audioMeterTick(0.9, true);
    bridge.at(100);
    bridge.audioMeterTick(1, true);
    bridge.at(200);
    bridge.audioMeterTick(1, true);
    assert.equal(bridge.frames.length, 2);
    assert.equal(bridge.frames.at(-1).playing, false);
    assert.deepEqual(bridge.frames.at(-1).peak, [0, 0]);
});
