import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Emitter } = require('@theia/core/lib/common');
const { VibeDockState } = require('../lib/common/vibe-dock-state.js');
const { EarDockController } = require('../lib/browser/ear-dock-controller.js');

function setup(enabled) {
    const previous = globalThis.window;
    const target = new EventTarget();
    target.localStorage = { getItem: key => key === 'akari.vibePreview.enabled' && enabled ? '1' : null };
    globalThis.window = target;
    const changes = new Emitter();
    const utterances = new Emitter();
    const calls = [];
    const ear = {
        state: { state: 'idle', mic: 'unknown' },
        onDidChange: changes.event, onUtterance: utterances.event,
        flushPending() {},
        setPaperOpen() {},
        start: async options => { calls.push(['start', options]); ear.state = { state: 'listening', mic: 'ok', engine: 'speechanalyzer-live', purpose: options.purpose };
            changes.fire(ear.state); return ear.state; },
        stop: async () => { calls.push(['stop']); ear.state = { state: 'idle', mic: 'unknown' };
            changes.fire(ear.state); return ear.state; }
    };
    const dock = new VibeDockState({ getItem: () => null, setItem() {} });
    const notes = [];
    const now = { clearCount: 0, acceptUtterance: (...args) => notes.push(args), clearPartial() { this.clearCount++; } };
    const controller = new EarDockController();
    Object.assign(controller, { ear, dock, now });
    const restore = () => { controller.onStop(); globalThis.window = previous; };
    return { target, controller, ear, dock, changes, utterances, calls, notes, now, restore };
}

const tick = () => new Promise(setImmediate);
const emit = (target, name, detail) => {
    const event = new Event(name);
    Object.defineProperty(event, 'detail', { value: detail });
    target.dispatchEvent(event);
};

test('スイッチ off では押しても耳を起動しない', async () => {
    const data = setup(false);
    try {
        data.controller.onStart();
        data.dock.pressMark();
        await tick();
        assert.deepEqual(data.calls, []);
    } finally { data.restore(); }
});

test('明かりで開始・停止し、紙の間と command は札にしない', async () => {
    const data = setup(true);
    try {
        data.controller.onStart();
        data.dock.pressMark();
        await tick();
        assert.deepEqual(data.calls[0], ['start', { purpose: 'note' }]);
        assert.equal(data.dock.mark, 'listening');
        emit(data.target, 'akari.preview.playbackTick', { time: 12.5 });
        data.utterances.fire({ kind: 'speech', text: '前', final: true });
        assert.equal(data.notes[0][1], 12.5);
        emit(data.target, 'akari.sketch.opened', { key: 'paper', at: 10 });
        data.utterances.fire({ kind: 'speech', text: '紙', final: true });
        emit(data.target, 'akari.sketch.closed', { key: 'paper', at: 11 });
        data.utterances.fire({ kind: 'speech', text: '閉じた直後', final: true });
        data.utterances.fire({ kind: 'command', text: '閉じて', final: true });
        assert.equal(data.notes.length, 1);
        emit(data.target, 'akari.sketch.earClosed', { key: 'paper' });
        data.utterances.fire({ kind: 'speech', text: '後', final: true });
        assert.equal(data.notes.length, 2);
        data.dock.pressMark();
        await tick();
        assert.equal(data.dock.mark, 'idle');
        assert.equal(data.dock.layout, 'open');
    } finally { data.restore(); }
});

test('区画破棄で耳を止める', async () => {
    const data = setup(true);
    try {
        data.controller.onStart();
        data.dock.pressMark();
        await tick();
        data.controller.onDockDisposed();
        await tick();
        assert.equal(data.calls.filter(call => call[0] === 'stop').length, 1);
    } finally { data.restore(); }
});

test('停止中・停止後・エラーで途中経過を消し、停止中の partial は戻さない', async () => {
    const data = setup(true);
    try {
        data.controller.onStart();
        data.dock.pressMark();
        await tick();
        data.utterances.fire({ kind: 'speech', text: '途中', final: false });
        assert.equal(data.notes.length, 1);
        data.ear.state = { state: 'stopping', mic: 'unknown', purpose: 'note' };
        data.changes.fire(data.ear.state);
        assert.equal(data.now.clearCount, 1);
        data.utterances.fire({ kind: 'speech', text: '遅い途中', final: false });
        assert.equal(data.notes.length, 1);
        data.ear.state = { state: 'idle', mic: 'unknown' };
        data.changes.fire(data.ear.state);
        assert.equal(data.now.clearCount, 2);
        data.ear.state = { state: 'error', mic: 'unknown', message: '耳が止まりました' };
        data.changes.fire(data.ear.state);
        assert.equal(data.now.clearCount, 3);
    } finally { data.restore(); }
});

test('error のあと idle が来ても理由が残り、次の押下で消える', async () => {
    const data = setup(true);
    try {
        data.controller.onStart();
        data.ear.state = { state: 'error', mic: 'unknown', message: '文字起こしに失敗しました' };
        data.changes.fire(data.ear.state);
        data.ear.state = { state: 'idle', mic: 'unknown' };
        data.changes.fire(data.ear.state);
        assert.equal(data.dock.unavailable, '文字起こしに失敗しました');
        assert.equal(data.dock.currentStatus()?.line, '文字起こしに失敗しました');
        assert.equal(data.dock.currentStatus()?.tone, 'error');
        data.dock.pressMark();
        await tick();
        assert.equal(data.dock.unavailable, undefined);
        assert.equal(data.dock.mark, 'listening');
        assert.equal(data.dock.currentStatus()?.line, '聞いています');
    } finally { data.restore(); }
});

test('紙を開く直前に残った文を「いま」へ確定してから行き先を切り替える', async () => {
    const data = setup(true);
    try {
        data.controller.onStart();
        data.dock.pressMark();
        await tick();
        data.ear.flushPending = () => data.utterances.fire({ kind: 'speech', raw: '紙の前', text: '紙の前', final: true });
        emit(data.target, 'akari.sketch.opened', { key: 'paper', at: 10 });
        assert.equal(data.notes.length, 1);
        assert.equal(data.notes[0][0].text, '紙の前');
        data.utterances.fire({ kind: 'speech', raw: '紙の中', text: '紙の中', final: true });
        assert.equal(data.notes.length, 1);
    } finally { data.restore(); }
});
