import assert from 'node:assert/strict';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import {
    CREATOR_ROOT_SCHEMA,
    DEFAULT_CONNECTIONS_REGISTRY,
    CreatorRootError,
    createCreatorRoot,
    readRootManifest
} from '../src/index.mjs';
import { withScratchRoot } from './helpers.mjs';

test('createCreatorRoot: 契約 §3 の正準構造を生成する', async () => {
    await withScratchRoot(async (scratch) => {
        const target = join(scratch, 'AkariVideo');
        const result = await createCreatorRoot(target);

        assert.equal(result.created, true);
        assert.equal(result.rootDir, target);
        assert.equal(result.manifest.schema, CREATOR_ROOT_SCHEMA);
        assert.deepEqual(result.manifest.channels, ['my-channel']);
        assert.ok(typeof result.manifest.createdAt === 'string' && !Number.isNaN(Date.parse(result.manifest.createdAt)));

        assert.ok((await stat(join(target, 'akari.md'))).isFile());
        assert.ok((await stat(join(target, 'CLAUDE.md'))).isFile());
        assert.ok((await stat(join(target, 'AGENTS.md'))).isFile());
        assert.ok((await stat(join(target, 'channels', 'my-channel', 'videos'))).isDirectory());
        assert.ok((await stat(join(target, 'library'))).isDirectory());
        assert.ok((await stat(join(target, 'inbox'))).isDirectory());
        assert.ok((await stat(join(target, '.akari', 'memory'))).isDirectory());
        assert.ok((await stat(join(target, '.akari', 'cache'))).isDirectory());

        const manifestOnDisk = await readRootManifest(target);
        assert.deepEqual(manifestOnDisk, result.manifest);

        const akariMd = await readFile(join(target, 'akari.md'), 'utf8');
        assert.match(akariMd, /好み/);
        assert.match(await readFile(join(target, 'CLAUDE.md'), 'utf8'), /akari\.md/);
        assert.match(await readFile(join(target, 'AGENTS.md'), 'utf8'), /akari\.md/);

        const connections = JSON.parse(await readFile(join(target, '.akari', 'connections.json'), 'utf8'));
        assert.deepEqual(connections, DEFAULT_CONNECTIONS_REGISTRY);
    });
});

test('createCreatorRoot: channelName オプションで初期チャンネル名を変更できる', async () => {
    await withScratchRoot(async (scratch) => {
        const target = join(scratch, 'AkariVideo');
        const result = await createCreatorRoot(target, { channelName: 'ryoma-ai-lab' });

        assert.deepEqual(result.manifest.channels, ['ryoma-ai-lab']);
        assert.ok((await stat(join(target, 'channels', 'ryoma-ai-lab', 'videos'))).isDirectory());
    });
});

test('createCreatorRoot: 冪等 — 既存 root.json がある場所への再実行は no-op で既存 manifest を返す', async () => {
    await withScratchRoot(async (scratch) => {
        const target = join(scratch, 'AkariVideo');
        const first = await createCreatorRoot(target);

        // ユーザーが akari.md を編集していても、二回目の呼び出しで上書きされないこと
        await writeFile(join(target, 'akari.md'), 'ユーザーが書き換えた内容\n', 'utf8');
        await writeFile(join(target, 'CLAUDE.md'), 'ユーザーが書き換えた CLAUDE.md\n', 'utf8');
        await writeFile(join(target, 'AGENTS.md'), 'ユーザーが書き換えた AGENTS.md\n', 'utf8');
        const customConnections = {
            providers: [],
            policy: { currency: 'USD', monthly_budget: 100, approval_threshold: 10 },
            memory: []
        };
        await writeFile(
            join(target, '.akari', 'connections.json'),
            `${JSON.stringify(customConnections, null, 2)}\n`,
            'utf8'
        );

        const second = await createCreatorRoot(target);
        assert.equal(second.created, false);
        assert.deepEqual(second.manifest, first.manifest);

        const akariMd = await readFile(join(target, 'akari.md'), 'utf8');
        assert.equal(akariMd, 'ユーザーが書き換えた内容\n');
        assert.equal(await readFile(join(target, 'CLAUDE.md'), 'utf8'), 'ユーザーが書き換えた CLAUDE.md\n');
        assert.equal(await readFile(join(target, 'AGENTS.md'), 'utf8'), 'ユーザーが書き換えた AGENTS.md\n');

        const connections = JSON.parse(await readFile(join(target, '.akari', 'connections.json'), 'utf8'));
        assert.deepEqual(connections, customConnections);
    });
});

test('createCreatorRoot: root.json が未知版で壊れている場所には上書きせずエラーを投げる', async () => {
    await withScratchRoot(async (scratch) => {
        const target = join(scratch, 'AkariVideo');
        await createCreatorRoot(target);
        const manifestPath = join(target, '.akari', 'root.json');
        const poisoned = JSON.stringify({ schema: 'creator-root/v99' });
        await writeFile(manifestPath, poisoned, 'utf8');

        await assert.rejects(createCreatorRoot(target), (error) => {
            assert.ok(error instanceof CreatorRootError);
            assert.equal(error.code, 'ROOT_MANIFEST_UNKNOWN_SCHEMA');
            return true;
        });

        const raw = await readFile(manifestPath, 'utf8');
        assert.equal(raw, poisoned);
    });
});
