import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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

test('overview は CLI の JSON 出力から生成 HTML を読む', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'akari-world-overview-'));
  const output = join(dir, 'overview.html'); await writeFile(output, '<h1>atlas</h1>');
  let call; const child = fakeChild();
  const runner = new WorldCliRunner({ env: { AKARI_WORLD_CLI: '/cli.mjs' }, spawnImpl: (...args) => { call = args; queueMicrotask(() => { child.stdout.end(JSON.stringify({ output, fallback: false, atlas: true }) + '\n'); child.emit('close', 0); }); return child; } });
  const result = await runner.overview('/project');
  assert.equal(result.html, '<h1>atlas</h1>'); assert.equal(result.atlas, true);
  assert.deepEqual(call[1], ['/cli.mjs', 'world', 'overview', '/project', '--json']);
  assert.equal(call[2].env.ELECTRON_RUN_AS_NODE, '1'); assert.equal(call[2].detached, false);
});

test('overview は空 stdout のとき stderr を error にする', async () => {
  const child = fakeChild();
  const runner = new WorldCliRunner({ env: { AKARI_WORLD_CLI: '/cli.mjs' }, spawnImpl: () => { queueMicrotask(() => { child.stderr.end('specific failure'); child.stdout.end(); child.emit('close', 1); }); return child; } });
  assert.equal((await runner.overview('/p')).error, 'specific failure');
});

test('overview は壊れた JSON を error に包む', async () => {
  const child = fakeChild();
  const runner = new WorldCliRunner({ env: { AKARI_WORLD_CLI: '/cli.mjs' }, spawnImpl: () => { queueMicrotask(() => { child.stdout.end('not-json\n'); child.emit('close', 1); }); return child; } });
  assert.match((await runner.overview('/p')).error, /結果を解釈できません/);
});

test('overview は spawn 例外を error に包む', async () => {
  const runner = new WorldCliRunner({ env: { AKARI_WORLD_CLI: '/cli.mjs' }, spawnImpl: () => { throw new Error('boom'); } });
  assert.match((await runner.overview('/p')).error, /boom/);
});

test('overview は同じ root の同時生成を拒否する', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'akari-world-overview-busy-'));
  const output = join(dir, 'overview.html'); await writeFile(output, 'ok');
  const child = fakeChild();
  const runner = new WorldCliRunner({ env: { AKARI_WORLD_CLI: '/cli.mjs' }, spawnImpl: () => child });
  const first = runner.overview('/same'); await new Promise(resolve => setImmediate(resolve));
  assert.match((await runner.overview('/same')).error, /生成中/);
  child.stdout.end(`${JSON.stringify({ output })}\n`); child.emit('close', 0); await first;
});

test('overview は output が文字列でない JSON を拒否する', async () => {
  const child = fakeChild();
  const runner = new WorldCliRunner({ env: { AKARI_WORLD_CLI: '/cli.mjs' }, spawnImpl: () => { queueMicrotask(() => { child.stdout.end('{"output":42}\n'); child.emit('close', 0); }); return child; } });
  assert.match((await runner.overview('/p')).error, /output がありません/);
});

test('overview は生成ファイルを読めないとき error を返す', async () => {
  const child = fakeChild();
  const runner = new WorldCliRunner({ env: { AKARI_WORLD_CLI: '/cli.mjs' }, spawnImpl: () => { queueMicrotask(() => { child.stdout.end('{"output":"/missing/world-overview.html"}\n'); child.emit('close', 0); }); return child; } });
  assert.match((await runner.overview('/p')).error, /結果を解釈できません/);
});

test('overview は CLI が見つからないとき spawn しない', async () => {
  let spawns = 0;
  const runner = new WorldCliRunner({ env: {}, dirnameValue: '/definitely-missing/akari-world-view', spawnImpl: () => { spawns += 1; return fakeChild(); } });
  const result = await runner.overview('/p');
  assert.equal(spawns, 0); assert.match(result.error, /CLI が見つかりません/);
});
