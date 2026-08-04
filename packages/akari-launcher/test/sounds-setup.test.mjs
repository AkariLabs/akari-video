import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { detectAssetIntroState, maybeShowAssetIntroNotice, runSoundsCommand } from '../src/sounds-setup.mjs';

async function withAkariHome(run) {
    const home = await mkdtemp(path.join(tmpdir(), 'akari-sounds-setup-'));
    try {
        await run({ env: { AKARI_HOME: home }, home });
    } finally {
        await rm(home, { recursive: true, force: true });
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

// --- maybeShowAssetIntroNotice（2026-08-04〜: 初回起動の一括 DL [Y/n] 質問は廃止し、
//     素材の取得方式 + アカウント接続の案内を生涯 1 回だけ出す。質問は一切しない）。

test('first call: shows the notice once, mentions on-demand fetch, account connect and the akari sounds escape hatch', async () => {
    await withAkariHome(async ({ env, home }) => {
        const logs = [];
        const result = maybeShowAssetIntroNotice({ env, log: (l) => logs.push(l) });
        assert.equal(result.action, 'shown');
        assert.equal(logs.length, 1, '案内は 1 行だけ');
        assert.match(logs[0], /使うときに必要な分だけ/);
        assert.match(logs[0], /akari store connect/);
        assert.match(logs[0], /akari sounds/);
        assert.ok(existsSync(path.join(home, '.akari-asset-intro-shown.json')), '生涯 1 回のマーカーを書く');
    });
});

test('second call: shows nothing (no [Y/n], never asks twice)', async () => {
    await withAkariHome(async ({ env }) => {
        const first = maybeShowAssetIntroNotice({ env, log: () => {} });
        assert.equal(first.action, 'shown');

        const logs = [];
        const second = maybeShowAssetIntroNotice({ env, log: (l) => logs.push(l) });
        assert.equal(second.action, 'already-shown');
        assert.deepEqual(logs, []);
        assert.equal(detectAssetIntroState(env).shown, true);
    });
});

test('does not touch spawnFetch — the notice never downloads anything on its own', async () => {
    await withAkariHome(async ({ env }) => {
        let spawnCalled = false;
        const result = maybeShowAssetIntroNotice({
            env,
            log: () => {},
            // maybeShowAssetIntroNotice は spawnFetch を受け取らない設計だが、渡っても
            // 無視される（呼ばれない）ことを確認する。
            spawnFetch: () => { spawnCalled = true; return { status: 0 }; }
        });
        assert.equal(result.action, 'shown');
        assert.equal(spawnCalled, false);
    });
});

// --- runSoundsCommand（`akari sounds` — 一括ダウンロードの明示的な逃げ道。変更しない）。

test('akari sounds: passes arguments through and reports success', async () => {
    await withAkariHome(async ({ env }) => {
        const { calls, spawnFetch } = recordingFetch(0);
        const logs = [];
        const result = await runSoundsCommand(['--variant', 'wav', '--force'], {
            env, log: (l) => logs.push(l), assets: FAKE_ASSETS, spawnFetch
        });
        assert.equal(result.exitCode, 0);
        assert.deepEqual(calls[0].args, ['--variant', 'wav', '--force']);
        assert.ok(logs.some((l) => l.includes('追加カタログ')));
    });
});

test('akari sounds: reports failure with the retry command and exit code 1', async () => {
    await withAkariHome(async ({ env }) => {
        const { spawnFetch } = recordingFetch(1);
        const logs = [];
        const result = await runSoundsCommand([], { env, log: (l) => logs.push(l), assets: FAKE_ASSETS, spawnFetch });
        assert.equal(result.exitCode, 1);
        assert.ok(logs.some((l) => l.includes('akari sounds')));
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
