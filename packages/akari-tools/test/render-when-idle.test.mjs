import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runRenderWhenIdle } from '../bin/render-when-idle.mjs';

function withProject(t) {
  const project = mkdtempSync(path.join(tmpdir(), 'akari-render-wait-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  const log = () => readFileSync(path.join(project, '.akari', 'work', 'render-wait.log'), 'utf8');
  return { project, log };
}

test('負荷が下がるまで待ってから render-cut を起動する', async (t) => {
  const { project, log } = withProject(t);
  const loads = [9, 2];
  const sleeps = [];
  const calls = [];
  const rc = await runRenderWhenIdle([project, '--max-load', '8', '--wait-minutes', '2'], {
    loadavg: () => [loads.shift()],
    sleep: async (ms) => sleeps.push(ms),
    renderCut: '/fake/render-cut.mjs',
    spawn: (...args) => { calls.push(args); return { status: 0 }; }
  });
  assert.equal(rc, 0);
  assert.deepEqual(sleeps, [60000]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1], ['/fake/render-cut.mjs', project]);
  assert.match(log(), /load=9 threshold=8 ok=0/);
  assert.match(log(), /load=2 threshold=8 ok=1/);
  assert.match(log(), /starting render \(load=2\)/);
});

test('待機上限に達すると exit 1 と gave up を記録する', async (t) => {
  const { project, log } = withProject(t);
  let calls = 0;
  const rc = await runRenderWhenIdle([project, '--max-load', '1', '--wait-minutes', '1'], {
    loadavg: () => [9],
    sleep: async () => {},
    spawn: () => { calls += 1; return { status: 0 }; }
  });
  assert.equal(rc, 1);
  assert.equal(calls, 0);
  assert.match(log(), /gave up waiting/);
});

test('子プロセスの終了コードと timeout 環境変数を伝播する', async (t) => {
  const { project, log } = withProject(t);
  let childOptions;
  const rc = await runRenderWhenIdle([project, '--timeout-ms', '1234'], {
    loadavg: () => [0],
    renderCut: '/fake/render-cut.mjs',
    spawn: (_command, _args, options) => { childOptions = options; return { status: 17 }; }
  });
  assert.equal(rc, 17);
  assert.equal(childOptions.env.RENDER_CUT_CAPTURE_TIMEOUT_MS, '1234');
  assert.equal(childOptions.env.PATH, process.env.PATH);
  assert.match(log(), /render exited rc=17/);
});

test('--max-load の値が欠けた場合は usage エラーになる', async (t) => {
  const { project } = withProject(t);
  const errors = [];
  const rc = await runRenderWhenIdle([project, '--max-load'], {
    stderr: (message) => errors.push(message),
    spawn: () => { throw new Error('子を起動してはいけない'); }
  });
  assert.notEqual(rc, 0);
  assert.match(errors.join('\n'), /使い方/);
});

test('未知フラグと -- 以降の追加引数をそのまま渡す', async (t) => {
  const { project } = withProject(t);
  let childArgs;
  await runRenderWhenIdle([project, '--max-load', '8', '--unknown', 'a b', '--', '--max-load', 'literal'], {
    loadavg: () => [0],
    renderCut: '/fake/render-cut.mjs',
    spawn: (_command, args) => { childArgs = args; return { status: 0 }; }
  });
  assert.deepEqual(childArgs, ['/fake/render-cut.mjs', project, '--unknown', 'a b', '--max-load', 'literal']);
});

test('Windows では待機せず理由を stderr とログに記録する', async (t) => {
  const { project, log } = withProject(t);
  const errors = [];
  let calls = 0;
  const rc = await runRenderWhenIdle([project, '--wait-minutes', '0'], {
    platform: 'win32',
    stderr: (message) => errors.push(message),
    loadavg: () => { throw new Error('Windows では負荷を読まない'); },
    sleep: async () => { throw new Error('Windows では待機しない'); },
    spawn: () => { calls += 1; return { status: 0 }; }
  });
  assert.equal(rc, 0);
  assert.equal(calls, 1);
  assert.match(errors.join('\n'), /この OS では負荷を測れないため待機しません/);
  assert.match(log(), /この OS では負荷を測れないため待機しません/);
});
