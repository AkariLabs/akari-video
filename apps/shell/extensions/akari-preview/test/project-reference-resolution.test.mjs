import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AkariPreviewServiceImpl } from '../lib/node/akari-preview-service.js';
import { recordProjectReference } from '../../../../../packages/asset-resolver/src/project-references.mjs';

test('preview RPC は共通 node resolver で参照を URL 化し、実体を優先する', async t => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'preview-reference-')));
    const env = { AKARI_HOME: join(root, 'home'), AKARI_LIBRARY_ROOT: join(root, 'library'), AKARI_CREATOR_ROOT: join(root, 'creator') };
    const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
    Object.assign(process.env, env);
    t.after(async () => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } await rm(root, { recursive: true, force: true }); });
    const project = join(root, 'project'), directory = join(env.AKARI_LIBRARY_ROOT, 'still', 'image');
    await mkdir(project); await mkdir(directory, { recursive: true });
    const library = join(directory, 'image.png'); await writeFile(library, 'image');
    const service = new AkariPreviewServiceImpl();
    service.resolveWorkspaceRoots = async () => [project];
    const request = { projectRootUri: pathToFileURL(project).href, declaredPath: 'assets/still/image/image.png' };
    assert.equal(await service.resolveProjectAssetUri(request), undefined);
    await recordProjectReference(project, { category: 'still', id: 'image' });
    assert.equal(await service.resolveProjectAssetUri(request), pathToFileURL(library).href);
    const target = await service.resolveAssetStreamTarget({ assetUri: pathToFileURL(library).href });
    assert.equal(target.path, library);
    assert.deepEqual(target.workspaceRoots, [project, library]);
    const outsider = join(directory, 'not-referenced.png');
    await writeFile(outsider, 'extra');
    await rm(join(project, '.akari/asset-references.json'));
    await assert.rejects(service.resolveAssetStreamTarget({ assetUri: pathToFileURL(library).href }), /outside/);
    await recordProjectReference(project, { category: 'still', id: 'image' });
    const local = join(project, request.declaredPath); await mkdir(join(local, '..'), { recursive: true }); await writeFile(local, 'copy');
    assert.equal(await service.resolveProjectAssetUri(request), pathToFileURL(local).href);
    await assert.rejects(service.resolveProjectAssetUri({ ...request, declaredPath: 'assets/../../outside' }), /外/);
});

test('参照 HTML と依存画像のサムネイルへ解決済み URL を渡す', async t => {
    const { prepareVisualThumbnailPage } = await import('../lib/node/visual-thumbnail-page.js');
    const { resolveProjectAssetPath } = await import('../../../../../packages/asset-resolver/src/shell-reference.mjs');
    const root = await realpath(await mkdtemp(join(tmpdir(), 'thumbnail-reference-')));
    t.after(() => rm(root, { recursive: true, force: true }));
    const project = join(root, 'project'), directory = join(root, 'library/overlay/title');
    const env = { AKARI_HOME: join(root, 'home'), AKARI_LIBRARY_ROOT: join(root, 'library') };
    await mkdir(project); await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'fragment.html'), '<div data-duration="2"><img src="image.png"></div>');
    await writeFile(join(directory, 'image.png'), 'image');
    await recordProjectReference(project, { category: 'overlay', id: 'title' });
    const editPath = join(project, 'edit.json');
    const snapshot = JSON.stringify({ version: 2, output: { width: 640, height: 360, fps: 30 }, sources: [], tracks: [
        { id: 'v', lane: 'visual', items: [{ id: 'title', at: 0, duration: 60, source: { kind: 'html', path: 'assets/overlay/title/fragment.html' } }] }
    ] });
    const streams = [], assets = { runtimeJavaScriptUrl: 'runtime.js', captionFontUrl: 'font.ttf', threeJavaScriptUrl: 'three.js', threeTextJavaScriptUrl: 'text.js', threeRuntimeJavaScriptUrl: 'three-runtime.js' };
    const page = await prepareVisualThumbnailPage(editPath, 'title', assets,
        async uri => { streams.push(uri); return { id: 'image', url: 'http://localhost/resolved-image' }; }, async () => {}, snapshot,
        declared => resolveProjectAssetPath(project, declared, env));
    assert.deepEqual(streams, [pathToFileURL(join(directory, 'image.png')).href]);
    assert.match(page.html, /http:\/\/localhost\/resolved-image/);
    assert.ok(page.dependencyUris.includes(pathToFileURL(join(directory, 'fragment.html')).href));
    assert.equal(page.editSnapshot, snapshot);
});

test('まとめる・参照を外す際は edit.json 不変でもプレビューの配信 URL を再解決する', async () => {
    const { readFileSync } = await import('node:fs');
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const ts = require('typescript'), URI = require('@theia/core/lib/common/uri').default;
    const source = ts.createSourceFile('handler.ts', readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
    let initializer;
    const visit = node => {
        if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'handleFilesChanged') initializer = node.initializer.getText(source);
        ts.forEachChild(node, visit);
    };
    visit(source);
    assert.ok(initializer);
    const code = ts.transpileModule(`const handleFilesChanged = ${initializer};`, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
    const calls = [], editUri = new URI('file:///project/edit.json'), widget = { akariPreviewEditUri: editUri };
    const host = { resourceSuffix: uri => uri.path.base, queueRefresh: (...args) => calls.push(args) };
    const handler = new Function('widget', 'kind', 'identityUri', `${code}; return handleFilesChanged;`).call(host, widget, 'output', editUri);
    handler({ changes: [{ resource: new URI('file:///project/.akari/asset-references.json') }] });
    assert.deepEqual(calls, [[widget, editUri, 'output', undefined, true]]);
});
