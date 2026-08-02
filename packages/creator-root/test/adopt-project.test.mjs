import assert from 'node:assert/strict';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { CreatorRootError, adoptProject, createCreatorRoot, readRootManifest } from '../src/index.mjs';
import { withScratchRoot } from './helpers.mjs';

async function makeScaffoldedProject(dir) {
    await mkdir(join(dir, '.akari'), { recursive: true });
    // project-state.mjs の detectProjectState() が「scaffold 済み」と判定する基準と同じマーカー。
    await writeFile(join(dir, '.akari', 'connections.json'), JSON.stringify({ version: 1 }), 'utf8');
    await mkdir(join(dir, 'assets'), { recursive: true });
    await writeFile(join(dir, 'assets', 'clip.txt'), 'dummy footage marker\n', 'utf8');
}

test('adoptProject: 正常系 — 既定チャンネルの videos/ へ移動し、元位置には残らない', async () => {
    await withScratchRoot(async (scratch) => {
        const root = join(scratch, 'AkariVideo');
        await createCreatorRoot(root);

        const project = join(scratch, 'orphan-project');
        await makeScaffoldedProject(project);

        const result = await adoptProject(root, project);

        const destination = join(root, 'channels', 'my-channel', 'videos', 'orphan-project');
        assert.equal(result.destinationDir, destination);
        assert.equal(result.moveMethod, 'rename');
        assert.ok((await stat(destination)).isDirectory());
        assert.ok((await stat(join(destination, 'assets', 'clip.txt'))).isFile());
        assert.equal(await readFile(join(destination, 'assets', 'clip.txt'), 'utf8'), 'dummy footage marker\n');

        await assert.rejects(stat(project));

        const manifest = await readRootManifest(root);
        assert.deepEqual(manifest.channels, ['my-channel']);
    });
});

test('adoptProject: 未知のチャンネル名を指定すると root.json のチャンネル一覧に追加される', async () => {
    await withScratchRoot(async (scratch) => {
        const root = join(scratch, 'AkariVideo');
        await createCreatorRoot(root);

        const project = join(scratch, 'orphan-project-2');
        await makeScaffoldedProject(project);

        await adoptProject(root, project, { channel: 'second-channel' });

        const manifest = await readRootManifest(root);
        assert.deepEqual(manifest.channels, ['my-channel', 'second-channel']);

        const destination = join(root, 'channels', 'second-channel', 'videos', 'orphan-project-2');
        assert.ok((await stat(destination)).isDirectory());
    });
});

test('adoptProject: 同名衝突はエラー（宛先を上書きしない・元プロジェクトも移動しない）', async () => {
    await withScratchRoot(async (scratch) => {
        const root = join(scratch, 'AkariVideo');
        await createCreatorRoot(root);

        const destination = join(root, 'channels', 'my-channel', 'videos', 'dup-project');
        await mkdir(destination, { recursive: true });
        await writeFile(join(destination, 'marker.txt'), 'existing\n', 'utf8');

        const project = join(scratch, 'dup-project');
        await makeScaffoldedProject(project);

        await assert.rejects(adoptProject(root, project), (error) => {
            assert.ok(error instanceof CreatorRootError);
            assert.equal(error.code, 'ADOPT_DESTINATION_EXISTS');
            return true;
        });

        assert.ok((await stat(project)).isDirectory());
        const marker = await readFile(join(destination, 'marker.txt'), 'utf8');
        assert.equal(marker, 'existing\n');
    });
});

test('adoptProject: scaffold されていないフォルダは拒否する（.akari/connections.json 無し）', async () => {
    await withScratchRoot(async (scratch) => {
        const root = join(scratch, 'AkariVideo');
        await createCreatorRoot(root);

        const notAProject = join(scratch, 'just-a-folder');
        await mkdir(notAProject, { recursive: true });
        await writeFile(join(notAProject, 'readme.txt'), 'not a project\n', 'utf8');

        await assert.rejects(adoptProject(root, notAProject), (error) => {
            assert.ok(error instanceof CreatorRootError);
            assert.equal(error.code, 'ADOPT_NOT_A_PROJECT');
            return true;
        });

        assert.ok((await stat(notAProject)).isDirectory());
    });
});

test('adoptProject: 作業場自体が無効（root.json 不在）ならエラーで、プロジェクトは移動しない', async () => {
    await withScratchRoot(async (scratch) => {
        const notARoot = join(scratch, 'not-a-root');
        await mkdir(notARoot, { recursive: true });

        const project = join(scratch, 'orphan-3');
        await makeScaffoldedProject(project);

        await assert.rejects(adoptProject(notARoot, project), (error) => {
            assert.ok(error instanceof CreatorRootError);
            assert.equal(error.code, 'ROOT_MANIFEST_NOT_FOUND');
            return true;
        });

        assert.ok((await stat(project)).isDirectory());
    });
});
