import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { run } from '../src/cli.mjs';
import { resolveRepoAssets } from '../src/repo-assets.mjs';

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
