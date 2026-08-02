import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { createCreatorRoot, resolveCreatorRoot, updateMachinePointer } from '../src/index.mjs';
import { withScratchRoot } from './helpers.mjs';

test('resolveCreatorRoot: (a) AKARI_CREATOR_ROOT の明示指定を最優先で解決する', async () => {
    await withScratchRoot(async (scratch) => {
        const root = join(scratch, 'AkariVideo');
        await createCreatorRoot(root);

        const resolved = await resolveCreatorRoot({
            cwd: scratch,
            env: { AKARI_CREATOR_ROOT: root }
        });

        assert.equal(resolved.source, 'env');
        assert.equal(resolved.rootDir, root);
        assert.equal(resolved.manifest.schema, 'creator-root/v1');
    });
});

test('resolveCreatorRoot: (a) 明示指定先が見つからない場合は null に揉み消さずエラー情報を返す', async () => {
    await withScratchRoot(async (scratch) => {
        const missing = join(scratch, 'does-not-exist');

        const resolved = await resolveCreatorRoot({
            cwd: scratch,
            env: { AKARI_CREATOR_ROOT: missing }
        });

        assert.notEqual(resolved, null);
        assert.equal(resolved.source, 'env');
        assert.equal(resolved.rootDir, missing);
        assert.equal(resolved.manifest, null);
        assert.equal(resolved.error.code, 'ROOT_MANIFEST_NOT_FOUND');
    });
});

test('resolveCreatorRoot: (b) cwd から上方探索して .akari/root.json を持つ最初の祖先を見つける', async () => {
    await withScratchRoot(async (scratch) => {
        const root = join(scratch, 'AkariVideo');
        await createCreatorRoot(root);
        const deepCwd = join(root, 'channels', 'my-channel', 'videos', 'some-project', 'nested');
        await mkdir(deepCwd, { recursive: true });

        const resolved = await resolveCreatorRoot({ cwd: deepCwd, env: {} });

        assert.equal(resolved.source, 'ancestor');
        assert.equal(resolved.rootDir, root);
    });
});

test('resolveCreatorRoot: (c) 祖先に見つからない場合はマシンポインタの lastRoot を使う（実在確認あり）', async () => {
    await withScratchRoot(async (scratch) => {
        const root = join(scratch, 'AkariVideo');
        await createCreatorRoot(root);
        const akariHome = join(scratch, 'dot-akari');
        const otherCwd = join(scratch, 'elsewhere');
        await mkdir(otherCwd, { recursive: true });

        await updateMachinePointer(root, { AKARI_HOME: akariHome });

        const resolved = await resolveCreatorRoot({ cwd: otherCwd, env: { AKARI_HOME: akariHome } });

        assert.equal(resolved.source, 'pointer');
        assert.equal(resolved.rootDir, root);
    });
});

test('resolveCreatorRoot: マシンポインタの lastRoot が実在しない場合は使わず null になる', async () => {
    await withScratchRoot(async (scratch) => {
        const akariHome = join(scratch, 'dot-akari');
        const otherCwd = join(scratch, 'elsewhere');
        await mkdir(otherCwd, { recursive: true });
        await mkdir(akariHome, { recursive: true });
        await writeFile(join(akariHome, 'creator-root.json'), JSON.stringify({
            lastRoot: join(scratch, 'does-not-exist-root'),
            updatedAt: new Date().toISOString()
        }), 'utf8');

        const resolved = await resolveCreatorRoot({ cwd: otherCwd, env: { AKARI_HOME: akariHome } });
        assert.equal(resolved, null);
    });
});

test('resolveCreatorRoot: どの経路にも該当しなければ null', async () => {
    await withScratchRoot(async (scratch) => {
        const otherCwd = join(scratch, 'elsewhere');
        await mkdir(otherCwd, { recursive: true });
        const akariHome = join(scratch, 'dot-akari-empty');

        const resolved = await resolveCreatorRoot({ cwd: otherCwd, env: { AKARI_HOME: akariHome } });
        assert.equal(resolved, null);
    });
});
