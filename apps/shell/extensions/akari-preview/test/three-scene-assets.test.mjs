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
        /assets\.threeJavaScriptUrl\)[\s\S]*threeTextRuntimeScript[\s\S]*assets\.threeRuntimeJavaScriptUrl\)/
    );
});

test('material assets preserve brightness and rewrite the selected texture without mutating the declaration', async () => {
    const source = { model: 'model.glb', environment: { map: 'room.png', intensity: 1.05 }, materialOverrides: {
        ScreenMaterial: { texture: 'fallback.png', textureVar: '--screen-src', brightness: 'var(--brightness)' },
        IconMaterial: { texture: 'icon.png', brightness: 1 }
    } };
    const before = JSON.stringify(source);
    const { descriptor } = await resolveThreeSceneDescriptorAssets(source, streamResolver, { '--screen-src': 'video.mp4' });
    assert.equal(descriptor.materialOverrides.ScreenMaterial.texture, await streamResolver('video.mp4'));
    assert.equal(descriptor.materialOverrides.ScreenMaterial.brightness, 'var(--brightness)');
    assert.equal(descriptor.materialOverrides.ScreenMaterial.textureVar, undefined);
    assert.equal(descriptor.materialOverrides.IconMaterial.brightness, 1);
    assert.equal(descriptor.environment.map, await streamResolver('room.png'));
    assert.equal(JSON.stringify(source), before);
});
test('empty texture variables retain their fallback, while direct variables resolve to project assets', async () => {
    for (const texture of ['screen.png', 'var(--screen)']) {
        const { descriptor } = await resolveThreeSceneDescriptorAssets({ model: 'model.glb', materialOverrides: {
            ScreenMaterial: { texture, textureVar: '--unset', brightness: 0 }
        } }, streamResolver, { '--screen': 'screen.png' });
        assert.equal(descriptor.materialOverrides.ScreenMaterial.texture, await streamResolver('screen.png'));
        assert.equal(descriptor.materialOverrides.ScreenMaterial.brightness, 0);
    }
});
test('texture variable paths retain the same asset boundary as literal paths', async () => {
    for (const texture of ['https://example.com/image.png', '/tmp/screen.png', 'C:\\screen.png', '\\\\server\\screen.png']) {
        await assert.rejects(resolveThreeSceneDescriptorAssets({ model: 'model.glb', materialOverrides: {
            ScreenMaterial: { texture: 'fallback.png', textureVar: '--screen' }
        } }, streamResolver, { '--screen': texture }), TypeError);
    }
});
test('shell host delegates material/path resolution instead of maintaining a narrower override vocabulary', () => {
    const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
    const method = source.slice(source.indexOf('protected async resolveThreeSceneAssets('), source.indexOf('protected previewCaptionTimelineSegments('));
    assert.ok(method.includes('resolveThreeSceneDescriptorAssets(parsedDescriptor, resolveAsset, overlayVars)'));
    assert.ok(!method.includes("key !== 'texture'"));
});
