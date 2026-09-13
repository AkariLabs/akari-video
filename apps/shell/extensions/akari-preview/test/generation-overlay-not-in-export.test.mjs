import assert from 'node:assert/strict';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { loadAndBuildGpuPage } from '../../../../../packages/gpu-export/src/page-builder.mjs';
import { loadAndBuildOsrPage } from '../../../../../packages/osr-export/src/page-builder.mjs';
import { prepareVisualThumbnailPage } from '../lib/node/visual-thumbnail-page.js';

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'generation-overlays');
const assets = {
    origin: 'http://127.0.0.1:1',
    runtimeJavaScriptUrl: 'http://127.0.0.1:1/runtime.js',
    captionFontUrl: 'http://127.0.0.1:1/font.ttf',
    threeJavaScriptUrl: 'http://127.0.0.1:1/three.js',
    threeTextJavaScriptUrl: 'http://127.0.0.1:1/three-text.js',
    threeRuntimeJavaScriptUrl: 'http://127.0.0.1:1/three-runtime.js'
};
const assertNoGenerationOverlay = (value, label) => {
    if (typeof value !== 'string') return;
    assert.equal(value.split('akari-gen-overlay').length - 1, 0, `${label}: akari-gen-overlay`);
    assert.equal(value.split('akari-gen-').length - 1, 0, `${label}: akari-gen-`);
};

test('GPU / OSR の生成ページと同時生成 HTML に生成オーバーレイが 0 件', async t => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'generation-export-page-'));
    t.after(() => rm(projectRoot, { recursive: true, force: true }));
    await cp(fixtureRoot, projectRoot, { recursive: true });
    const gpu = await loadAndBuildGpuPage({ projectRoot, duration: 14 });
    const osr = await loadAndBuildOsrPage({ projectRoot, duration: 14 });
    for (const [label, page] of [['gpu', gpu], ['osr', osr]]) {
        assertNoGenerationOverlay(page.html, `${label}.html`);
        assertNoGenerationOverlay(page.overlaySheetHtml, `${label}.overlaySheetHtml`);
    }
});

test('visual thumbnail のページ HTML に生成オーバーレイが 0 件', async t => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'generation-thumbnail-page-'));
    t.after(() => rm(projectRoot, { recursive: true, force: true }));
    await writeFile(join(projectRoot, 'thumbnail.html'), '<div data-duration="2">thumbnail</div>');
    const editPath = join(projectRoot, 'edit.json');
    await writeFile(editPath, JSON.stringify({
        version: 2,
        output: { width: 1920, height: 1080, fps: 30 },
        sources: [],
        tracks: [{ id: 'visual', lane: 'visual', items: [{
            id: 'thumbnail', at: 0, duration: 60,
            source: { kind: 'html', path: 'thumbnail.html' }
        }] }]
    }));
    const page = await prepareVisualThumbnailPage(
        editPath,
        'thumbnail',
        assets,
        async uri => ({ id: uri, url: 'http://127.0.0.1:1/asset' }),
        async () => undefined
    );
    assertNoGenerationOverlay(page.html, 'visual-thumbnail.html');
});
