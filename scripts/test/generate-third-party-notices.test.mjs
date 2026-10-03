import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const generator = join(repo, 'apps/shell/resources/scripts/generate-third-party-notices.mjs');

test('frame-engine・overlay vendor・メディアのライセンスを通知に収録する', t => {
  const temporary = mkdtempSync(join(tmpdir(), 'akari-notices-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const electron = join(temporary, 'electron');
  const media = join(temporary, 'media');
  const output = join(temporary, 'output');
  mkdirSync(electron); mkdirSync(media);
  writeFileSync(join(electron, 'LICENSE'), 'Electron license fixture\n');
  writeFileSync(join(electron, 'LICENSES.chromium.html'), 'Chromium license fixture\n');
  writeFileSync(join(electron, 'version'), 'test\n');
  writeFileSync(join(media, 'LICENSE.ffmpeg.txt'), 'GPLv3 fixture\n');
  writeFileSync(join(media, 'LICENSE.whisper.cpp.txt'), 'MIT fixture\n');
  const result = spawnSync(process.execPath, [generator], {
    cwd: repo,
    env: { ...process.env, AKARI_NOTICE_ELECTRON_DIST_FOR_TEST: electron, AKARI_NOTICE_MEDIA_BIN_FOR_TEST: media, AKARI_NOTICE_OUTPUT_FOR_TEST: output },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const notices = readFileSync(join(output, 'ThirdPartyNotices.txt'), 'utf8');
  for (const name of ['@webav/av-cliper', '@webav/internal-utils', 'opfs-tools', 'wave-resampler', '@webav/mp4box.js', 'three', 'BudouX', 'FFmpeg', 'whisper.cpp']) {
    assert.ok(notices.includes(`%% ${name}@`), name);
  }
  assert.match(notices, /^%% three@0\.185\.1 — MIT$/mu);
  assert.match(notices, /^%% BudouX@0\.9\.0 — Apache-2\.0$/mu);
  assert.match(notices, /^%% FFmpeg@8\.1\.2 — GPL-3\.0-or-later$/mu);
  assert.match(notices, /^%% @webav\/av-cliper@1\.2\.8 — MIT$/mu);
  assert.match(notices, /^   source: https:\/\/github\.com\/FFmpeg\/FFmpeg\/tree\/n8\.1\.2\n   build: /mu);
  assert.match(notices, /GPLv3 fixture/u);
  assert.match(notices, /MIT fixture/u);
  assert.equal(readFileSync(join(output, 'LICENSE.akari-video.txt'), 'utf8'), readFileSync(join(repo, 'LICENSE'), 'utf8'));
});

test('media-bin のライセンス本文がなければ実行を止め、先行手順を案内する', t => {
  const temporary = mkdtempSync(join(tmpdir(), 'akari-notices-missing-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [generator], {
    cwd: repo,
    env: {
      ...process.env,
      AKARI_NOTICE_MEDIA_BIN_FOR_TEST: temporary,
      AKARI_NOTICE_OUTPUT_FOR_TEST: join(temporary, 'output'),
    },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /THIRD-PARTY-NOTICES FAILED/u);
  assert.match(result.stderr, /先に bundle-media-binaries\.mjs を実行/u);
});

test('frame-engine の npm 依存が無くても固定 LICENSE から版・SPDX つき通知を生成する', t => {
  const temporary = mkdtempSync(join(tmpdir(), 'akari-notices-release-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const electron = join(temporary, 'electron');
  const media = join(temporary, 'media');
  const framePackages = join(temporary, 'frame-packages');
  const output = join(temporary, 'output');
  mkdirSync(electron); mkdirSync(media); mkdirSync(framePackages);
  writeFileSync(join(electron, 'LICENSE'), 'Electron license fixture\n');
  writeFileSync(join(electron, 'LICENSES.chromium.html'), 'Chromium license fixture\n');
  writeFileSync(join(electron, 'version'), 'test\n');
  writeFileSync(join(media, 'LICENSE.ffmpeg.txt'), 'GPLv3 fixture\n');
  writeFileSync(join(media, 'LICENSE.whisper.cpp.txt'), 'MIT fixture\n');
  const result = spawnSync(process.execPath, [generator], {
    cwd: repo,
    env: {
      ...process.env,
      AKARI_NOTICE_ELECTRON_DIST_FOR_TEST: electron,
      AKARI_NOTICE_MEDIA_BIN_FOR_TEST: media,
      AKARI_NOTICE_OUTPUT_FOR_TEST: output,
      AKARI_NOTICE_FRAME_PACKAGE_ROOT_FOR_TEST: framePackages,
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const notices = readFileSync(join(output, 'ThirdPartyNotices.txt'), 'utf8');
  for (const [name, version] of [
    ['@webav/av-cliper', '1.2.8'],
    ['@webav/internal-utils', '1.2.8'],
    ['opfs-tools', '0.7.4'],
    ['wave-resampler', '1.0.0'],
  ]) {
    assert.ok(notices.includes(`%% ${name}@${version} — MIT`), name);
  }
  assert.equal((notices.match(/^%% @webav\/mp4box\.js@/gmu) ?? []).length, 1);
});

test('開発環境の frame-engine npm 依存の版が固定表と違えば停止する', t => {
  const temporary = mkdtempSync(join(tmpdir(), 'akari-notices-version-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const fake = join(temporary, '@webav/av-cliper');
  mkdirSync(fake, { recursive: true });
  writeFileSync(join(fake, 'package.json'), JSON.stringify({ name: '@webav/av-cliper', version: '9.9.9' }));
  const result = spawnSync(process.execPath, [generator], {
    cwd: repo,
    env: { ...process.env, AKARI_NOTICE_FRAME_PACKAGE_ROOT_FOR_TEST: temporary },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /THIRD-PARTY-NOTICES FAILED.*@webav\/av-cliper の版が固定表と異なります/u);
});

test('開発環境の frame-engine npm LICENSE が固定本文と違えば停止する', t => {
  const temporary = mkdtempSync(join(tmpdir(), 'akari-notices-license-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const fake = join(temporary, '@webav/av-cliper');
  mkdirSync(fake, { recursive: true });
  writeFileSync(join(fake, 'package.json'), JSON.stringify({ name: '@webav/av-cliper', version: '1.2.8' }));
  writeFileSync(join(fake, 'LICENSE'), 'different license text\n');
  const result = spawnSync(process.execPath, [generator], {
    cwd: repo,
    env: { ...process.env, AKARI_NOTICE_FRAME_PACKAGE_ROOT_FOR_TEST: temporary },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /THIRD-PARTY-NOTICES FAILED.*@webav\/av-cliper の LICENSE が固定の写しと異なります/u);
});
