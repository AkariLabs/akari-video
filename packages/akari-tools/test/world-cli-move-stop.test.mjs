import assert from 'node:assert/strict';
import test from 'node:test';
import { runWorldCommand } from '../bin/world.mjs';

test('move-stop は分離形と equals 形を解釈する', async () => {
  for (const args of [
    ['move-stop', '/tmp/project', '--stop', 'a', '--c', '1,2,1'],
    ['move-stop', '/tmp/project', '--stop=a', '--c=1,2,1']
  ]) {
    let called;
    const result = await runWorldCommand(args, { moveStop: async (project, options) => (called = { project, options }, { ok: true, stopId: 'a', before: [0, 0, 1], after: options.c, changed: true }), log: () => {} });
    assert.equal(result.exitCode, 0); assert.equal(called.options.stopId, 'a'); assert.deepEqual(called.options.c, [1, 2, 1]);
  }
});

test('move-stop の未知フラグ・不足・余分な positional は exit 2', async () => {
  for (const args of [
    ['move-stop', '.', '--wat'], ['move-stop', '.', '--stop', 'a'], ['move-stop', '.', 'extra', '--stop=a', '--c=1,2'],
    ['move-stop', '--stop=a', '--c=1,,2'], ['move-stop', '--stop=a', '--c=NaN,2']
  ]) assert.equal((await runWorldCommand(args, { log: () => {}, logError: () => {} })).exitCode, 2);
});

test('--json は成功・失敗結果を stdout に 1 行で返す', async () => {
  for (const value of [{ ok: true, stopId: 'a', before: [0, 0, 1], after: [1, 2, 1], changed: true }, { ok: false, code: 'BOUNDS', reason: 'outside' }]) {
    const lines = [];
    const result = await runWorldCommand(['move-stop', '--stop=a', '--c=1,2,1', '--json'], { moveStop: async () => value, log: line => lines.push(line), logError: () => {} });
    assert.equal(result.exitCode, value.ok ? 0 : 1); assert.deepEqual(JSON.parse(lines[0]), value);
  }
});
