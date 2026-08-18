import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { detectTools } from '../../lib/node/tool-detection.js';

function tool(result, id) {
    return result.tools.find(entry => entry.id === id);
}

test('ffmpeg は PATH 上の実行ファイルを実測し、版を返す', async t => {
    const scratch = await mkdtemp(join(tmpdir(), 'akari-tools-present-'));
    t.after(() => rm(scratch, { recursive: true, force: true }));
    const bin = join(scratch, 'bin');
    await mkdir(bin);
    const fakeFfmpeg = join(bin, 'ffmpeg');
    await writeFile(fakeFfmpeg, '#!/bin/sh\necho "ffmpeg version 9.9-test"\n');
    await chmod(fakeFfmpeg, 0o755);

    const result = await detectTools({
        platform: 'linux',
        env: { PATH: bin },
        homeDir: scratch,
        now: () => new Date('2026-08-11T00:00:00.000Z')
    });
    assert.deepEqual(tool(result, 'ffmpeg'), {
        id: 'ffmpeg', tier: 'required', available: true,
        executable: 'ffmpeg', version: 'ffmpeg version 9.9-test'
    });
});

test('ffmpeg は PATH から除くと未検出になる', async t => {
    const scratch = await mkdtemp(join(tmpdir(), 'akari-tools-absent-'));
    t.after(() => rm(scratch, { recursive: true, force: true }));
    const emptyBin = join(scratch, 'empty-bin');
    await mkdir(emptyBin);

    const result = await detectTools({ platform: 'linux', env: { PATH: emptyBin }, homeDir: scratch });
    assert.deepEqual(tool(result, 'ffmpeg'), { id: 'ffmpeg', tier: 'required', available: false });
});

test('macOS CLT は xcode-select -p の非0終了で推奨・未検出となり git を呼ばない', async () => {
    const calls = [];
    const result = await detectTools({
        platform: 'darwin',
        env: { PATH: '/empty' },
        homeDir: '/nonexistent',
        pathExists: async () => false,
        runCommand: async (command, args) => {
            calls.push([command, args]);
            return { ok: false, stdout: '', stderr: 'not installed' };
        }
    });
    assert.deepEqual(tool(result, 'xcode-clt'), {
        id: 'xcode-clt', tier: 'recommended', available: false
    });
    assert.ok(calls.some(([command, args]) => command === 'xcode-select' && args[0] === '-p'));
    assert.equal(calls.some(([command]) => command === 'git'), false);
});

test('~/.akari/tools/bin に配置された道具は再チェックで検出される（brew 不在時 DL 配置の受け皿）', async t => {
    const scratch = await mkdtemp(join(tmpdir(), 'akari-tools-akaribin-'));
    t.after(() => rm(scratch, { recursive: true, force: true }));
    const binDir = join(scratch, '.akari', 'tools', 'bin');
    await mkdir(binDir, { recursive: true });
    const fakeYtDlp = join(binDir, 'yt-dlp');
    await writeFile(fakeYtDlp, '#!/bin/sh\necho "2026.08.17"\n');
    await chmod(fakeYtDlp, 0o755);

    const result = await detectTools({ platform: 'linux', env: { PATH: '/empty' }, homeDir: scratch });
    const ytDlp = tool(result, 'yt-dlp');
    assert.equal(ytDlp.available, true);
    assert.equal(ytDlp.executable, fakeYtDlp);
});

test('macOS 以外では CLT 項目自体を返さない', async () => {
    const result = await detectTools({
        platform: 'linux', env: { PATH: '/empty' }, homeDir: '/nonexistent',
        pathExists: async () => false,
        runCommand: async () => ({ ok: false, stdout: '', stderr: '' })
    });
    assert.equal(tool(result, 'xcode-clt'), undefined);
});

// --- 同梱バイナリ検知（進捗バー + 同梱ファースト裁定） ------------------------------

test('ffmpeg は同梱バイナリ（process.resourcesPath 配下の media-bin/）を PATH より優先して検出する', async t => {
    const scratch = await mkdtemp(join(tmpdir(), 'akari-tools-bundled-resources-'));
    t.after(() => rm(scratch, { recursive: true, force: true }));
    const resourcesPath = join(scratch, 'Resources');
    const mediaBinDir = join(resourcesPath, 'media-bin');
    await mkdir(mediaBinDir, { recursive: true });
    const bundledFfmpeg = join(mediaBinDir, 'ffmpeg');
    await writeFile(bundledFfmpeg, '#!/bin/sh\necho "ffmpeg version bundled-test"\n');
    await chmod(bundledFfmpeg, 0o755);
    const pathBin = join(scratch, 'bin');
    await mkdir(pathBin);
    const pathFfmpeg = join(pathBin, 'ffmpeg');
    await writeFile(pathFfmpeg, '#!/bin/sh\necho "ffmpeg version path-test"\n');
    await chmod(pathFfmpeg, 0o755);

    const result = await detectTools({
        platform: 'linux', env: { PATH: pathBin }, homeDir: scratch, resourcesPath, devSearchRoots: []
    });
    const ffmpeg = tool(result, 'ffmpeg');
    assert.equal(ffmpeg.available, true);
    assert.equal(ffmpeg.executable, bundledFfmpeg);
    assert.match(ffmpeg.version, /bundled-test/);
});

test('ffmpeg は開発時、packages/media-bin/vendor/<platform>-<arch>/ を上方探索して検出する', async t => {
    const scratch = await mkdtemp(join(tmpdir(), 'akari-tools-dev-vendor-'));
    t.after(() => rm(scratch, { recursive: true, force: true }));
    const vendorDir = join(scratch, 'packages', 'media-bin', 'vendor', 'linux-x64');
    await mkdir(vendorDir, { recursive: true });
    const devFfmpeg = join(vendorDir, 'ffmpeg');
    await writeFile(devFfmpeg, '#!/bin/sh\necho "ffmpeg version dev-vendor-test"\n');
    await chmod(devFfmpeg, 0o755);

    const result = await detectTools({
        platform: 'linux', arch: 'x64', env: { PATH: '/empty' }, homeDir: scratch, devSearchRoots: [scratch]
    });
    const ffmpeg = tool(result, 'ffmpeg');
    assert.equal(ffmpeg.available, true);
    assert.equal(ffmpeg.executable, devFfmpeg);
});

test('ffmpeg: env override > 同梱 > PATH の優先順で解決する', async t => {
    const scratch = await mkdtemp(join(tmpdir(), 'akari-tools-priority-'));
    t.after(() => rm(scratch, { recursive: true, force: true }));

    const pathBin = join(scratch, 'bin');
    await mkdir(pathBin);
    const pathFfmpeg = join(pathBin, 'ffmpeg');
    await writeFile(pathFfmpeg, '#!/bin/sh\necho path\n');
    await chmod(pathFfmpeg, 0o755);

    const vendorDir = join(scratch, 'packages', 'media-bin', 'vendor', 'linux-x64');
    await mkdir(vendorDir, { recursive: true });
    const bundledFfmpeg = join(vendorDir, 'ffmpeg');
    await writeFile(bundledFfmpeg, '#!/bin/sh\necho bundled\n');
    await chmod(bundledFfmpeg, 0o755);

    const envFfmpeg = join(scratch, 'env-ffmpeg');
    await writeFile(envFfmpeg, '#!/bin/sh\necho env\n');
    await chmod(envFfmpeg, 0o755);

    const bundledOnly = await detectTools({
        platform: 'linux', arch: 'x64', env: { PATH: '/empty' }, homeDir: scratch, devSearchRoots: [scratch]
    });
    assert.equal(tool(bundledOnly, 'ffmpeg').executable, bundledFfmpeg);

    const bundledOverPath = await detectTools({
        platform: 'linux', arch: 'x64', env: { PATH: pathBin }, homeDir: scratch, devSearchRoots: [scratch]
    });
    assert.equal(tool(bundledOverPath, 'ffmpeg').executable, bundledFfmpeg);

    const envOverAll = await detectTools({
        platform: 'linux', arch: 'x64', env: { PATH: pathBin, AKARI_FFMPEG_BIN: envFfmpeg },
        homeDir: scratch, devSearchRoots: [scratch]
    });
    assert.equal(tool(envOverAll, 'ffmpeg').executable, envFfmpeg);
});

test('win32: ~/.akari/tools/bin の道具は .exe 付きで検出される（DL ファースト化の受け皿）', async t => {
    const scratch = await mkdtemp(join(tmpdir(), 'akari-tools-win-akaribin-'));
    t.after(() => rm(scratch, { recursive: true, force: true }));
    const binDir = join(scratch, '.akari', 'tools', 'bin');
    await mkdir(binDir, { recursive: true });
    const fakeYtDlpExe = join(binDir, 'yt-dlp.exe');
    await writeFile(fakeYtDlpExe, '#!/bin/sh\necho "2026.08.17"\n');
    await chmod(fakeYtDlpExe, 0o755);

    const result = await detectTools({ platform: 'win32', env: { PATH: '/empty' }, homeDir: scratch });
    const ytDlp = tool(result, 'yt-dlp');
    assert.equal(ytDlp.available, true);
    assert.equal(ytDlp.executable, fakeYtDlpExe);
});

// --- whisper: 本体 + モデルの 2 資産 ------------------------------------------------

test('whisper-cli も同じ規約で同梱候補（dev vendor）を検出する。モデルが揃うと行全体も available になる', async t => {
    const scratch = await mkdtemp(join(tmpdir(), 'akari-tools-whisper-bundled-'));
    t.after(() => rm(scratch, { recursive: true, force: true }));
    const vendorDir = join(scratch, 'packages', 'media-bin', 'vendor', 'linux-x64');
    await mkdir(vendorDir, { recursive: true });
    const devWhisper = join(vendorDir, 'whisper-cli');
    await writeFile(devWhisper, '#!/bin/sh\necho "whisper.cpp dev-vendor-test"\n');
    await chmod(devWhisper, 0o755);
    const modelsDir = join(scratch, '.akari', 'tools', 'models');
    await mkdir(modelsDir, { recursive: true });
    await writeFile(join(modelsDir, 'ggml-tiny.bin'), 'fake-model');

    const result = await detectTools({
        platform: 'linux', arch: 'x64', env: { PATH: '/empty' }, homeDir: scratch, devSearchRoots: [scratch]
    });
    const whisper = tool(result, 'whisper');
    assert.equal(whisper.executable, devWhisper);
    assert.equal(whisper.available, true);
    assert.equal(whisper.model.available, true);
    assert.equal(whisper.model.path, join(modelsDir, 'ggml-tiny.bin'));
});

test('whisper: 本体は検出できてもモデル未取得なら行全体は available=false になる', async t => {
    const scratch = await mkdtemp(join(tmpdir(), 'akari-tools-whisper-no-model-'));
    t.after(() => rm(scratch, { recursive: true, force: true }));
    const bin = join(scratch, 'bin');
    await mkdir(bin);
    const fakeWhisper = join(bin, 'whisper-cli');
    await writeFile(fakeWhisper, '#!/bin/sh\necho "whisper.cpp help-test"\n');
    await chmod(fakeWhisper, 0o755);

    const result = await detectTools({ platform: 'linux', env: { PATH: bin }, homeDir: scratch });
    const whisper = tool(result, 'whisper');
    // PATH 解決で見つかった場合、executable は実測に使った候補文字列そのもの（bare command
    // 'whisper-cli'）を返す — 既存の ffmpeg PATH テストと同じ契約（絶対パスへは解決しない）。
    assert.equal(whisper.executable, 'whisper-cli');
    assert.equal(whisper.available, false);
    assert.equal(whisper.model.available, false);
    assert.equal(whisper.model.path, undefined);
});

test('whisper モデル: AKARI_WHISPER_MODEL の実在パスが最優先で検出される', async t => {
    const scratch = await mkdtemp(join(tmpdir(), 'akari-tools-whisper-model-env-'));
    t.after(() => rm(scratch, { recursive: true, force: true }));
    const customModel = join(scratch, 'custom-model.bin');
    await writeFile(customModel, 'fake-model-bytes');
    const bin = join(scratch, 'bin');
    await mkdir(bin);
    const fakeWhisper = join(bin, 'whisper-cli');
    await writeFile(fakeWhisper, '#!/bin/sh\necho ok\n');
    await chmod(fakeWhisper, 0o755);

    const result = await detectTools({
        platform: 'linux', env: { PATH: bin, AKARI_WHISPER_MODEL: customModel }, homeDir: scratch
    });
    const whisper = tool(result, 'whisper');
    assert.equal(whisper.model.available, true);
    assert.equal(whisper.model.path, customModel);
    assert.equal(whisper.available, true);
});

test('whisper モデル: 何も無ければ未取得（AKARI_WHISPER_MODEL 未設定・models/ ディレクトリ自体が無い）', async t => {
    const scratch = await mkdtemp(join(tmpdir(), 'akari-tools-whisper-model-none-'));
    t.after(() => rm(scratch, { recursive: true, force: true }));

    const result = await detectTools({ platform: 'linux', env: { PATH: '/empty' }, homeDir: scratch });
    const whisper = tool(result, 'whisper');
    assert.equal(whisper.model.available, false);
    assert.equal(whisper.model.path, undefined);
});
