import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { CREATOR_ROOT_SCHEMA, CreatorRootError, readRootManifest } from '../src/index.mjs';
import { withScratchRoot } from './helpers.mjs';

test('readRootManifest: root.json が無ければ ROOT_MANIFEST_NOT_FOUND', async () => {
    await withScratchRoot(async (root) => {
        await assert.rejects(readRootManifest(root), (error) => {
            assert.ok(error instanceof CreatorRootError);
            assert.equal(error.code, 'ROOT_MANIFEST_NOT_FOUND');
            return true;
        });
    });
});

test('readRootManifest: 壊れた JSON は ROOT_MANIFEST_INVALID_JSON', async () => {
    await withScratchRoot(async (root) => {
        await mkdir(join(root, '.akari'), { recursive: true });
        await writeFile(join(root, '.akari', 'root.json'), '{ not valid json', 'utf8');

        await assert.rejects(readRootManifest(root), (error) => {
            assert.ok(error instanceof CreatorRootError);
            assert.equal(error.code, 'ROOT_MANIFEST_INVALID_JSON');
            return true;
        });
    });
});

test('readRootManifest: 未知の schema は壊さず ROOT_MANIFEST_UNKNOWN_SCHEMA で拒否する（元ファイルは書き換えない）', async () => {
    await withScratchRoot(async (root) => {
        await mkdir(join(root, '.akari'), { recursive: true });
        const original = JSON.stringify({ schema: 'creator-root/v99', channels: [] });
        await writeFile(join(root, '.akari', 'root.json'), original, 'utf8');

        await assert.rejects(readRootManifest(root), (error) => {
            assert.ok(error instanceof CreatorRootError);
            assert.equal(error.code, 'ROOT_MANIFEST_UNKNOWN_SCHEMA');
            return true;
        });

        const raw = await readFile(join(root, '.akari', 'root.json'), 'utf8');
        assert.equal(raw, original);
    });
});

test('readRootManifest: schema キーが無いオブジェクトも未知版と同様に拒否する', async () => {
    await withScratchRoot(async (root) => {
        await mkdir(join(root, '.akari'), { recursive: true });
        await writeFile(join(root, '.akari', 'root.json'), JSON.stringify({ channels: [] }), 'utf8');

        await assert.rejects(readRootManifest(root), (error) => {
            assert.equal(error.code, 'ROOT_MANIFEST_UNKNOWN_SCHEMA');
            return true;
        });
    });
});

test('readRootManifest: creator-root/v1 は読み取れる', async () => {
    await withScratchRoot(async (root) => {
        await mkdir(join(root, '.akari'), { recursive: true });
        const manifest = { schema: CREATOR_ROOT_SCHEMA, createdAt: new Date().toISOString(), channels: ['my-channel'] };
        await writeFile(join(root, '.akari', 'root.json'), JSON.stringify(manifest), 'utf8');

        const result = await readRootManifest(root);
        assert.deepEqual(result, manifest);
    });
});
