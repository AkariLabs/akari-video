import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import { AkariPreviewServiceImpl } from '../lib/node/akari-preview-service.js';

async function fixture(t) {
    const base = await mkdtemp(join(tmpdir(), 'generation-sidecars-'));
    t.after(() => rm(base, { recursive: true, force: true }));
    const project = join(base, 'project');
    const outside = join(base, 'outside');
    await Promise.all([mkdir(join(project, 'assets'), { recursive: true }), mkdir(outside)]);
    const rootUri = pathToFileURL(project).toString();
    const service = new AkariPreviewServiceImpl();
    service.workspaceServer = {
        getMostRecentlyUsedWorkspace: async () => rootUri,
        getRecentWorkspaces: async () => [rootUri]
    };
    return { base, project, outside, rootUri, service };
}

test('v2 の sources、source.src、source.path を重複なしで読み、欠損と壊れた JSON は null にする', async t => {
    const data = await fixture(t);
    const edit = {
        version: 2,
        sources: [
            { id: 'planned', path: 'assets/planned.png' },
            { id: 'bad', path: 'assets/bad.png' },
            { id: 'missing', path: 'assets/missing.png' }
        ],
        tracks: [{ id: 'v', lane: 'visual', items: [
            { id: 'a', source: { kind: 'media', src: 'planned' } },
            { id: 'b', source: { kind: 'media', path: 'assets/direct.mp4' } }
        ] }]
    };
    await Promise.all([
        writeFile(join(data.project, 'edit.json'), JSON.stringify(edit)),
        writeFile(join(data.project, 'assets/planned.png.meta.json'), JSON.stringify({ status: 'planned' })),
        writeFile(join(data.project, 'assets/bad.png.meta.json'), '{broken'),
        writeFile(join(data.project, 'assets/direct.mp4.meta.json'), JSON.stringify({ status: 'done' }))
    ]);
    const result = await data.service.readGenerationSidecars({
        editUri: pathToFileURL(join(data.project, 'edit.json')).toString(),
        workspaceRoots: [data.rootUri]
    });
    assert.deepEqual(result.entries.map(entry => entry.sourcePath), [
        'assets/planned.png', 'assets/bad.png', 'assets/missing.png', 'assets/direct.mp4'
    ]);
    assert.deepEqual(result.entries.map(entry => entry.meta), [
        { status: 'planned' }, null, null, { status: 'done' }
    ]);
    assert.ok(result.entries[0].mtimeMs > 0);
    assert.ok(result.entries[1].mtimeMs > 0);
    assert.equal(result.entries[2].mtimeMs, null);
});

test('v2 item の name を id ごとに返し、name の無い item は itemNames に含めない', async t => {
    const data = await fixture(t);
    const editPath = join(data.project, 'edit.json');
    await writeFile(editPath, JSON.stringify({
        version: 2,
        sources: [],
        tracks: [{ id: 'v', lane: 'visual', items: [
            {
                id: 'named', name: 'ビート 1', source: { kind: 'group' }, items: [
                    { id: 'nested', name: '子クリップ', source: { kind: 'media', path: 'assets/nested.mp4' } }
                ]
            },
            { id: 'unnamed', source: { kind: 'media', path: 'assets/unnamed.mp4' } }
        ] }]
    }));
    const result = await data.service.readGenerationSidecars({
        editUri: pathToFileURL(editPath).toString(), workspaceRoots: [data.rootUri]
    });
    assert.deepEqual(result.itemNames, { named: 'ビート 1', nested: '子クリップ' });
    assert.equal(Object.hasOwn(result.itemNames, 'unnamed'), false);
});

test('1 MB 超、ワークスペース外、symlink のサイドカーを読まない', async t => {
    const data = await fixture(t);
    const outsideMeta = join(data.outside, 'escape.mp4.meta.json');
    await Promise.all([
        writeFile(join(data.project, 'edit.json'), JSON.stringify({
            version: 2,
            sources: [
                { id: 'large', path: 'assets/large.mp4' },
                { id: 'escape', path: '../outside/escape.mp4' },
                { id: 'link', path: 'assets/link.mp4' }
            ]
        })),
        writeFile(join(data.project, 'assets/large.mp4.meta.json'), Buffer.alloc(1024 * 1024 + 1, 32)),
        writeFile(outsideMeta, JSON.stringify({ status: 'done' }))
    ]);
    await symlink(outsideMeta, join(data.project, 'assets/link.mp4.meta.json'));
    const result = await data.service.readGenerationSidecars({
        editUri: pathToFileURL(join(data.project, 'edit.json')).toString(),
        workspaceRoots: [data.rootUri]
    });
    assert.deepEqual(result.entries.map(entry => entry.meta), [null, null, null]);
    assert.ok(result.entries[0].mtimeMs > 0);
    assert.equal(result.entries[1].mtimeMs, null);
    assert.equal(result.entries[2].mtimeMs, null);
});

test('v0 / v1 / v2 の edit.json を例外なく扱う', async t => {
    const data = await fixture(t);
    const editPath = join(data.project, 'edit.json');
    for (const edit of [
        { source: { path: 'legacy.mp4' } },
        { version: 1, sources: [{ id: 'one', path: 'assets/one.mp4' }], cuts: [] },
        { version: 2, sources: [], tracks: [] }
    ]) {
        await writeFile(editPath, JSON.stringify(edit));
        await assert.doesNotReject(data.service.readGenerationSidecars({
            editUri: pathToFileURL(editPath).toString(), workspaceRoots: [data.rootUri]
        }));
    }
});
