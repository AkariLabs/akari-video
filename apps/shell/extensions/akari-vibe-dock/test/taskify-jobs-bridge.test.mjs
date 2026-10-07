import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskifyJobsBridge, taskifyJobReason } from '../lib/browser/taskify-jobs-bridge.js';
import { VibeDockState } from '../lib/common/vibe-dock-state.js';

test('job event is reported, completed once, and removed', () => {
  const oldWindow = globalThis.window;
  const window = new EventTarget(); globalThis.window = window;
  const state = new VibeDockState({ getItem: () => null, setItem: () => {} });
  const bridge = new TaskifyJobsBridge();
  bridge.dock = state;
  try {
    bridge.onStart();
    const send = jobs => window.dispatchEvent(new CustomEvent('akari.taskify.jobs', { detail: { jobs } }));
    send([{ jobId: 'c-0001-r1', memoId: 'c-0001', state: 'queued' }]);
    assert.equal(state.currentStatus()?.line, '1 件待ち');
    send([{ jobId: 'c-0001-r1', memoId: 'c-0001', state: 'running' }]);
    assert.equal(state.currentStatus()?.line, '1 件進めています');
    send([{ jobId: 'c-0001-r1', memoId: 'c-0001', state: 'blocked', error: { code: 'login' } }]);
    assert.match(state.currentStatus()?.line, /ログイン/);
    send([{ jobId: 'c-0001-r1', memoId: 'c-0001', state: 'failed', error: { code: 'rate-limit' } }]);
    assert.match(state.currentStatus()?.line, /利用の上限に達しているようです/);
    send([{ jobId: 'c-0001-r1', memoId: 'c-0001', state: 'done', resultCount: 2 }]);
    send([{ jobId: 'c-0001-r1', memoId: 'c-0001', state: 'done', resultCount: 2 }]);
    assert.equal(state.currentStatus()?.line, 'タスク案が 2 件できました');
    assert.equal(state.statuses.size, 1);
  } finally { globalThis.window = oldWindow; }
});

test('each failure code has an actionable Japanese reason', () => {
  const reasons = {
    'rate-limit': '利用の上限に達しているようです。しばらくして再試行してください',
    'bad-json': 'AI の返事を読み取れませんでした', timeout: '時間内に終わりませんでした',
    schema: '内部の設定に問題があります', unknown: '案を作れませんでした'
  };
  for (const [code, expected] of Object.entries(reasons))
    assert.equal(taskifyJobReason({ jobId: 'j', memoId: 'c-0001', state: 'failed', error: { code } }), expected);
  assert.equal(taskifyJobReason({ jobId: 'j', memoId: 'c-0001', state: 'queued', waiting: 'offline' }), 'オフラインのため待っています');
});
