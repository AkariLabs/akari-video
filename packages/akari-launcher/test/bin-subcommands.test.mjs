import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { readOwnVersion } from '../src/update-check.mjs';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const bin = join(packageRoot, 'bin', 'akari.mjs');

test('bin/akari.mjs: --version は1行目の CLI 版を維持し、本体版とずれを追加行で表示する', async () => {
  const akariHome = await mkdtemp(join(tmpdir(), 'akari-version-command-'));
  try {
    await mkdir(join(akariHome, 'app'), { recursive: true });
    await writeFile(join(akariHome, 'app', '.akari-install-ref'), 'v0.1.11\n', 'utf8');
    const result = spawnSync(process.execPath, [bin, '--version'], {
      encoding: 'utf8',
      env: { ...process.env, AKARI_HOME: akariHome }
    });
    assert.equal(result.status, 0, result.stderr);
    const lines = result.stdout.trim().split('\n');
    assert.equal(lines[0], `v${readOwnVersion()}`, '既存の機械観測契約として1行目は CLI 版だけ');
    assert.ok(lines.includes(`CLI バージョン: v${readOwnVersion()}`));
    assert.ok(lines.includes('本体バージョン: v0.1.11（更新判定の基準）'));
    assert.ok(lines.some((line) => line.includes('本体が古い')));
  } finally {
    await rm(akariHome, { recursive: true, force: true });
  }
});

for (const [name, args, expected] of [
  ['new', ['new', '--help'], 'akari new <target-dir>'],
  ['narration', ['narration', '--help'], 'akari narration generate'],
  ['internal', ['internal', '--help'], 'beat-sync-render-when-idle'],
  ['assets', ['assets', '--help'], 'akari-assets <list\\|fetch\\|sync\\|browse>'],
  ['word-book', ['word-book', '--help'], 'akari-word-book <subcommand>'],
  ['clean', ['clean', '--help'], 'akari clean'],
]) {
  test(`bin/akari.mjs: ${name} 分岐が help を表示する`, () => {
    const result = spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(expected));
  });
}

// タスク契約 2026-08-11-onboarding-o3-firstrun-plain §4（help の 1 画面化）:
// `akari --help` / `-h` は以前は claude/opencode へそのまま転送されてしまい、AKARI Video 自身の
// コマンド一覧が一度も出ない行き止まりだった。トップレベルの一覧表示を新設したことを確認する。
for (const flag of ['--help', '-h']) {
  test(`bin/akari.mjs: ${flag} は claude/opencode へ転送せず、初心者目線で並べ替えた一覧を表示する`, () => {
    const result = spawnSync(process.execPath, [bin, flag], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /使い方: akari \[command\] \[options\.\.\.\]/);

    // 「作る → プレビュー/連携/素材 → 更新」の順（作る=引数なし・開発者向けフラグは末尾）。
    const connectIndex = result.stdout.indexOf('store connect');
    const updateIndex = result.stdout.indexOf('update');
    const devFlagIndex = result.stdout.indexOf('--opencode');
    assert.ok(connectIndex > 0 && updateIndex > connectIndex, 'store connect → update の順');
    assert.ok(devFlagIndex > updateIndex, '開発者向けフラグ（--opencode 等）はよく使うコマンドより後ろに降格');
  });
}
