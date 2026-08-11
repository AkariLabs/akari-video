import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const bin = join(packageRoot, 'bin', 'akari.mjs');

for (const [name, args, expected] of [
  ['new', ['new', '--help'], 'akari new <target-dir>'],
  ['narration', ['narration', '--help'], 'akari narration generate'],
  ['internal', ['internal', '--help'], 'beat-sync-render-when-idle'],
  ['assets', ['assets', '--help'], 'akari-assets <list\\|fetch\\|sync\\|browse>']
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
