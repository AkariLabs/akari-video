import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { AkariPreviewServiceImpl } = require('../lib/node/akari-preview-service.js');

test('preview publishes library fonts in the existing font-face list', async t => {
    const home = await mkdtemp(join(tmpdir(), 'preview-caption-font-home-'));
    t.after(() => rm(home, { recursive: true, force: true }));
    const dir = join(home, 'assets/font/probe-hand');
    await mkdir(dir, { recursive: true });
    await copyFile(fileURLToPath(new URL('../../../../../assets/font/dela-gothic-one/DelaGothicOne-Regular.ttf', import.meta.url)), join(dir, 'ProbeHand-Regular.ttf'));
    await writeFile(join(dir, 'meta.json'), JSON.stringify({ id: 'probe-hand', category: 'font', title: 'Probe Hand（検証）', tags: [], license: {} }));
    const previous = process.env.AKARI_HOME;
    const previousLibrary = process.env.AKARI_LIBRARY_ROOT;
    process.env.AKARI_HOME = home;
    delete process.env.AKARI_LIBRARY_ROOT;
    const service = new AkariPreviewServiceImpl();
    try {
        const assets = await service.getOverlayRuntimeAssetUrls();
        const face = assets.bundledCaptionFontFaces.find(value => value.id === 'probe-hand');
        assert.equal(face?.family, 'Probe Hand');
        assert.equal((await fetch(face.url)).status, 200);
    } finally {
        service.server?.close();
        if (previous === undefined) delete process.env.AKARI_HOME; else process.env.AKARI_HOME = previous;
        if (previousLibrary === undefined) delete process.env.AKARI_LIBRARY_ROOT; else process.env.AKARI_LIBRARY_ROOT = previousLibrary;
    }
});

test('library font discovery failure keeps bundled preview assets and warns once', async () => {
    const service = new AkariPreviewServiceImpl();
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args);
    service.loadLibraryCaptionFontFaces = async () => { throw new Error('library unavailable'); };
    try {
        const first = await service.getOverlayRuntimeAssetUrls();
        const second = await service.getOverlayRuntimeAssetUrls();
        assert.equal(first.bundledCaptionFontFaces.length, 13);
        assert.equal(second.bundledCaptionFontFaces.length, 13);
        assert.match(first.captionFontUrl, /\/static\//u);
        assert.equal((await fetch(first.captionFontUrl)).status, 200);
        assert.equal(warnings.length, 1);
        assert.match(String(warnings[0][0]), /library caption fonts unavailable/u);
    } finally {
        console.warn = originalWarn;
        service.server?.close();
    }
});

test('an unreadable library font leaves bundled preview URLs usable', async () => {
    const service = new AkariPreviewServiceImpl();
    const originalWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => warnings.push(args);
    service.loadLibraryCaptionFontFaces = async () => [{ id: 'broken', family: 'Broken', file: 'broken.ttf',
        weight: '400', path: '/nonexistent-caption-export-fonts/broken.ttf' }];
    try {
        const assets = await service.getOverlayRuntimeAssetUrls();
        assert.equal(assets.bundledCaptionFontFaces.length, 13);
        assert.equal((await fetch(assets.captionFontUrl)).status, 200);
        assert.equal(warnings.length, 1);
    } finally {
        console.warn = originalWarn;
        service.server?.close();
    }
});
