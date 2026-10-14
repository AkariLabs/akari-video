import assert from 'node:assert/strict';
import test from 'node:test';
import { canPlaceOverlay, isScene3dBakeRecipe, libraryDragKind } from '../lib/common/library-asset-placement.js';

test('3D の配置候補は resolver の利用可能な項目だけ', () => {
    const item = { origin: 'resolver', category: 'scene3d', state: 'cached' };
    assert.equal(libraryDragKind(item), 'scene3d');
    assert.equal(canPlaceOverlay(item), true);
    assert.equal(canPlaceOverlay({ ...item, state: 'locked' }), false);
    assert.equal(canPlaceOverlay({ ...item, origin: 'local' }), false);
});

test('3D の Blender レシピをファイルとメタデータから判定する', () => {
    const htmlNames = ['fragment.html', 'meta.json'];
    assert.equal(isScene3dBakeRecipe({ names: [...htmlNames, 'scene.py'] }), true);
    assert.equal(isScene3dBakeRecipe({ names: htmlNames, meta: { requires: ['blender'] } }), true);
    assert.equal(isScene3dBakeRecipe({ names: htmlNames, meta: { tags: ['bake-recipe'] } }), true);
    assert.equal(isScene3dBakeRecipe({ names: ['meta.json'] }), true);
    assert.equal(isScene3dBakeRecipe({ names: htmlNames, meta: {} }), false);
});
