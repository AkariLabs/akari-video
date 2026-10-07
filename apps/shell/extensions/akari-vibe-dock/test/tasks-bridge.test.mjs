import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { NoteToTaskBridge } = require('../lib/browser/tasks-bridge-frontend-module.js');
const { NowVibeDockTab } = require('../lib/browser/vibe-dock-tabs.js');
const { VibeDockState } = require('../lib/common/vibe-dock-state.js');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('指した対象を ui: 付きで作成に渡し、作成後に消費する', async () => {
    const state = new VibeDockState({ getItem: () => null, setItem() {} });
    state.setPointed({ target: 'timeline:cut:1', label: 'C2', at: 1, source: 'preview' });
    const calls = [];
    const bridge = new NoteToTaskBridge();
    const now = new NowVibeDockTab();
    Object.assign(now, { state });
    Object.assign(bridge, { state, now, commands: { executeCommand: async (id, input) => {
        calls.push([id, input]);
        return id === 'akari.tasks.create' ? { id: 't-0001' } : { sent: ['t-0001'] };
    } }, messages: { info() {}, error: message => { throw new Error(message); } } });
    bridge.onStart();
    state.submitInstruction('文を直す', 'task');
    await tick();
    assert.deepEqual(calls[0], ['akari.tasks.create', { text: '文を直す', via: 'chat', target: 'ui:timeline:cut:1' }]);
    assert.equal(state.pointedTarget, undefined);
    assert.equal(state.currentStatus()?.line, 'タスクにしました。');
    state.submitInstruction('もう一つ', 'send');
    await tick();
    assert.deepEqual(calls.at(-1), ['akari.tasks.send', { ids: ['t-0001'] }]);
});
