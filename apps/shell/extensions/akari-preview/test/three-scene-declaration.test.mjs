import assert from 'node:assert/strict';
import test from 'node:test';
import { hasThreeDimensionalTextOverlay, threeSceneDeclarations } from '../lib/common/three-scene-assets.js';

test('displayed declaration name does not activate 3D', () => {
    assert.deepEqual(threeSceneDeclarations('<div>data-akari-3d-scene "texts"</div>'), []);
    assert.equal(hasThreeDimensionalTextOverlay([{ html: '<code>data-akari-3d-scene "texts"</code>' }]), false);
});

test('only a JSON script declaration activates 3D text', () => {
    const html = '<script data-akari-3d-scene type="application/json">{"texts":[{"text":"Sample"}]}</script>';
    assert.equal(threeSceneDeclarations(html).length, 1);
    assert.equal(hasThreeDimensionalTextOverlay([{ html }]), true);
    assert.equal(hasThreeDimensionalTextOverlay([{ html: html.replace('application/json', 'text/plain') }]), false);
});
