import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { run } from '../src/cli.mjs';
import { resolveRepoAssets } from '../src/repo-assets.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

async function withScratchRoot(runFn) {
    const root = await mkdtemp(join(tmpdir(), 'akari-cli-sounds-'));
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

test('run() は claude 起動前に音源セットアップステップを 1 回呼び、autoConfirm と isTTY を引き継ぐ', async () => {
    await withScratchRoot(async (root) => {
        const calls = [];
        const result = await run(['--yes'], baseOptions(root, {
            setupSounds: async (params) => {
                calls.push(params);
                return { action: 'downloaded' };
            }
        }));
        assert.equal(result.exitCode, 0);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].autoConfirm, true);
        assert.equal(calls[0].options.isTTY, false);
        assert.ok(calls[0].assets.audioFetchScriptPath, 'checkout では fetch スクリプトが解決される');
    });
});

test('run() は音源セットアップが throw しても claude 起動まで進む（不変条件）', async () => {
    await withScratchRoot(async (root) => {
        const logs = [];
        let claudeLaunched = false;
        const result = await run([], baseOptions(root, {
            log: (line) => logs.push(line),
            spawnClaude: () => { claudeLaunched = true; return { status: 0 }; },
            setupSounds: async () => { throw new Error('network down'); }
        }));
        assert.equal(result.exitCode, 0);
        assert.equal(claudeLaunched, true);
        assert.ok(logs.some((line) => line.includes('音源セットアップでエラー')));
    });
});

test('run() 既定実装: 非 TTY・未導入では何も表示せずダウンロードもしない（自動化互換）', async () => {
    await withScratchRoot(async (root) => {
        const logs = [];
        const result = await run([], baseOptions(root, {
            log: (line) => logs.push(line),
            // setupSounds は差し替えない（既定の maybeSetupSounds を通す）。
            // AKARI_HOME 隔離済み + isTTY: false → skipped-non-tty で無音のはず。
            soundsOptions: {
                spawnFetch: () => { throw new Error('must not download in non-TTY'); }
            }
        }));
        assert.equal(result.exitCode, 0);
        assert.ok(!logs.some((line) => line.includes('AKARI Sounds')), '非 TTY では音源の文言を一切出さない');
    });
});
