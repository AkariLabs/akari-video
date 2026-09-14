import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runWorldCommand } from '../src/world-command.mjs';

test('akari world: akari-tools world.mjs へ引数と終了値を転送する', async (t) => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), 'akari-world-launcher-'));
  t.after(() => import('node:fs/promises').then(({ rm }) => rm(repoRoot, { recursive: true, force: true })));
  const script = path.join(repoRoot, 'packages', 'akari-tools', 'bin', 'world.mjs');
  await mkdir(path.dirname(script), { recursive: true });
  await writeFile(script, '');
  const calls = [];
  const result = await runWorldCommand(['preview', 'project', '--measure'], { assets: { repoRoot }, spawn: (...args) => { calls.push(args); return { status: 7 }; } });
  assert.equal(result.exitCode, 7);
  assert.deepEqual(calls[0], [process.execPath, [script, 'preview', 'project', '--measure'], { stdio: 'inherit' }]);
});

test('akari world: スクリプト不在は既存 internal-command と同じ案内', async () => {
  const errors = [];
  const result = await runWorldCommand([], { assets: { repoRoot: '/not/a/repository' }, logError: (line) => errors.push(line) });
  assert.equal(result.exitCode, 1);
  assert.match(errors.join('\n'), /完全な checkout または配布物/);
});

test('akari --help: world が一覧に出る', async () => {
  const result = spawnSync(process.execPath, [new URL('../bin/akari.mjs', import.meta.url).pathname, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /world\s+ワールド地図/);
});
