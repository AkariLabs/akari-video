import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAssetCatalogImporter } from '../lib/common/asset-catalog-import.js';

function createDependencies(overrides = {}) {
    return {
        getWorkspaceRoot: () => 'project-root',
        getCatalogItems: async () => [
            { id: 'sample-asset', category: 'still', state: 'available' }
        ],
        resolveAsset: async () => ({ success: true }),
        fileExists: async () => false,
        readDirectory: async () => [],
        ...overrides
    };
}

test('no-project: プロジェクトが無いと resolver を呼ばない', async () => {
    let resolveCalls = 0;
    const importAsset = createAssetCatalogImporter(createDependencies({
        getWorkspaceRoot: () => undefined,
        resolveAsset: async () => {
            resolveCalls += 1;
            return { success: true };
        }
    }));

    assert.deepEqual(await importAsset({ assetId: 'sample-asset' }), {
        ok: false,
        reason: 'no-project',
        message: '先にプロジェクトを開いてください。'
    });
    assert.equal(resolveCalls, 0);
});

test('not-found: カタログに無い id を拒否する', async () => {
    let resolveCalls = 0;
    const importAsset = createAssetCatalogImporter(createDependencies({
        getCatalogItems: async () => [],
        resolveAsset: async () => {
            resolveCalls += 1;
            return { success: true };
        }
    }));

    const result = await importAsset({ assetId: 'missing' });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'not-found');
    assert.equal(resolveCalls, 0);
});

test('alreadyPresent: meta.json があれば resolver を呼ばず直下ファイルを返す', async t => {
    const root = await mkdtemp(path.join(tmpdir(), 'akari-catalog-import-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const dir = path.join(root, 'assets', 'still', 'sample-asset');
    await mkdir(path.join(dir, 'nested'), { recursive: true });
    await writeFile(path.join(dir, 'meta.json'), '{}');
    await writeFile(path.join(dir, 'preview.png'), 'preview');
    await writeFile(path.join(dir, 'nested', 'ignored.txt'), 'ignored');
    let resolveCalls = 0;
    const importAsset = createAssetCatalogImporter(createDependencies({
        getWorkspaceRoot: () => root,
        resolveAsset: async () => {
            resolveCalls += 1;
            return { success: true };
        },
        fileExists: async (projectRoot, relativePath) => {
            try {
                const entries = await readdir(path.dirname(path.join(projectRoot, relativePath)));
                return entries.includes(path.basename(relativePath));
            } catch {
                return false;
            }
        },
        readDirectory: async (projectRoot, relativePath) => (await readdir(path.join(projectRoot, relativePath), { withFileTypes: true }))
            .map(entry => ({ name: entry.name, isFile: entry.isFile() }))
    }));

    assert.deepEqual(await importAsset({ assetId: 'sample-asset' }), {
        ok: true,
        id: 'sample-asset',
        category: 'still',
        dir: 'assets/still/sample-asset',
        files: [
            'assets/still/sample-asset/meta.json',
            'assets/still/sample-asset/preview.png'
        ],
        alreadyPresent: true
    });
    assert.equal(resolveCalls, 0);
});

test('成功: resolver 後の直下ファイルを32件までプロジェクト相対で返す', async t => {
    const root = await mkdtemp(path.join(tmpdir(), 'akari-catalog-import-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const importAsset = createAssetCatalogImporter(createDependencies({
        getWorkspaceRoot: () => root,
        resolveAsset: async (_id, projectRoot) => {
            const dir = path.join(projectRoot, 'assets', 'still', 'sample-asset');
            await mkdir(path.join(dir, 'nested'), { recursive: true });
            for (let index = 0; index < 34; index += 1) {
                await writeFile(path.join(dir, `file-${String(index).padStart(2, '0')}.dat`), String(index));
            }
            return { success: true };
        },
        readDirectory: async (projectRoot, relativePath) => (await readdir(path.join(projectRoot, relativePath), { withFileTypes: true }))
            .map(entry => ({ name: path.join(projectRoot, relativePath, entry.name), isFile: entry.isFile() }))
    }));

    const result = await importAsset({ assetId: 'sample-asset' });
    assert.equal(result.ok, true);
    assert.equal(result.alreadyPresent, false);
    assert.equal(result.files.length, 32);
    assert.ok(result.files.every(file => file.startsWith('assets/still/sample-asset/')));
    assert.ok(!JSON.stringify(result).includes('/Users/'));
    assert.ok(!JSON.stringify(result).includes(root));
});

test('locked: カタログ状態で拒否し resolver を呼ばない', async () => {
    let resolveCalls = 0;
    const importAsset = createAssetCatalogImporter(createDependencies({
        getCatalogItems: async () => [
            { id: 'sample-asset', category: 'still', state: 'locked' }
        ],
        resolveAsset: async () => {
            resolveCalls += 1;
            return { success: false, error: 'denied' };
        }
    }));

    const result = await importAsset({ assetId: 'sample-asset' });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'locked');
    assert.equal(resolveCalls, 0);
});

test('failed: resolver の失敗を failed に正規化する', async () => {
    const importAsset = createAssetCatalogImporter(createDependencies({
        resolveAsset: async () => ({ success: false, error: 'unavailable' })
    }));

    const result = await importAsset({ assetId: 'sample-asset' });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'failed');
});

test('同時2回: 同じ in-flight 結果を共有して resolver は1回だけ呼ぶ', async () => {
    let resolveCalls = 0;
    let release;
    const gate = new Promise(resolve => {
        release = resolve;
    });
    const importAsset = createAssetCatalogImporter(createDependencies({
        resolveAsset: async () => {
            resolveCalls += 1;
            await gate;
            return { success: true };
        }
    }));

    const first = importAsset({ assetId: 'sample-asset' });
    const second = importAsset({ assetId: 'sample-asset' });
    assert.equal(first, second);
    release();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    assert.equal(firstResult, secondResult);
    assert.equal(resolveCalls, 1);
});
