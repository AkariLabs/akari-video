import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

globalThis.Element ??= class { constructor() { this.classList = { add() {} }; this.style = {}; }
  matches() { return false; } };
globalThis.HTMLElement ??= globalThis.Element;
globalThis.MouseEvent ??= class extends Event {};
globalThis.DragEvent ??= class extends MouseEvent {};
globalThis.document ??= { createElement: () => new Element(), documentElement: { style: {} },
  body: new Element(), queryCommandSupported: () => false };
globalThis.window ??= Object.assign(new EventTarget(), { localStorage: { getItem: () => '1' } });
globalThis.window.navigator = { maxTouchPoints: 0 };
const require = createRequire(import.meta.url);
require.extensions['.css'] = () => {};
require('@theia/core/lib/browser/frontend-application-config-provider').FrontendApplicationConfigProvider.set({});
const { TaskifyClient, enqueueTaskify, taskifyRpcClient } = require('../lib/browser/taskify/taskify-client.js');

test('enqueue publishes queued immediately and backend RPC notifications reach the window', async () => {
  const previous = globalThis.window;
  const window = new EventTarget();
  window.localStorage = { getItem: () => '1' };
  globalThis.window = window;
  const events = [];
  window.addEventListener('akari.taskify.jobs', event => events.push(event.detail.jobs));
  let listed = [];
  let rerunArgs;
  const service = { enqueue: async () => ({ jobId: 'c-0001-r1' }), list: async () => listed,
    rerun: async (...args) => { rerunArgs = args; return { jobId: 'c-0001-r2' }; } };
  const client = new TaskifyClient();
  client.service = service;
  client.workspace = { tryGetRoots: () => [{ resource: { toString: () => 'file:///project' } }] };
  client.tasks = { update: async () => {} };
  try {
    client.onStart();
    await Promise.resolve();
    const queued = { jobId: 'c-0001-r1', memoId: 'c-0001', state: 'queued', revision: 1,
      projectRootUri: 'file:///project', agent: 'claude' };
    await enqueueTaskify({ projectRootUri: 'file:///project', memoId: 'c-0001', includeBackdrop: true }, 'claude');
    assert.equal(events.some(jobs => jobs.some(job => job.state === 'queued')), true);
    taskifyRpcClient.onJobsChanged([{ ...queued, state: 'running' }]);
    assert.equal(events.at(-1)[0].state, 'running');
    listed = [{ ...queued, state: 'done', resultCount: 2 }];
    await new Promise(resolve => setTimeout(resolve, 1100));
    assert.equal(events.at(-1)[0].state, 'done');
    listed = [{ ...queued, jobId: 'c-0001-r2', revision: 2, state: 'queued' }];
    window.dispatchEvent(new CustomEvent('akari.taskify.rerun', { detail: { memoId: 'c-0001', careful: true } }));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(rerunArgs, ['file:///project', 'c-0001', { careful: true }]);
    assert.equal(events.some(jobs => jobs.some(job => job.jobId === 'c-0001-r2' && job.state === 'queued')), true);
    listed = [{ ...queued, jobId: 'c-0001-r2', revision: 2, state: 'done', resultCount: 2 }];
    await new Promise(resolve => setTimeout(resolve, 1100));
    assert.equal(events.at(-1)[0].jobId, 'c-0001-r2');
  } finally { globalThis.window = previous; }
});
