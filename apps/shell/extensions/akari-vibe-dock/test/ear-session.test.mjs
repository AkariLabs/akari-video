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
        start: async options => { calls.push(['start', options]); return { state: 'listening', mic: 'ok', engine, purpose: options.purpose }; },
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
    data.listeners.utterance[0]({ id: 'one', raw: 'メモ', text: 'メモ', applied: [], final: true, t: 0 });
    assert.deepEqual(values, ['メモ']);
    assert.equal(data.calls.filter(value => value[0] === 'start').length, 1);
    await session.stop();
    assert.equal(data.calls.filter(value => value[0] === 'stop').length, 1);
    session.dispose();
});

const partial = (raw, text = raw, applied = []) => ({ id: 'one', raw, text, applied, final: false, t: 0, kind: 'speech' });

test('final がないまま止めると辞書適用済みの途中経過を 1 件だけ確定する', async () => {
    const data = fixture();
    const session = new EarSession(data.ear, data.preferences);
    const finals = [];
    session.onUtterance(value => { if (value.final) finals.push(value); });
    await session.start({ purpose: 'note' });
    data.listeners.utterance[0](partial('入れて', '追加して', [
        { id: 'word-1', from: '入れて', to: '追加して', layer: 'user', range: [0, 4] }
    ]));
    await session.stop();
    assert.equal(finals.length, 1);
    assert.equal(finals[0].raw, '入れて');
    assert.equal(finals[0].text, '追加して');
    assert.equal(finals[0].applied[0].id, 'word-1');
    session.dispose();
});

test('停止直後に同じ文の final が来ても 1 件だけになる', async () => {
    const data = fixture();
    const session = new EarSession(data.ear, data.preferences);
    const finals = [];
    session.onUtterance(value => { if (value.final) finals.push(value); });
    await session.start({ purpose: 'note' });
    data.listeners.utterance[0](partial('同じ文です。'));
    data.ear.stop = async () => {
        data.listeners.utterance[0]({ ...partial('同じ文です。'), final: true });
        return { state: 'idle', mic: 'unknown' };
    };
    await session.stop();
    assert.deepEqual(finals.map(value => value.text), ['同じ文です。']);
    session.dispose();
});

test('句点つき途中経過が 2 秒更新されなければ句点までを確定し、残りを保持する', async () => {
    const data = fixture();
    const session = new EarSession(data.ear, data.preferences);
    const values = [];
    session.onUtterance(value => values.push(value));
    await session.start({ purpose: 'note' });
    data.listeners.utterance[0](partial('最初の文です。残りの途中'));
    await new Promise(resolve => setTimeout(resolve, 2150));
    assert.deepEqual(values.slice(-2).map(value => [value.text, value.final]),
        [['最初の文です。', true], ['残りの途中', false]]);
    assert.equal(session.pendingUtterance.raw, '残りの途中');
    data.listeners.utterance[0]({ ...partial('最初の文です。残りの途中'), final: true });
    assert.deepEqual(values.filter(value => value.final).map(value => value.text), ['最初の文です。', '残りの途中']);
    await session.stop();
    session.dispose();
});

test('空の途中経過で止めても確定文を作らない', async () => {
    const data = fixture();
    const session = new EarSession(data.ear, data.preferences);
    const finals = [];
    session.onUtterance(value => { if (value.final) finals.push(value); });
    await session.start({ purpose: 'note' });
    data.listeners.utterance[0](partial(''));
    await session.stop();
    assert.equal(finals.length, 0);
    session.dispose();
});

test('エラー通知の前に残った途中経過を確定する', async () => {
    const data = fixture();
    const session = new EarSession(data.ear, data.preferences);
    const order = [];
    session.onUtterance(value => { if (value.final) order.push('final'); });
    session.onDidChange(value => { if (value.state === 'error') order.push('error'); });
    await session.start({ purpose: 'note' });
    data.listeners.utterance[0](partial('残った文'));
    data.listeners.status[0]({ state: 'error', mic: 'unknown', purpose: 'note', message: '耳が止まりました' });
    assert.deepEqual(order, ['final', 'error']);
    await session.stop();
    session.dispose();
});

test('紙が開いている間の途中経過は「いま」の確定文にしない', async () => {
    const data = fixture();
    const session = new EarSession(data.ear, data.preferences);
    const finals = [];
    session.onUtterance(value => { if (value.final) finals.push(value); });
    await session.start({ purpose: 'note' });
    session.setPaperOpen(true);
    data.listeners.utterance[0](partial('紙の途中です。'));
    await session.stop();
    assert.equal(finals.length, 0);
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
