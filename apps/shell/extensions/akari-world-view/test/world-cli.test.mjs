import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { WorldCliRunner } = require('../lib/node/world-cli.js');

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.exitCode = null;
  return child;
}

test('moveStop は launcher を所定の引数と環境で spawn し最後の JSON 行を読む', async () => {
  let call;
  const child = fakeChild();
  const runner = new WorldCliRunner({ env: { AKARI_WORLD_CLI: '/cli.mjs', KEEP: 'yes' }, spawnImpl: (...args) => { call = args; queueMicrotask(() => { child.stdout.write('note\n'); child.stdout.end('{"ok":true,"stopId":"a","before":[0,0,1],"after":[1,2,1],"changed":true}\n'); child.emit('close', 0); }); return child; } });
  const result = await runner.moveStop('/project', 'a', [1, 2, 1]);
  assert.equal(result.ok, true);
  assert.equal(call[0], process.execPath);
  assert.deepEqual(call[1], ['/cli.mjs', 'world', 'move-stop', '/project', '--stop', 'a', '--c', '1,2,1', '--json']);
  assert.equal(call[2].detached, false); assert.equal(call[2].env.ELECTRON_RUN_AS_NODE, '1'); assert.equal(call[2].env.KEEP, 'yes');
});

test('不正引数では spawn しない', async () => {
  let count = 0;
  const runner = new WorldCliRunner({ env: { AKARI_WORLD_CLI: '/cli.mjs' }, spawnImpl: () => { count += 1; return fakeChild(); } });
  assert.equal((await runner.moveStop('/p', '../bad', [1, 2])).code, 'ARG');
  assert.equal((await runner.moveStop('/p', 'ok', [1])).code, 'ARG');
  assert.equal(count, 0);
});

test('JSON 不正・spawn 失敗を結果へ包む', async () => {
  const child = fakeChild();
  const invalid = new WorldCliRunner({ env: { AKARI_WORLD_CLI: '/cli.mjs' }, spawnImpl: () => { queueMicrotask(() => { child.stdout.end('not-json\n'); child.emit('close', 1); }); return child; } });
  assert.equal((await invalid.moveStop('/p', 'a', [1, 2])).code, 'OUTPUT');
  const failed = new WorldCliRunner({ env: { AKARI_WORLD_CLI: '/cli.mjs' }, spawnImpl: () => { throw new Error('boom'); } });
  assert.equal((await failed.moveStop('/p', 'a', [1, 2])).code, 'SPAWN');
});

test('同じ stopId の多重実行を BUSY にする', async () => {
  const child = fakeChild();
  const runner = new WorldCliRunner({ env: { AKARI_WORLD_CLI: '/cli.mjs' }, spawnImpl: () => child });
  const first = runner.moveStop('/p', 'a', [1, 2]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await runner.moveStop('/p', 'a', [2, 3])).code, 'BUSY');
  child.stdout.end('{"ok":true}\n'); child.emit('close', 0);
  assert.equal((await first).ok, true);
});
