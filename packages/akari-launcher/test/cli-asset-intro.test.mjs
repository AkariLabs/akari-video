import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { run } from '../src/cli.mjs';
import { resolveRepoAssets } from '../src/repo-assets.mjs';
import { resolveCredentialsPath } from '../src/store-device-connect.mjs';

// 2026-08-04 オーナー方針（設計正本: 内部リポ
// planning/notes-2026-08-04-asset-reference-distribution.md §8）で、初回起動の AKARI Sounds
// 一括ダウンロード [Y/n] 質問（2026-08-03 裁定）は廃止した。ここでは run() が
// claude 起動前に素材案内ステップ（sounds-setup.mjs の maybeShowAssetIntroNotice）を
// 1 回だけ呼ぶこと、そのステップが質問もダウンロードもしないこと、失敗しても claude 起動
// までは止めないこと（不変条件）を確認する。旧ファイル名 cli-sounds.test.mjs から改名
// （中身が「一括 DL の配線検証」から「案内 1 回だけの配線検証」に変わったため）。

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

async function withScratchRoot(runFn) {
    const root = await mkdtemp(join(tmpdir(), 'akari-cli-asset-intro-'));
    try {
        await runFn(root);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}

function baseOptions(root, extra = {}) {
    return {
        projectRoot: root,
        log: () => {},
        assets: resolveRepoAssets(repoRoot),
        runDoctor: () => ({ status: 0 }),
        resolveClaude: () => '/fake/bin/claude',
        spawnClaude: () => ({ status: 0 }),
        env: { ...process.env, AKARI_HOME: join(root, '.akari-home-unused') },
        refreshUpdate: () => {},
        isTTY: false,
        ...extra
    };
}

test('run() は claude 起動前に素材案内ステップを 1 回呼ぶ', async () => {
    await withScratchRoot(async (root) => {
        const calls = [];
        const result = await run(['--yes'], baseOptions(root, {
            showAssetIntro: async (params) => {
                calls.push(params);
                return { action: 'shown' };
            }
        }));
        assert.equal(result.exitCode, 0);
        assert.equal(calls.length, 1);
        // 質問ではないので autoConfirm / isTTY / prompt は一切渡らない（旧実装からの変更点）。
        assert.deepEqual(Object.keys(calls[0]).sort(), ['env', 'log']);
    });
});

test('run() は素材案内ステップが throw しても claude 起動まで進む（不変条件）', async () => {
    await withScratchRoot(async (root) => {
        const logs = [];
        let claudeLaunched = false;
        const result = await run([], baseOptions(root, {
            log: (line) => logs.push(line),
            spawnClaude: () => { claudeLaunched = true; return { status: 0 }; },
            showAssetIntro: async () => { throw new Error('disk full'); }
        }));
        assert.equal(result.exitCode, 0);
        assert.equal(claudeLaunched, true);
        assert.ok(logs.some((line) => line.includes('素材案内の表示でエラー')));
    });
});

test('run() 既定実装: [Y/n] を一切出さず、非 TTY でも初回は案内を 1 行だけ表示する（質問ではないので TTY 判定は無い）', async () => {
    await withScratchRoot(async (root) => {
        const logs = [];
        const result = await run([], baseOptions(root, {
            log: (line) => logs.push(line)
            // showAssetIntro は差し替えない（既定の maybeShowAssetIntroNotice を通す）。
            // 質問ではないため、非 TTY でも案内自体は表示される（旧 [Y/n] は TTY 必須だった）。
        }));
        assert.equal(result.exitCode, 0);
        assert.ok(!logs.some((line) => /\[Y\/n\]/.test(line)), '[Y/n] のようなプロンプト文言は出ない');
        assert.ok(logs.some((line) => line.includes('akari store connect')), '案内は 1 回出る（生涯 1 回のうちの初回）');
    });
});

test('run() 既定実装: 2 回目の起動（同じ AKARI_HOME）では案内を出さない', async () => {
    await withScratchRoot(async (root) => {
        const env = { ...process.env, AKARI_HOME: join(root, '.akari-home-shared') };
        const first = await run([], baseOptions(root, { env, log: () => {} }));
        assert.equal(first.exitCode, 0);

        const logs = [];
        const second = await run([], baseOptions(root, { env, log: (line) => logs.push(line) }));
        assert.equal(second.exitCode, 0);
        assert.ok(!logs.some((line) => line.includes('akari store connect')), '2 回目は案内を出さない（生涯 1 回）');
    });
});

// タスク契約 2026-08-11-onboarding-o3-firstrun-plain の受け入れ条件:
// 「一時 HOME での first-run: スターターパック案内が 1 回だけ出る / 連携済みなら出ない」。
// 上のテスト群は showAssetIntro を差し替えるか未接続状態を前提にしているため、ここでは
// 既定実装（sounds-setup.mjs の maybeShowAssetIntroNotice）を差し替えずに通し、
// 実ネットワーク・実 ~/.akari には一切触れない隔離 AKARI_HOME へ接続済み資格情報の
// fixture を直接置いて検証する。

test('run() 既定実装（未接続の一時 HOME）: スターターパック案内が初回起動で 1 回だけ出る', async () => {
    await withScratchRoot(async (root) => {
        const env = { ...process.env, AKARI_HOME: join(root, '.akari-home-unconnected') };
        const logs = [];
        const result = await run([], baseOptions(root, { env, log: (line) => logs.push(line) }));
        assert.equal(result.exitCode, 0);
        assert.ok(logs.some((line) => line.includes('無料の素材パック') && line.includes('akari store connect')), '未接続なら無料スターターパックの案内が出る');
    });
});

test('run() 既定実装（連携済みの一時 HOME を fixture で再現）: スターターパック案内は出ない', async () => {
    await withScratchRoot(async (root) => {
        const env = { ...process.env, AKARI_HOME: join(root, '.akari-home-connected') };
        // 実 `akari store connect` は実行しない（実ネットワーク禁止）。store-device-connect.mjs の
        // writeCredentials と同じファイル形状を隔離 AKARI_HOME へ直接置いて「連携済み」を再現する。
        const credentialsFile = resolveCredentialsPath(env);
        mkdirSync(dirname(credentialsFile), { recursive: true });
        writeFileSync(credentialsFile, JSON.stringify({
            url: 'http://localhost:9999/api/store',
            token: 'akst_fake-token_0123456789',
            email: 'creator@example.com',
            connected_at: new Date().toISOString()
        }));

        const logs = [];
        const result = await run([], baseOptions(root, { env, log: (line) => logs.push(line) }));
        assert.equal(result.exitCode, 0);
        assert.ok(!logs.some((line) => line.includes('akari store connect')), '連携済みならスターターパック案内は出ない');
        assert.ok(!logs.some((line) => /\[Y\/n\]/.test(line)), '質問形式にもならない');
    });
});
