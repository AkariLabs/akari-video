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

test('macOS 以外では CLT 項目自体を返さない', async () => {
    const result = await detectTools({
        platform: 'linux', env: { PATH: '/empty' }, homeDir: '/nonexistent',
        pathExists: async () => false,
        runCommand: async () => ({ ok: false, stdout: '', stderr: '' })
    });
    assert.equal(tool(result, 'xcode-clt'), undefined);
});
