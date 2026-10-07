import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { EarSession } = require('../lib/browser/ear-session.js');

function fixture({ engine = 'speechanalyzer-live', testInput = false } = {}) {
    const listeners = { status: [], level: [], utterance: [] };
    const calls = [];
    const subscribe = key => fn => {
        listeners[key].push(fn);
        return { dispose() { listeners[key] = listeners[key].filter(value => value !== fn); } };
    };
    const ear = {
        capabilities: async () => ({ engines: [{ id: engine, available: true }], ...(testInput ? { testInput: true } : {}) }),
        start: async options => { calls.push(['start', options]); return { state: 'listening', mic: 'ok', engine }; },
        stop: async () => { calls.push(['stop']); return { state: 'idle', mic: 'unknown' }; },
        onStatus: subscribe('status'), onLevel: subscribe('level'), onUtterance: subscribe('utterance')
    };
    const preferences = { inspect: () => ({ globalValue: engine }) };
    return { ear, preferences, listeners, calls };
}

test('二重開始は一度だけで、イベントを中継して止める', async () => {
    const data = fixture();
    const session = new EarSession(data.ear, data.preferences);
    const values = [];
    session.onUtterance(value => values.push(value.text));
    await session.start({ purpose: 'note' });
    await session.start({ purpose: 'note' });
    data.listeners.utterance[0]({ text: 'メモ', final: true });
    assert.deepEqual(values, ['メモ']);
    assert.equal(data.calls.filter(value => value[0] === 'start').length, 1);
    await session.stop();
    assert.equal(data.calls.filter(value => value[0] === 'stop').length, 1);
    session.dispose();
});

test('録音型は録音器を対で動かし、検証入力では開かない', async () => {
    const data = fixture({ engine: 'record-then-transcribe' });
    const session = new EarSession(data.ear, data.preferences);
    const recorder = [];
    session.createRecorder = () => ({ start: async () => recorder.push('start'), stop: async () => recorder.push('stop') });
    await session.start({ purpose: 'trial' });
    await session.stop();
    assert.deepEqual(recorder, ['start', 'stop']);
    session.dispose();

    const fake = fixture({ engine: 'record-then-transcribe', testInput: true });
    const fakeSession = new EarSession(fake.ear, fake.preferences);
    fakeSession.createRecorder = () => { throw new Error('マイクを開いてはいけません'); };
    await fakeSession.start({ purpose: 'note' });
    assert.equal(fakeSession.state.state, 'listening');
    await fakeSession.stop();
    fakeSession.dispose();
});

test('利用不可と異常終了は理由つき error になり、再開できる', async () => {
    const data = fixture();
    data.ear.capabilities = async () => ({ engines: [{ id: 'speechanalyzer-live', available: false, reason: 'この OS では使えません' }] });
    const session = new EarSession(data.ear, data.preferences);
    assert.match((await session.start({ purpose: 'note' })).message, /この OS/);
    data.ear.capabilities = async () => ({ engines: [{ id: 'speechanalyzer-live', available: true }] });
    await session.start({ purpose: 'note' });
    data.listeners.status[0]({ state: 'error', mic: 'unknown', message: 'ヘルパーが異常終了しました' });
    assert.equal(session.state.state, 'error');
    await session.start({ purpose: 'note' });
    assert.equal(session.state.state, 'listening');
    await session.stop();
    session.dispose();
});

test('起動中に終了しても開始完了後に必ず停止する', async () => {
    const data = fixture();
    let release;
    data.ear.start = options => { data.calls.push(['start', options]);
        return new Promise(resolve => { release = () => resolve({ state: 'listening', mic: 'ok', engine: 'speechanalyzer-live' }); }); };
    const session = new EarSession(data.ear, data.preferences);
    const starting = session.start({ purpose: 'note' });
    await new Promise(setImmediate);
    const stopping = session.stop();
    release();
    await Promise.all([starting, stopping]);
    assert.deepEqual(data.calls.map(value => value[0]), ['start', 'stop']);
    assert.equal(session.state.state, 'idle');
    session.dispose();
});
