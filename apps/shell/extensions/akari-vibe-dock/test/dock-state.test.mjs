import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { VibeDockState, LAYOUT_KEY, MARK_PRESENTATION, widthMode } = require('../lib/common/vibe-dock-state.js');

function memoryStorage(initial = null) {
    let value = initial;
    return { getItem: () => value, setItem: (key, next) => { assert.equal(key, LAYOUT_KEY); value = next; }, value: () => value };
}

test('閉じが既定・通常だけ保存・広げた状態は復元しない', () => {
    const storage = memoryStorage();
    const state = new VibeDockState(storage);
    assert.equal(state.layout, 'closed');
    state.pressMark();
    assert.equal(state.layout, 'open');
    state.setUserHeight(225);
    assert.equal(new VibeDockState(storage).userHeight, 225);
    state.setLayout('expanded');
    assert.equal(new VibeDockState(storage).layout, 'open');
    state.setLayout('closed');
    assert.equal(new VibeDockState(storage).layout, 'closed');
    state.setLayout('expanded');
    assert.equal(new VibeDockState(storage).layout, 'open');
    assert.equal(new VibeDockState(memoryStorage('{')).layout, 'closed');
    assert.equal(new VibeDockState({ getItem: () => { throw Error('denied'); }, setItem: () => { throw Error('denied'); } }).layout, 'closed');
});

test('状況行はエラー、書き手、同順位の順に選び、解除で戻る', () => {
    const state = new VibeDockState(memoryStorage());
    const ear = state.status.set('耳', 'info', 'ear');
    const job = state.status.set('ジョブ', 'info', 'job');
    const auto = state.status.set('自動', 'info', 'auto');
    const jev = state.status.set('Jev', 'info', 'jev');
    assert.equal(state.currentStatus().line, 'Jev');
    const jev2 = state.status.set('Jev 2', 'info', 'jev');
    assert.equal(state.currentStatus().line, 'Jev 2');
    const error = state.status.set('失敗', 'error', 'ear');
    assert.equal(state.currentStatus().line, '失敗');
    error.dispose();
    jev2.dispose();
    assert.equal(state.currentStatus().line, 'Jev');
    jev.dispose(); auto.dispose(); job.dispose();
    assert.equal(state.currentStatus().line, '耳');
    ear.dispose();
    assert.equal(state.currentStatus(), undefined);
});

test('ジョブは同じ ID で更新し、停止理由と操作を優先する', () => {
    const state = new VibeDockState(memoryStorage());
    state.jobReporter.report({ id: 'a', state: 'running', label: 'A' });
    state.jobReporter.report({ id: 'b', state: 'running', label: 'B' });
    state.jobReporter.report({ id: 'c', state: 'queued', label: 'C' });
    assert.equal(state.currentStatus().line, '2 件進めています・1 件待ち');
    const ear = state.status.set('耳の状況', 'info', 'ear');
    assert.equal(state.currentStatus().source, 'job');
    const auto = state.status.set('自動の状況', 'info', 'auto');
    assert.equal(state.currentStatus().line, '自動の状況');
    auto.dispose();
    ear.dispose();
    const action = { label: '再試行', run() {} };
    state.jobReporter.report({ id: 'b', state: 'blocked', label: 'B', reason: '確認待ち', action });
    assert.equal(state.currentStatus().line, 'B・確認待ち');
    assert.equal(state.currentStatus().action, action);
    state.jobReporter.report({ id: 'b', state: 'failed', label: 'B', reason: '失敗' });
    assert.equal(state.currentStatus().tone, 'error');
});

test('三状態の形・文・ツールチップと幅境界', () => {
    for (const key of ['shape', 'line', 'tooltip']) {
        assert.equal(new Set(Object.values(MARK_PRESENTATION).map(value => value[key])).size, 3);
    }
    assert.deepEqual([239, 240, 319, 320].map(widthMode), ['tiny', 'compact', 'compact', 'full']);
});
