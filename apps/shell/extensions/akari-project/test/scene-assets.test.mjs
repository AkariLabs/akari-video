import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { addSceneFromLauncher, importCommonAsset, importCommonSceneAsset, unlinkedCommonAssetUris,
    sceneLauncherAssetCandidates, selectSceneLauncherAssets } = await import('../lib/node/scene-assets.js');

test('scene launcher assets select development and app.asar layouts from upward candidates', () => {
    for (const [root, moduleName, templateName] of [
        ['/work/repo', 'packages/project-scaffold/src/index.mjs', 'templates/project-default'],
        ['/app/app.asar', 'lib/packages/project-scaffold/src/index.mjs', 'lib/templates/project-default']
    ]) {
        const candidates = sceneLauncherAssetCandidates([path.join(root, 'node_modules/akari-project/lib/node')]);
        const scaffoldModulePath = path.join(root, moduleName);
        const templateDir = path.join(root, templateName);
        assert.deepEqual(selectSceneLauncherAssets(candidates, new Set([scaffoldModulePath]), new Set([templateDir])),
            { scaffoldModulePath, templateDir });
    }
});

async function fixture(run) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'akari-scene-'));
    const scene = path.join(root, 'scenes', 's01');
    const source = path.join(root, 'assets', 'clip.mp4');
    try {
        await fs.mkdir(path.join(root, '.akari'));
        await fs.mkdir(path.dirname(source));
        await fs.mkdir(scene, { recursive: true });
        await fs.writeFile(source, 'video');
        await run({ root, scene, source });
    } finally { await fs.rm(root, { recursive: true, force: true }); }
}

test('a second use returns the same hard link and hides its shared row', async () => fixture(async ({ scene, source }) => {
    const sourceUri = pathToFileURL(source).href;
    assert.deepEqual(await unlinkedCommonAssetUris(pathToFileURL(scene).href, [sourceUri]), [sourceUri]);
    const first = await importCommonAsset(scene, source);
    const second = await importCommonAsset(scene, source);
    assert.equal(first, 'assets/clip.mp4');
    assert.equal(second, first);
    assert.equal((await fs.stat(source)).ino, (await fs.stat(path.join(scene, first))).ino);
    assert.deepEqual(await unlinkedCommonAssetUris(pathToFileURL(scene).href, [sourceUri]), []);
}));

test('a different file at the same name gets -2, then reuses -2', async () => fixture(async ({ scene, source }) => {
    await fs.mkdir(path.join(scene, 'assets'));
    await fs.writeFile(path.join(scene, 'assets', 'clip.mp4'), 'other');
    assert.equal(await importCommonAsset(scene, source), 'assets/clip-2.mp4');
    assert.equal(await importCommonAsset(scene, source), 'assets/clip-2.mp4');
    assert.equal(await fs.readFile(path.join(scene, 'assets', 'clip.mp4'), 'utf8'), 'other');
}));

test('EXDEV copy is reused on the next use when size and content match', async () => fixture(async ({ scene, source }) => {
    const dependencies = {
        link: async () => { const error = new Error('cross-device'); error.code = 'EXDEV'; throw error; },
        copyFile: fs.copyFile
    };
    const first = await importCommonAsset(scene, source, dependencies);
    const second = await importCommonAsset(scene, source, dependencies);
    assert.equal(first, 'assets/clip.mp4');
    assert.equal(second, first);
    assert.equal(await fs.readFile(path.join(scene, first), 'utf8'), 'video');
    assert.notEqual((await fs.stat(source)).ino, (await fs.stat(path.join(scene, first))).ino);
}));

test('manifest reuses the asset node by where and adds one scene edge', async () => fixture(async ({ root, scene, source }) => {
    const manifestPath = path.join(root, '.akari', 'manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify({ version: 0, kind: 'akari-project-manifest', nodes: [
        { id: 'scene:s01', kind: 'scene', rev: 0, where: 'scenes/s01' },
        { id: 'asset:video/existing', kind: 'asset', rev: 2, where: 'assets/clip.mp4', category: 'video' }
    ], edges: [] }));
    const sceneUri = pathToFileURL(scene).href;
    const sourceUri = pathToFileURL(source).href;
    assert.equal(await importCommonSceneAsset(sceneUri, sourceUri), 'assets/clip.mp4');
    assert.equal(await importCommonSceneAsset(sceneUri, sourceUri), 'assets/clip.mp4');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    assert.deepEqual(manifest.edges, [{ from: 'scene:s01', uses: 'asset:video/existing' }]);
    assert.equal(manifest.nodes.filter(node => node.kind === 'asset').length, 1);
}));

test('manifest reuses an asset node by category and id without where', async () => fixture(async ({ root, scene, source }) => {
    const manifestPath = path.join(root, '.akari', 'manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify({ version: 0, kind: 'akari-project-manifest', nodes: [
        { id: 'scene:s01', kind: 'scene', rev: 0, where: 'scenes/s01' },
        { id: 'asset:video/clip', kind: 'asset', rev: 1, category: 'video' }
    ], edges: [] }));
    await importCommonSceneAsset(pathToFileURL(scene).href, pathToFileURL(source).href);
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    assert.deepEqual(manifest.edges, [{ from: 'scene:s01', uses: 'asset:video/clip' }]);
    assert.equal(manifest.nodes.filter(node => node.kind === 'asset').length, 1);
}));

test('import leaves an absent manifest absent', async () => fixture(async ({ root, scene, source }) => {
    assert.equal(await importCommonSceneAsset(pathToFileURL(scene).href, pathToFileURL(source).href), 'assets/clip.mp4');
    await assert.rejects(fs.stat(path.join(root, '.akari', 'manifest.json')), { code: 'ENOENT' });
}));

test('launcher failure exposes stderr from the child process', async () => fixture(async ({ root }) => {
    await assert.rejects(addSceneFromLauncher(pathToFileURL(root).href, 'Bad ID'), error =>
        error.message.includes('project-command.mjs') && error.message.includes('Error:'));
}));

test('scene launcher passes resolved assets to the child process', async () => fixture(async ({ root }) => {
    const sceneUri = await addSceneFromLauncher(pathToFileURL(root).href, 's02');
    assert.equal(sceneUri, pathToFileURL(path.join(root, 'scenes', 's02')).href);
    assert.equal(JSON.parse(await fs.readFile(path.join(root, 'scenes', 's02', 'edit.json'), 'utf8')).version, 2);
}));
