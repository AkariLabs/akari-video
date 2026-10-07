import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Emitter } = require('@theia/core/lib/common');
const { EarDockController } = require('../lib/browser/ear-dock-controller.js');
const { VibeDockState } = require('../lib/common/vibe-dock-state.js');

function controller(enabled, route) {
    const previous = globalThis.window;
    const window = new EventTarget();
    window.localStorage = { getItem: key => key === 'akari.vibePreview.enabled' && enabled ? '1' : null };
    globalThis.window = window;
    const changes = new Emitter();
    const utterances = new Emitter();
    const notes = [];
    const ear = { state: { state: 'listening', purpose: 'note', mic: 'ok' }, onDidChange: changes.event,
        onUtterance: utterances.event, flushPending() {}, setPaperOpen() {}, stop: async () => {} };
    const app = new EarDockController();
    Object.assign(app, { ear, dock: new VibeDockState({ getItem: () => null, setItem() {} }),
        now: { acceptUtterance: value => notes.push(value.text), clearPartial() {} }, router: { route } });
    app.onStart();
    return { app, utterances, notes, restore: () => { app.onStop(); globalThis.window = previous; } };
}

test('スイッチ off は fake EarSession の確定文を router に渡さない', async () => {
    let count = 0;
    const fixture = controller(false, async () => { count++; return { outcome: 'handled' }; });
    try {
        fixture.utterances.fire({ text: '動画だけ', final: true, kind: 'speech' });
        await new Promise(setImmediate);
        assert.equal(count, 0);
        assert.deepEqual(fixture.notes, []);
    } finally { fixture.restore(); }
});

test('on では到着順に直列化し、handled と memo を一度だけ分ける', async () => {
    const seen = [];
    let release;
    const first = new Promise(resolve => { release = resolve; });
    const fixture = controller(true, async value => {
        seen.push(value.text);
        if (value.text === '動画だけ') await first;
        return { outcome: value.text === '動画だけ' ? 'handled' : 'memo' };
    });
    try {
        fixture.utterances.fire({ text: '動画だけ', final: true, kind: 'speech' });
        fixture.utterances.fire({ text: '雑談', final: true, kind: 'speech' });
        await new Promise(setImmediate);
        assert.deepEqual(seen, ['動画だけ']);
        release();
        await new Promise(setImmediate);
        assert.deepEqual(seen, ['動画だけ', '雑談']);
        assert.deepEqual(fixture.notes, ['雑談']);
    } finally { fixture.restore(); }
});
