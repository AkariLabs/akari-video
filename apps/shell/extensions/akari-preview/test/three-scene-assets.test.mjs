import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { readHandlerSource } from './helpers/handler-source.mjs';

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
    const source = readHandlerSource();
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
    const source = readHandlerSource();
    const method = source.slice(source.indexOf('protected async resolveThreeSceneAssets('), source.indexOf('protected previewCaptionTimelineSegments('));
    assert.ok(method.includes('resolveThreeSceneDescriptorAssets(parsedDescriptor, resolveAsset, overlayVars)'));
    assert.ok(!method.includes("key !== 'texture'"));
});
test('断片に書かれたパスは fragment、source.vars から来た画面のパスは vars として解決を頼む', async () => {
    const calls = [];
    const resolver = async (relativePath, field, origin) => {
        calls.push([relativePath, origin]);
        return `asset:${relativePath}`;
    };
    await resolveThreeSceneDescriptorAssets({
        model: 'model.glb',
        environment: { map: 'env.png' },
        materialOverrides: {
            ScreenMaterial: { texture: 'placeholder.png', textureVar: '--akari-screen-src' },
            LogoMat: { texture: 'logos/mark.svg', target: 'mask' },
            Back: { texture: 'var(--back)' },
        },
    }, resolver, { '--akari-screen-src': 'assets/clips/user.mp4', '--back': 'assets/back.png' });
    assert.deepEqual(calls, [
        ['model.glb', 'fragment'], ['env.png', 'fragment'], ['assets/clips/user.mp4', 'vars'],
        ['logos/mark.svg', 'fragment'], ['assets/back.png', 'vars'],
    ]);
    calls.length = 0;
    await resolveThreeSceneDescriptorAssets({ model: 'model.glb', materialOverrides: {
        ScreenMaterial: { texture: 'placeholder.png', textureVar: '--akari-screen-src' } } }, resolver, {});
    assert.deepEqual(calls, [['model.glb', 'fragment'], ['placeholder.png', 'fragment']]);
});

// terrain / lines は model も texts も無しで 1 シーンになる。シェルの事前検査がこの 2 key を
// 知らないと、ランタイムが描ける断片だけがプレビューで { model: '' } に置換される
// （task 2026-10-21-scene3d-terrain-lines の r1）。
test('terrain-only scene resolves heightmap and texture through the asset stream', async () => {
    const calls = [];
    const resolver = async (relativePath, field, origin) => {
        calls.push([relativePath, field, origin]);
        return `asset:${relativePath}`;
    };
    const source = {
        terrain: { heightmap: 'media/height.png', texture: 'media/photo.jpg', exaggeration: 2.5, size: [8, 8] }
    };
    const { descriptor, modelPath } = await resolveThreeSceneDescriptorAssets(source, resolver);
    assert.equal(modelPath, undefined);
    assert.deepEqual(calls, [
        ['media/height.png', 'data-akari-3d-scene.terrain.heightmap', 'fragment'],
        ['media/photo.jpg', 'data-akari-3d-scene.terrain.texture', 'fragment'],
    ]);
    assert.deepEqual(descriptor, {
        terrain: {
            heightmap: 'asset:media/height.png',
            texture: 'asset:media/photo.jpg',
            exaggeration: 2.5,
            size: [8, 8],
        }
    });
    assert.deepEqual(source, {
        terrain: { heightmap: 'media/height.png', texture: 'media/photo.jpg', exaggeration: 2.5, size: [8, 8] }
    });
});

test('lines-only scene passes the shell gate without resolving any asset', async () => {
    const calls = [];
    const resolver = async relativePath => {
        calls.push(relativePath);
        return `asset:${relativePath}`;
    };
    const source = { lines: [{ points: [[0, 0, 0], [1, 1, 1]], color: '#ff3366', width: 12 }] };
    const { descriptor } = await resolveThreeSceneDescriptorAssets(source, resolver);
    assert.deepEqual(calls, []);
    assert.deepEqual(descriptor, source);
});

test('terrain + lines + model scene resolves all three kinds in one pass', async () => {
    const calls = [];
    const resolver = async (relativePath, field) => {
        calls.push([relativePath, field]);
        return `asset:${relativePath}`;
    };
    const { descriptor, modelPath } = await resolveThreeSceneDescriptorAssets({
        model: 'models/world.glb',
        terrain: { heightmap: 'media/height.png' },
        lines: [{ points: [[0, 0, 0], [2, 0, 0]], progress: 0.5 }],
    }, resolver);
    assert.equal(modelPath, 'models/world.glb');
    assert.deepEqual(calls, [
        ['models/world.glb', 'data-akari-3d-scene.model'],
        ['media/height.png', 'data-akari-3d-scene.terrain.heightmap'],
    ]);
    assert.equal(descriptor.model, 'asset:models/world.glb');
    assert.deepEqual(descriptor.terrain, { heightmap: 'asset:media/height.png' });
    assert.deepEqual(descriptor.lines, [{ points: [[0, 0, 0], [2, 0, 0]], progress: 0.5 }]);
});

test('terrain paths keep the same relative-asset boundary as model/font paths', async () => {
    for (const heightmap of ['https://example.com/height.png', '/tmp/height.png', 'C:\\height.png']) {
        await assert.rejects(
            resolveThreeSceneDescriptorAssets({ terrain: { heightmap } }, streamResolver),
            TypeError,
            heightmap
        );
    }
    await assert.rejects(
        resolveThreeSceneDescriptorAssets(
            { terrain: { heightmap: 'height.png', texture: 'https://example.com/photo.jpg' } },
            streamResolver
        ),
        TypeError
    );
});
