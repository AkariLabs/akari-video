import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const scripts = [
  { name: 'check-release-versions', relative: 'scripts/release/check-release-versions.mjs', args: ['v9.9.9'], directRun: true },
  { name: 'normalize-geometry', relative: 'packages/edit-store/bin/normalize-geometry.mjs', args: [], directRun: true },
  { name: 'generate-timeline', relative: 'templates/kaisetsu-short/tools/generate-timeline.mjs', args: [], directRun: true },
  { name: 'face-expression', relative: 'skills/analyze-footage/bin/face-expression/face-expression.mjs', args: [], directRun: true },
  { name: 'fetch-binaries', relative: 'packages/media-bin/scripts/fetch-binaries.mjs', directRun: false },
  { name: 'build-whisper', relative: 'packages/media-bin/scripts/build-whisper.mjs', directRun: false },
];

function run(args) {
  return spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 10_000 });
}

for (const { name, relative, args } of scripts.filter((script) => script.directRun)) {
  test(`${name}: 空白・日本語パスの symlink 経由でも main が走る`, {
    skip: process.platform === 'win32' ? 'Windows では symlink 作成が EPERM になりうるため' : false,
  }, (t) => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'akari-entry-guards-'));
    t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }));
    const linkDir = path.join(temporaryRoot, '空白 と 日本語');
    mkdirSync(linkDir);

    const actual = path.join(repoRoot, relative);
    const link = path.join(linkDir, path.basename(actual));
    symlinkSync(actual, link);

    const direct = run([actual, ...args]);
    assert.equal(direct.error, undefined, `${name}: 実ファイルの直接実行に失敗`);
    assert.notEqual(direct.status, null, `${name}: 実ファイルの直接実行がタイムアウト`);
    assert.notEqual(`${direct.stdout}${direct.stderr}`, '', `${name}: 直接実行に診断出力がない`);

    const linked = run([link, ...args]);
    assert.equal(linked.error, undefined, `${name}: symlink 実行に失敗`);
    assert.notEqual(linked.status, null, `${name}: symlink 実行がタイムアウト`);
    assert.equal(linked.status, direct.status, `${name}: symlink と直接実行の exit code が異なる`);
    assert.notEqual(`${linked.stdout}${linked.stderr}`, '', `${name}: symlink 経由で main が無言終了した`);
  });
}

for (const { name, relative } of scripts) {
  test(`${name}: import では main が走らない`, () => {
    const url = pathToFileURL(path.join(repoRoot, relative)).href;
    const result = run(['--input-type=module', '-e', 'await import(process.argv[1])', url]);
    assert.equal(result.error, undefined, `${name}: import がタイムアウトまたは起動失敗`);
    assert.notEqual(result.status, null, `${name}: import がタイムアウト`);
    assert.equal(result.status, 0, `${name}: import の exit code が 0 でない: ${result.stderr}`);
    assert.equal(result.stdout, '', `${name}: import 時に main が stdout を出した`);
  });
}
