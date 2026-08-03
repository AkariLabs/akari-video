import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { detectSoundsState, maybeSetupSounds, runSoundsCommand } from '../src/sounds-setup.mjs';

const PACK_IDS = ['akari-sounds-bgm', 'akari-sounds-sfx', 'akari-sounds-jingle'];

async function withAkariHome(run) {
    const home = await mkdtemp(path.join(tmpdir(), 'akari-sounds-setup-'));
    try {
        await run({ env: { AKARI_HOME: home }, home, audioRoot: path.join(home, 'assets', 'audio') });
    } finally {
        await rm(home, { recursive: true, force: true });
    }
}

async function markInstalled(audioRoot) {
    for (const id of PACK_IDS) {
        await mkdir(path.join(audioRoot, id), { recursive: true });
        await writeFile(path.join(audioRoot, id, 'meta.json'), '{}');
    }
}

function recordingFetch(status = 0) {
    const calls = [];
    const spawnFetch = (script, args) => {
        calls.push({ script, args });
        return { status };
    };
    return { calls, spawnFetch };
}

const FAKE_ASSETS = { audioFetchScriptPath: '/fake/fetch-akari-sounds.mjs' };

test('skips silently when the fetch script is not bundled', async () => {
    await withAkariHome(async ({ env }) => {
        const logs = [];
        const result = await maybeSetupSounds({ env, log: (l) => logs.push(l), assets: {}, autoConfirm: true });
        assert.equal(result.action, 'unavailable');
        assert.deepEqual(logs, []);
    });
});

test('skips silently when all three packs are already installed', async () => {
    await withAkariHome(async ({ env, audioRoot }) => {
        await markInstalled(audioRoot);
        const { calls, spawnFetch } = recordingFetch();
        const logs = [];
        const result = await maybeSetupSounds({
            env, log: (l) => logs.push(l), assets: FAKE_ASSETS, autoConfirm: true,
            options: { spawnFetch }
        });
        assert.equal(result.action, 'installed');
        assert.equal(calls.length, 0);
        assert.deepEqual(logs, []);
    });
});

test('non-TTY without --yes asks nothing and downloads nothing (automation compatibility)', async () => {
    await withAkariHome(async ({ env }) => {
        const { calls, spawnFetch } = recordingFetch();
        const logs = [];
        const result = await maybeSetupSounds({
            env, log: (l) => logs.push(l), assets: FAKE_ASSETS, autoConfirm: false,
            options: { spawnFetch, isTTY: false }
        });
        assert.equal(result.action, 'skipped-non-tty');
        assert.equal(calls.length, 0);
        assert.deepEqual(logs, []);
    });
});

test('TTY: empty Enter means Yes (default) and downloads once, then shows the additional-catalog notice', async () => {
    await withAkariHome(async ({ env }) => {
        const { calls, spawnFetch } = recordingFetch(0);
        const logs = [];
        const prompts = [];
        const result = await maybeSetupSounds({
            env, log: (l) => logs.push(l), assets: FAKE_ASSETS, autoConfirm: false,
            options: {
                spawnFetch,
                isTTY: true,
                prompt: async (text) => { prompts.push(text); return ''; }
            }
        });
        assert.equal(result.action, 'downloaded');
        assert.equal(prompts.length, 1, '質問は 1 回だけ');
        assert.match(prompts[0], /AKARI Sounds/);
        assert.match(prompts[0], /\[Y\/n\]/);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].script, FAKE_ASSETS.audioFetchScriptPath);
        assert.ok(logs.some((l) => l.includes('追加カタログ')), '完了時に追加カタログを案内する');
    });
});

test('TTY: answering n writes a persistent marker, downloads nothing, and never asks again', async () => {
    await withAkariHome(async ({ env, audioRoot }) => {
        const { calls, spawnFetch } = recordingFetch();
        const logs = [];
        const first = await maybeSetupSounds({
            env, log: (l) => logs.push(l), assets: FAKE_ASSETS, autoConfirm: false,
            options: { spawnFetch, isTTY: true, prompt: async () => 'n' }
        });
        assert.equal(first.action, 'declined-now');
        assert.equal(calls.length, 0);
        assert.ok(existsSync(path.join(audioRoot, '.akari-sounds-declined.json')));
        assert.ok(logs.some((l) => l.includes('akari sounds')), '再入口コマンドを案内する');

        // 2 回目はプロンプト自体を出さない
        const second = await maybeSetupSounds({
            env, log: () => {}, assets: FAKE_ASSETS, autoConfirm: false,
            options: { spawnFetch, isTTY: true, prompt: async () => { throw new Error('should not prompt'); } }
        });
        assert.equal(second.action, 'declined');
    });
});

test('--yes downloads without prompting', async () => {
    await withAkariHome(async ({ env }) => {
        const { calls, spawnFetch } = recordingFetch(0);
        const result = await maybeSetupSounds({
            env, log: () => {}, assets: FAKE_ASSETS, autoConfirm: true,
            options: { spawnFetch, prompt: async () => { throw new Error('should not prompt'); } }
        });
        assert.equal(result.action, 'downloaded');
        assert.equal(calls.length, 1);
    });
});

test('fetch failure reports the retry command, writes no marker, and asks again next time', async () => {
    await withAkariHome(async ({ env, audioRoot }) => {
        const { spawnFetch } = recordingFetch(1);
        const logs = [];
        const result = await maybeSetupSounds({
            env, log: (l) => logs.push(l), assets: FAKE_ASSETS, autoConfirm: true,
            options: { spawnFetch }
        });
        assert.equal(result.action, 'failed');
        assert.ok(logs.some((l) => l.includes('akari sounds')));
        assert.ok(!existsSync(path.join(audioRoot, '.akari-sounds-declined.json')), '失敗では marker を書かない（次回また聞く）');
        assert.equal(detectSoundsState(env).declined, false);
    });
});

test('akari sounds: passes arguments through, clears a stale declined marker on success', async () => {
    await withAkariHome(async ({ env, audioRoot }) => {
        await mkdir(audioRoot, { recursive: true });
        await writeFile(path.join(audioRoot, '.akari-sounds-declined.json'), '{}');

        const { calls, spawnFetch } = recordingFetch(0);
        const logs = [];
        const result = await runSoundsCommand(['--variant', 'wav', '--force'], {
            env, log: (l) => logs.push(l), assets: FAKE_ASSETS, spawnFetch
        });
        assert.equal(result.exitCode, 0);
        assert.deepEqual(calls[0].args, ['--variant', 'wav', '--force']);
        assert.ok(!existsSync(path.join(audioRoot, '.akari-sounds-declined.json')), '明示的に入れ直したら marker は消す');
        assert.ok(logs.some((l) => l.includes('追加カタログ')));
    });
});

test('akari sounds: errors with exit 1 when the fetch script is not bundled', async () => {
    await withAkariHome(async ({ env }) => {
        const errors = [];
        const result = await runSoundsCommand([], {
            env, log: () => {}, logError: (l) => errors.push(l), assets: {}
        });
        assert.equal(result.exitCode, 1);
        assert.equal(errors.length, 1);
    });
});
