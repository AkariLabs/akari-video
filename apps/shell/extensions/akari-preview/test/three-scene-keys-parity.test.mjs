import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// シェル側の top-level key 許可リストが three-runtime.js の ALLOWED_SCENE_KEYS と乖離すると、
// ランタイムだけが受理する key を含む宣言がシェルのプレビューでだけ丸ごと拒否される
// （environment / shadows、fog / background で実際に起きた）。ここで両者を突き合わせて止める。

const require = createRequire(import.meta.url);
const { THREE_SCENE_KEYS, resolveThreeSceneDescriptorAssets } = require('../lib/common/three-scene-assets.js');

const here = dirname(fileURLToPath(import.meta.url));
const runtimeSource = readFileSync(
    resolve(here, '../../../../../packages/overlay-runtime/src/three-runtime.js'),
    'utf8'
);

function runtimeAllowedSceneKeys() {
    const match = runtimeSource.match(/const ALLOWED_SCENE_KEYS = new Set\(\[([\s\S]*?)\]\);/);
    assert.ok(match, 'three-runtime.js に ALLOWED_SCENE_KEYS が見つかりません');
    return new Set([...match[1].matchAll(/"([A-Za-z]+)"/g)].map(([, key]) => key));
}

test('shell THREE_SCENE_KEYS matches three-runtime ALLOWED_SCENE_KEYS', () => {
    const runtimeKeys = runtimeAllowedSceneKeys();
    assert.ok(runtimeKeys.size > 0);
    const shellKeys = new Set(THREE_SCENE_KEYS);
    const onlyRuntime = [...runtimeKeys].filter(key => !shellKeys.has(key));
    const onlyShell = [...shellKeys].filter(key => !runtimeKeys.has(key));
    assert.deepEqual(
        { onlyRuntime, onlyShell },
        { onlyRuntime: [], onlyShell: [] },
        'シェルと three-runtime の許可 key が一致していません（シェルだけ拒否 / ランタイムだけ拒否の事故）'
    );
});

test('fog / background are accepted by the shell boundary and passed through untouched', async () => {
    const source = {
        model: 'assets/models/world.glb',
        background: { color: '#1640ff' },
        fog: { color: '#ff0000', near: 1, far: 20 }
    };
    for (const key of Object.keys(source)) {
        assert.ok(THREE_SCENE_KEYS.has(key), `${key} がシェルの許可リストに無い`);
    }
    const { descriptor } = await resolveThreeSceneDescriptorAssets(
        source,
        async relativePath => `http://127.0.0.1:4567/asset/${encodeURIComponent(relativePath)}`
    );
    assert.deepEqual(descriptor.background, source.background);
    assert.deepEqual(descriptor.fog, source.fog);
});
