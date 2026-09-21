import assert from 'node:assert/strict';
import test from 'node:test';
import { cp, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { previewFrameFilename, previewFrameCaptureRect } from '../lib/common/preview-frame-capture.js';
import { writePreviewFrame } from '../lib/node/preview-frame-writer.js';
import { loadAndBuildGpuPage } from '../../../../../packages/gpu-export/src/page-builder.mjs';
import { loadAndBuildOsrPage } from '../../../../../packages/osr-export/src/page-builder.mjs';
import { prepareVisualThumbnailPage } from '../lib/node/visual-thumbnail-page.js';

const here = dirname(fileURLToPath(import.meta.url));
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const scratch = async t => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'preview-frame-test-')));
    t.after(() => rm(root, { recursive: true, force: true }));
    return root;
};

test('frame filename rounds to milliseconds, carries minutes, and numbers collisions', () => {
    assert.equal(previewFrameFilename(12.345), 'frame-00m12s345.png');
    assert.equal(previewFrameFilename(12.345, 2), 'frame-00m12s345-2.png');
    assert.equal(previewFrameFilename(12.345, 3), 'frame-00m12s345-3.png');
    assert.equal(previewFrameFilename(59.9996), 'frame-01m00s000.png');
    assert.equal(previewFrameFilename(6000), 'frame-100m00s000.png');
    for (const time of [-1, NaN, Infinity, Number.MAX_VALUE]) assert.throws(() => previewFrameFilename(time));
    for (const ordinal of [0, -1, 1.5, NaN]) assert.throws(() => previewFrameFilename(0, ordinal));
});

test('capture rectangle excludes partial outside pixels and rejects invalid geometry', () => {
    assert.deepEqual(previewFrameCaptureRect({ x: 12.3, y: 4.7, width: 101.2, height: 51.8 }), { x: 13, y: 5, width: 100, height: 51 });
    for (const rect of [null, { x: -1, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: Infinity, height: 1 }]) {
        assert.throws(() => previewFrameCaptureRect(rect));
    }
});

test('concurrent saves create distinct files, preserve bytes, and do not create meta.json', async t => {
    const root = await scratch(t);
    const results = await Promise.all([writePreviewFrame(root, 12.345, png), writePreviewFrame(root, 12.345, png)]);
    assert.deepEqual(results.map(r => r.path).sort(), ['assets/captures/frame-00m12s345-2.png', 'assets/captures/frame-00m12s345.png']);
    assert.equal((await readdir(join(root, 'assets/captures'))).length, 2);
    assert.deepEqual(await readFile(join(root, results[0].path)), Buffer.from(png.split(',')[1], 'base64'));
});

test('save rejects symlink directory escapes and malformed payload before writing', async t => {
    const root = await scratch(t), outside = await scratch(t);
    await symlink(outside, join(root, 'assets'), 'dir');
    await assert.rejects(writePreviewFrame(root, 0, png), /real directory/);
    assert.deepEqual(await readdir(outside), []);
    const empty = await scratch(t);
    await assert.rejects(writePreviewFrame(empty, -1, png), /Invalid frame time/);
    await assert.rejects(writePreviewFrame(empty, 1, 'data:image/png;base64,ZmFrZQ=='), /header/);
    assert.deepEqual(await readdir(empty), []);
});

test('an existing filename symlink is a collision, never an overwrite', async t => {
    const root = await scratch(t);
    await writePreviewFrame(root, 0, png);
    const target = join(root, 'keep.txt');
    await writeFile(target, 'keep');
    await symlink(target, join(root, 'assets/captures/frame-00m00s000-2.png'));
    assert.equal((await writePreviewFrame(root, 0, png)).path, 'assets/captures/frame-00m00s000-3.png');
    assert.equal(await readFile(target, 'utf8'), 'keep');
});

const noCamera = html => {
    if (typeof html !== 'string') return;
    assert.equal(html.includes('akari-gen-capture-frame'), false);
    assert.equal(html.includes('akari-gen-captur'), false);
    assert.equal(html.includes('akari-gen-capture-flash'), false);
};
test('GPU and OSR export HTML contain zero camera ids/classes', async t => {
    const projectRoot = await scratch(t);
    await cp(join(here, 'fixtures/generation-overlays'), projectRoot, { recursive: true });
    for (const build of [loadAndBuildGpuPage, loadAndBuildOsrPage]) {
        const page = await build({ projectRoot, duration: 14 });
        noCamera(page.html);
        noCamera(page.overlaySheetHtml);
    }
});

test('visual thumbnail HTML contains zero camera ids/classes', async t => {
    const root = await scratch(t);
    await writeFile(join(root, 'thumbnail.html'), '<div data-duration="2">thumbnail</div>');
    const editPath = join(root, 'edit.json');
    await writeFile(editPath, JSON.stringify({ version: 2, output: { width: 1920, height: 1080, fps: 30 }, sources: [],
        tracks: [{ id: 'visual', lane: 'visual', items: [{ id: 'thumbnail', at: 0, duration: 60,
            source: { kind: 'html', path: 'thumbnail.html' } }] }] }));
    const assets = Object.fromEntries(['origin', 'runtimeJavaScriptUrl', 'captionFontUrl', 'threeJavaScriptUrl', 'threeTextJavaScriptUrl', 'threeRuntimeJavaScriptUrl']
        .map(key => [key, 'http://127.0.0.1:1/asset']));
    const page = await prepareVisualThumbnailPage(editPath, 'thumbnail', assets,
        async uri => ({ id: uri, url: 'http://127.0.0.1:1/asset' }), async () => undefined);
    noCamera(page.html);
});
