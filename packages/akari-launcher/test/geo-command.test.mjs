import { after } from 'node:test';
import { setLanguage } from '../../i18n/index.mjs';

setLanguage('ja');
after(() => setLanguage(undefined));
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { GEO_CLI_RELATIVE } from '../src/repo-assets.mjs';
import { runGeoCommand } from '../src/geo-command.mjs';

test('akari geo: akari-tools geo.mjs へ引数と終了値を転送する', async (t) => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), 'akari-geo-launcher-'));
  t.after(() => import('node:fs/promises').then(({ rm }) => rm(repoRoot, { recursive: true, force: true })));
  const script = path.join(repoRoot, GEO_CLI_RELATIVE);
  await mkdir(path.dirname(script), { recursive: true });
  await writeFile(script, '');
  const calls = [];
  const result = await runGeoCommand(['terrain', '--bbox', '139,35,140,36', '--out', 'out'], {
    assets: { repoRoot },
    spawn: (...args) => { calls.push(args); return { status: 5 }; },
  });
  assert.equal(result.exitCode, 5);
  assert.deepEqual(calls[0], [
    process.execPath,
    [script, 'terrain', '--bbox', '139,35,140,36', '--out', 'out'],
    { stdio: 'inherit' },
  ]);
});

test('akari geo: スクリプト不在は既存 internal-command と同じ案内', async () => {
  const errors = [];
  const result = await runGeoCommand([], { assets: { repoRoot: '/not/a/repository' }, logError: (line) => errors.push(line) });
  assert.equal(result.exitCode, 1);
  assert.match(errors.join('\n'), /完全な checkout または配布物/);
});

test('akari --help: geo が一覧に出る', async () => {
  const result = spawnSync(process.execPath, [new URL('../bin/akari.mjs', import.meta.url).pathname, '--help'], {
    encoding: 'utf8',
    env: { ...process.env, AKARI_LANG: 'ja' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /geo terrain\s+国土地理院の標高・写真タイル/);
});
