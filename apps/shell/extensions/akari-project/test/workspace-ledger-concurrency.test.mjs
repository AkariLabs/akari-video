import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { AkariWorkspaceServer } = require('../lib/node/akari-workspace-server.js');
const { DefaultWorkspaceServer } = require('@theia/workspace/lib/node/default-workspace-server.js');
const { Deferred } = require('@theia/core/lib/common/promise-util.js');
const { parse: parseJsonc } = require('jsonc-parser');

// 台帳（recentworkspace.json）の置き場と、実在するプロジェクトを 2 本用意する。
async function fixture(t) {
    const base = await mkdtemp(join(tmpdir(), 'akari-workspace-ledger-'));
    t.after(() => rm(base, { recursive: true, force: true }));
    const config = join(base, 'config');
    const a = join(base, '2026-08-24-new-video');
    const b = join(base, '2026-08-30-new-video-2');
    await Promise.all([mkdir(config, { recursive: true }), mkdir(a), mkdir(b)]);
    return { base, config, ledger: join(config, 'recentworkspace.json'), a: pathToFileURL(a).toString(), b: pathToFileURL(b).toString() };
}

function serverFor(Server, { config }) {
    const server = new Server();
    server.root = new Deferred();
    server.root.resolve(undefined);
    server.envServer = { getConfigDirUri: async () => pathToFileURL(config).toString() };
    server.cliParams = { workspaceRoot: { promise: Promise.resolve(undefined) } };
    server.workspaceHandlers = {
        getContributions: () => [{ canHandle: uri => uri.scheme === 'file', workspaceStillExists: async () => true }]
    };
    return server;
}

// 2 ウィンドウが同じ tick で MRU を書く形（片方が開き直し / 片方が終了時の onWillStop）。
async function raceTwoWindows(server, { a, b }) {
    await server.setMostRecentlyUsedWorkspace(a);
    await server.setMostRecentlyUsedWorkspace(b);
    await Promise.all([server.setMostRecentlyUsedWorkspace(a), server.setMostRecentlyUsedWorkspace(b)]);
}

test('(a) 既定の台帳は同時書き込みで開いているプロジェクトの行を落とす（回帰の出所）', async t => {
    const data = await fixture(t);
    const server = serverFor(DefaultWorkspaceServer, data);
    await raceTwoWindows(server, data);
    await new Promise(resolve => setTimeout(resolve, 100));
    const raw = await readFile(data.ledger, 'utf8');
    const recentRoots = parseJsonc(raw).recentRoots ?? [];
    // 既定実装は read-modify-write に排他が無いので、開いている 2 本のどちらかが必ず消える。
    assert.ok(!recentRoots.includes(data.a) || !recentRoots.includes(data.b), `既定実装で両方残った: ${raw}`);
});

test('(b) 差し替え後は同時書き込みでも開いている root が台帳から消えない', async t => {
    const data = await fixture(t);
    const server = serverFor(AkariWorkspaceServer, data);
    await raceTwoWindows(server, data);
    const recentRoots = await server.getRecentWorkspaces();
    assert.ok(recentRoots.includes(data.a), `a が台帳から消えた: ${JSON.stringify(recentRoots)}`);
    assert.ok(recentRoots.includes(data.b), `b が台帳から消えた: ${JSON.stringify(recentRoots)}`);
});

test('(c) 差し替え後の台帳は常に JSON として完全（末尾に前の内容が残らない）', async t => {
    const data = await fixture(t);
    const server = serverFor(AkariWorkspaceServer, data);
    for (let round = 0; round < 20; round += 1) {
        await Promise.all([server.setMostRecentlyUsedWorkspace(data.a), server.setMostRecentlyUsedWorkspace(data.b)]);
        const raw = await readFile(data.ledger, 'utf8');
        // JSON.parse は jsonc-parser と違い末尾のゴミを見逃さない。
        assert.doesNotThrow(() => JSON.parse(raw), `台帳が壊れた (round ${round}): ${JSON.stringify(raw)}`);
    }
    // 原子的置換の一時ファイルを置き去りにしない。
    assert.deepEqual((await readdir(data.config)).filter(name => name.endsWith('.tmp')), []);
});

test('(d) ワークスペースを閉じても（空文字）台帳の履歴は落ちない', async t => {
    const data = await fixture(t);
    const server = serverFor(AkariWorkspaceServer, data);
    await server.setMostRecentlyUsedWorkspace(data.a);
    await server.setMostRecentlyUsedWorkspace('');
    assert.equal(await server.getMostRecentlyUsedWorkspace(), '');
    assert.deepEqual(await server.getRecentWorkspaces(), [data.a]);
    assert.deepEqual(JSON.parse(await readFile(data.ledger, 'utf8')).recentRoots, [data.a]);
});

test('(e) 明示的に消したワークスペースは台帳から消えたままになる', async t => {
    const data = await fixture(t);
    const server = serverFor(AkariWorkspaceServer, data);
    await server.setMostRecentlyUsedWorkspace(data.a);
    await server.setMostRecentlyUsedWorkspace(data.b);
    await server.removeRecentWorkspace(data.a);
    assert.deepEqual(await server.getRecentWorkspaces(), [data.b]);
});
