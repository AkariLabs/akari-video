import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { RoughCanvasEarBridge } = require('../lib/browser/rough-canvas-ear-bridge.js');
const emit = (target, type, detail) => {
    const event = new Event(type);
    Object.defineProperty(event, 'detail', { value: detail });
    target.dispatchEvent(event);
};

test('紙の秒をミリ秒に直し、結果がある閉鎖だけ transcript を発火する', async () => {
    const previous = globalThis.window;
    const target = new EventTarget();
    target.localStorage = { getItem: () => '1' };
    globalThis.window = target;
    const calls = [];
    const received = [];
    target.addEventListener('akari.sketch.transcript', event => received.push(event.detail));
    const bridge = new RoughCanvasEarBridge();
    bridge.ear = {
        notifyRoughCanvas: async value => calls.push(value),
        takeTranscript: async key => key === 'one' ? { engine: 'speech-analyzer', locale: 'ja-JP', segments: [] } : undefined
    };
    try {
        bridge.onStart();
        emit(target, 'akari.sketch.opened', { key: 'one', at: 12 });
        emit(target, 'akari.sketch.closed', { key: 'one', at: 13 });
        emit(target, 'akari.sketch.closed', { key: 'two', at: 14 });
        await new Promise(setImmediate);
        assert.deepEqual(calls.map(value => value.at), [12000, 13000, 14000]);
        assert.equal(received.length, 1);
        assert.equal(received[0].key, 'one');
        bridge.onStop();
    } finally { globalThis.window = previous; }
});

test('スイッチ off で紙イベントを購読しない', () => {
    const previous = globalThis.window;
    const target = new EventTarget();
    target.localStorage = { getItem: () => null };
    globalThis.window = target;
    let calls = 0;
    const bridge = new RoughCanvasEarBridge();
    bridge.ear = { notifyRoughCanvas: () => { calls++; } };
    try {
        bridge.onStart();
        emit(target, 'akari.sketch.opened', { key: 'one', at: 12 });
        assert.equal(calls, 0);
    } finally { bridge.onStop(); globalThis.window = previous; }
});
