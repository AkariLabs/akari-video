import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, realpath, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareAssetVisualThumbnailPage, prepareVisualThumbnailPage } from '../lib/node/visual-thumbnail-page.js';
import { visualThumbnailKey } from '../lib/common/visual-thumbnail-key.js';
const assets = { runtimeJavaScriptUrl: 'runtime.js', captionFontUrl: 'font.ttf', threeJavaScriptUrl: 'three.js', threeTextJavaScriptUrl: 'text.js', threeRuntimeJavaScriptUrl: 'three-runtime.js' };
const createStream = async () => ({ id: 'image', url: 'http://localhost/image' });
const disposeStream = async () => {};
async function fixture(t) {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'asset-visual-')));
    t.after(() => rm(root, { recursive: true, force: true }));
    return root;
}
const mount = page => JSON.parse(page.html.match(/await runtime\.mount\((.*)\);/)[1]);

test('asset and timeline use the same page, project output and default CSS variables', async t => {
    const root = await fixture(t);
    await mkdir(join(root, 'assets'));
    const path = join(root, 'assets/title.html');
    await writeFile(path, '<style>.title{color:var(--ink,red)}</style><div data-duration="8" class="title">TITLE</div>');
    const editPath = join(root, 'edit.json');
    await writeFile(editPath, JSON.stringify({ version: 2, output: { width: 1080, height: 1920, fps: 24 }, sources: [], tracks: [
        { id: 'v', lane: 'visual', items: [{ id: 'asset', at: 0, duration: 192, source: { kind: 'html', path: 'assets/title.html' } }] }
    ] }));
    const asset = await prepareAssetVisualThumbnailPage(path, root, undefined, assets, createStream, disposeStream);
    const timeline = await prepareVisualThumbnailPage(editPath, 'asset', assets, createStream, disposeStream);
    assert.equal(asset.duration, 8); assert.equal(asset.time, 4);
    assert.equal(asset.width, 180); assert.equal(asset.height, 320);
    assert.ok(asset.mtime > 0); assert.ok(asset.size > 0);
    assert.deepEqual(mount(asset).output, mount(timeline).output);
    assert.equal(mount(asset).overlays[0].html, mount(timeline).overlays[0].html);
    assert.equal(mount(asset).overlays[0].materialOverrides, undefined);
    assert.match(asset.html, /runtime.tick\(4,false\)/);
    const hover = await prepareAssetVisualThumbnailPage(path, root, 0.8, assets, createStream, disposeStream);
    assert.match(hover.html, /runtime.tick\(0.8,false\)/);
});

test('groups resolve directory/meta.json and missing duration/output default to 5s/1080p', async t => {
    const root = await fixture(t);
    await mkdir(join(root, 'group'));
    await writeFile(join(root, 'group/meta.json'), '{}');
    await writeFile(join(root, 'group/overlay.html'), '<div><span data-duration="90">DEFAULT</span></div>');
    for (const path of [join(root, 'group'), join(root, 'group/meta.json')]) {
        const page = await prepareAssetVisualThumbnailPage(path, root, undefined, assets, createStream, disposeStream);
        assert.equal(page.duration, 5); assert.equal(page.time, 2.5);
        assert.equal(page.width, 480); assert.equal(page.height, 270);
        assert.ok(page.assetUri.endsWith('/group/overlay.html'));
    }
});

test('file relative dependencies are rewritten and their streams released on failure', async t => {
    const root = await fixture(t);
    await mkdir(join(root, 'assets'));
    const path = join(root, 'assets/overlay.html');
    await writeFile(join(root, 'assets/image.png'), 'image');
    await writeFile(path, '<div data-duration=5><img src="image.png"></div>');
    const page = await prepareAssetVisualThumbnailPage(path, root, undefined, assets, createStream, disposeStream);
    assert.deepEqual(page.streamIds, ['image']);
    assert.match(page.html, /http:\/\/localhost\/image/);
    await writeFile(path, '<div><img src="image.png"><img src="missing.png"></div>');
    const released = [];
    await assert.rejects(prepareAssetVisualThumbnailPage(path, root, undefined, assets, createStream, async id => released.push(id)));
    assert.deepEqual(released, ['image']);
});

test('rejects outside files, symlink escapes, non-HTML groups and invalid times', async t => {
    const root = await fixture(t), outside = await fixture(t);
    await writeFile(join(outside, 'outside.html'), '<div>OUT</div>');
    await writeFile(join(root, 'inside.html'), '<div>IN</div>');
    await symlink(join(outside, 'outside.html'), join(root, 'escape.html'));
    for (const path of [join(outside, 'outside.html'), join(root, 'escape.html')]) {
        await assert.rejects(prepareAssetVisualThumbnailPage(path, root, undefined, assets, createStream, disposeStream), /outside/);
    }
    for (const time of [-1, NaN, Infinity, 5]) await assert.rejects(prepareAssetVisualThumbnailPage(join(root, 'inside.html'), root, time, assets, createStream, disposeStream), /time/);
    await mkdir(join(root, 'empty'));
    await assert.rejects(prepareAssetVisualThumbnailPage(join(root, 'empty'), root, undefined, assets, createStream, disposeStream), /no HTML/);
});

test('asset midpoint keys track file revisions', () => {
    const key = visualThumbnailKey('file:///asset.html', 't=2.5', [10, 20]);
    assert.equal(key, visualThumbnailKey('file:///asset.html', `t=${5 / 2}`, [10, 20]));
    assert.notEqual(key, visualThumbnailKey('file:///asset.html', 't=2.5', [11, 20]));
    assert.notEqual(key, visualThumbnailKey('file:///asset.html', 't=0.5', [10, 20]));
});


test('asset preparation only needs output settings, with absent fields using defaults', async t => {
    const root = await fixture(t);
    const path = join(root, 'card.html');
    await writeFile(path, '<div>ASSET</div>');
    for (const output of [undefined, { width: 720, height: 1280, fps: 24 }]) {
        await writeFile(join(root, 'edit.json'), JSON.stringify({ version: 2, output, tracks: null }));
        const page = await prepareAssetVisualThumbnailPage(path, root, undefined, assets, createStream, disposeStream);
        assert.deepEqual(mount(page).output, output ?? { width: 1920, height: 1080, fps: 30 });
    }
});
