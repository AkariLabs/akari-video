import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
    hasThreeDimensionalTextOverlay,
    resolveThreeSceneDescriptorAssets
} = require('../lib/common/three-scene-assets.js');

const streamResolver = async relativePath => `http://127.0.0.1:4567/asset/${encodeURIComponent(relativePath)}`;

test('texts[] only scene resolves each relative font through the asset stream', async () => {
    const source = {
        texts: [
            { id: 'title', text: '動画', font: 'assets/fonts/title.ttf', mode: 'flat' },
            { id: 'accent', text: '編集', font: 'assets/fonts/accent.otf', mode: 'extrude' }
        ],
        physics: { enabled: true, targets: ['title'] }
    };

    const { descriptor, modelPath } = await resolveThreeSceneDescriptorAssets(source, streamResolver);

    assert.equal(modelPath, undefined);
    assert.deepEqual(descriptor, {
        texts: [
            {
                id: 'title', text: '動画', mode: 'flat',
                font: 'http://127.0.0.1:4567/asset/assets%2Ffonts%2Ftitle.ttf'
            },
            {
                id: 'accent', text: '編集', mode: 'extrude',
                font: 'http://127.0.0.1:4567/asset/assets%2Ffonts%2Faccent.otf'
            }
        ],
        physics: { enabled: true, targets: ['title'] }
    });
    assert.equal(source.texts[0].font, 'assets/fonts/title.ttf', 'input descriptor is not mutated');
});

test('model-only scene preserves the existing descriptor shape while resolving model', async () => {
    const source = {
        model: 'assets/models/appicon.glb',
        camera: { position: [0, 0, 3] },
        shadows: true
    };

    const { descriptor, modelPath } = await resolveThreeSceneDescriptorAssets(source, streamResolver);

    assert.equal(modelPath, 'assets/models/appicon.glb');
    assert.deepEqual(descriptor, {
        model: 'http://127.0.0.1:4567/asset/assets%2Fmodels%2Fappicon.glb',
        camera: { position: [0, 0, 3] },
        shadows: true
    });
    assert.deepEqual(source, {
        model: 'assets/models/appicon.glb',
        camera: { position: [0, 0, 3] },
        shadows: true
    });
});

test('font path rejects URLs, absolute paths, and unsupported extensions', async () => {
    for (const font of [
        'https://example.com/title.ttf',
        '/tmp/title.ttf',
        'C:\\fonts\\title.ttf',
        '\\\\server\\fonts\\title.ttf',
        'assets/fonts/title.woff2'
    ]) {
        await assert.rejects(
            resolveThreeSceneDescriptorAssets(
                { texts: [{ id: 'title', text: '動画', font }] },
                streamResolver
            ),
            TypeError,
            font
        );
    }
});

test('3D text vendor gate only matches texts scene declarations', () => {
    assert.equal(hasThreeDimensionalTextOverlay([
        { html: '<script type="application/json" data-akari-3d-scene>{"texts":[]}</script>' }
    ]), true);
    assert.equal(hasThreeDimensionalTextOverlay([
        { html: '<script type="application/json" data-akari-3d-scene>{"model":"asset://model"}</script>' }
    ]), false);
    assert.equal(hasThreeDimensionalTextOverlay([{ html: '<div>"texts"</div>' }]), false);
});

test('webview script order is three bundle, conditional text vendor, then three runtime', () => {
    const source = readFileSync(
        new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url),
        'utf8'
    );
    assert.match(
        source,
        /assets\.threeJavaScript\)[\s\S]*threeTextRuntimeScript[\s\S]*assets\.threeRuntimeJavaScript\)/
    );
});
