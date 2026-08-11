import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

test('beatmap: 必須引数が無ければ外部バイナリ起動前に usage を返す', () => {
  const script = join(packageRoot, 'bin', 'beatmap.mjs');
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /usage: beatmap\.mjs/);
});

test('probe-frame: 時刻が無ければ Chrome 起動前に usage を返す', () => {
  const script = join(packageRoot, 'bin', 'probe-frame.mjs');
  const result = spawnSync(process.execPath, [script, '.'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /usage: probe-frame\.mjs/);
});

test('finger-frame: project が無ければ usage を返す', () => {
  const script = join(packageRoot, 'bin', 'finger-frame.mjs');
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /usage: finger-frame\.mjs/);
});
