import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { AkariPreviewServiceImpl } = require('../lib/node/akari-preview-service.js');
const assets = { runtimeJavaScriptUrl: 'runtime.js', captionFontUrl: 'font.ttf',
    threeJavaScriptUrl: 'three.js', threeTextJavaScriptUrl: 'text.js', threeRuntimeJavaScriptUrl: 'three-runtime.js' };
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6pN8AAAAASUVORK5CYII=';

async function fixture(t) {
    const base = await mkdtemp(join(tmpdir(), 'akari-preview-window-roots-'));
    t.after(() => rm(base, { recursive: true, force: true }));
    await mkdir(join(base, 'a', 'assets'), { recursive: true });
    const a = await realpath(join(base, 'a'));
    const b = join(base, 'b');
    const c = join(base, 'c');
    await Promise.all([mkdir(b), mkdir(c)]);
    const htmlPath = join(a, 'assets', 'title.html');
    const imagePath = join(a, 'assets', 'a.png');
    const editPath = join(a, 'edit.json');
    const editSnapshot = JSON.stringify({ version: 2, output: { width: 1080, height: 1920, fps: 24 }, sources: [],
        tracks: [{ id: 'v', lane: 'visual', items: [
            { id: 'asset', at: 0, duration: 192, source: { kind: 'html', path: 'assets/title.html' } }
        ] }] });
    await Promise.all([
        writeFile(htmlPath, '<div data-duration="8">TITLE</div>'),
        writeFile(imagePath, Buffer.from(png.slice('data:image/png;base64,'.length), 'base64')),
        writeFile(editPath, editSnapshot)
    ]);
    const service = new AkariPreviewServiceImpl();
    service.workspaceServer = {
        getMostRecentlyUsedWorkspace: async () => pathToFileURL(b).href,
        getRecentWorkspaces: async () => [pathToFileURL(b).href, pathToFileURL(a).href]
    };
    service.ensureServer = async () => 43123;
    service.getOverlayRuntimeAssetUrls = async () => assets;
    service.loadReferenceModule = async () => ({ resolveProjectAssetPath: async (root, declaredPath) =>
        realpath(join(root, declaredPath)) });
    return { service, a, b, c, htmlPath, imagePath, editPath, editSnapshot,
        roots: [pathToFileURL(a).href] };
}

test('preview RPCs use the requesting window root when another project is MRU', async t => {
    const data = await fixture(t);
    const { service, a, htmlPath, imagePath, editPath, editSnapshot, roots } = data;
    const projectRootUri = pathToFileURL(a).href;
    const declaredPath = 'assets/title.html';
    assert.equal(await service.resolveProjectAssetUri({ projectRootUri, declaredPath, workspaceRoots: roots }),
        pathToFileURL(htmlPath).href);

    const thumbnail = await service.prepareVisualThumbnail({ editUri: pathToFileURL(editPath).href,
        itemId: 'asset', editSnapshot, workspaceRoots: roots });
    assert.match(thumbnail.html, /TITLE/);
    assert.equal(thumbnail.editSnapshot, editSnapshot);

    const frame = await service.savePreviewFrame({ editUri: pathToFileURL(editPath).href,
        time: 1, image: png, workspaceRoots: roots });
    assert.match(frame.path, /^assets\/captures\//);

    const material = await service.prepareAssetVisualThumbnail({ assetUri: pathToFileURL(htmlPath).href,
        workspaceRoots: roots });
    assert.equal(material.assetUri, pathToFileURL(htmlPath).href);
    assert.match(material.html, /TITLE/);

    const legacy = await service.prepareLegacyEdit({ editUri: pathToFileURL(editPath).href,
        workspaceRoots: roots });
    assert.ok(legacy && typeof legacy === 'object');

    const fragment = await service.rewriteFragmentAssets({ projectRootUri, htmlPath: 'overlay.html', overlayId: 'overlay',
        html: '<img src="assets/a.png">', workspaceRoots: roots });
    assert.deepEqual(fragment.warnings, []);
    assert.equal(fragment.streams.length, 1);
    assert.equal(fragment.streams[0].uri, pathToFileURL(imagePath).href);
    await service.disposeAssetStream(fragment.streams[0].id);
});

test('preview RPCs reject roots absent from the workspace ledger', async t => {
    const data = await fixture(t);
    const { service, a, c, htmlPath, editPath, editSnapshot } = data;
    const roots = [pathToFileURL(c).href];
    const denied = /The requested workspace root is not an open workspace/u;
    await assert.rejects(service.resolveProjectAssetUri({ projectRootUri: pathToFileURL(a).href,
        declaredPath: 'assets/title.html', workspaceRoots: roots }), denied);
    await assert.rejects(service.prepareVisualThumbnail({ editUri: pathToFileURL(editPath).href,
        itemId: 'asset', editSnapshot, workspaceRoots: roots }), denied);
    await assert.rejects(service.savePreviewFrame({ editUri: pathToFileURL(editPath).href,
        time: 1, image: png, workspaceRoots: roots }), denied);
    await assert.rejects(service.prepareAssetVisualThumbnail({ assetUri: pathToFileURL(htmlPath).href,
        workspaceRoots: roots }), denied);
    await assert.rejects(service.prepareLegacyEdit({ editUri: pathToFileURL(editPath).href,
        workspaceRoots: roots }), denied);
    await assert.rejects(service.rewriteFragmentAssets({ projectRootUri: pathToFileURL(a).href,
        htmlPath: 'overlay.html', overlayId: 'overlay', html: '<img src="assets/a.png">', workspaceRoots: roots }), denied);
});
