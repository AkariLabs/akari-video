import './helpers/ja-language.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { isScene3dPath, scene3dMotionOptions, scene3dOwnedKnobVars, scene3dPlacementVars, scene3dScreenTextureVar,
    scene3dScreenVars, SCENE3D_ROTATION_VARS } from '../lib/common/scene3d-item.js';

const require = createRequire(import.meta.url);
const { ROTATION_3D_VARS } = require('@akari-video/edit-store/lib/transform-keyframe-edit.js');

const phone = {
    category: 'scene3d',
    knobs: [
        { cssVar: '--phone-demo-finish', type: 'dropdown', options: ['black-titanium'] },
        { cssVar: '--phone-demo-screen-preset', type: 'dropdown', options: ['home', 'browse', 'colors', 'custom'] },
        { cssVar: '--phone-demo-screen-src', type: 'media' },
        { cssVar: '--phone-demo-logo-src', type: 'media' },
    ],
    motion_presets: [{ clip: 'Turntable', label: 'ターンテーブル' }, { clip: 'HoldLeftFront' }, { clip: 'Turntable' }, { label: 'x' }],
};

test('回転のツマミ名は edit-store と同じ並び', () => {
    assert.deepEqual([...SCENE3D_ROTATION_VARS], [...ROTATION_3D_VARS]);
});

test('scene3d の断片パスを見分ける', () => {
    assert.equal(isScene3dPath('assets/scene3d/phone-demo/fragment.html'), true);
    assert.equal(isScene3dPath('C:\\lib\\scene3d\\phone\\fragment.html'), true);
    assert.equal(isScene3dPath('assets/overlay/lower-third/fragment.html'), false);
    assert.equal(isScene3dPath(undefined), false);
});

const fragment = (overrides, extra = '') => `<div class="phone">${extra}<canvas></canvas>
<script type="application/json" data-akari-3d-scene>${JSON.stringify({ model: 'model.glb', materialOverrides: overrides })}</script></div>`;

test('画面の差し替え先は断片の宣言の Screen マテリアルの textureVar（mask は除く）', () => {
    const html = fragment({
        LogoMat: { texture: 'logo.svg', textureVar: '--logo-src', target: 'mask' },
        ScreenMaterial: { texture: 'placeholder.png', textureVar: '--akari-screen-src' },
    });
    assert.equal(scene3dScreenTextureVar(html), '--akari-screen-src');
    assert.equal(scene3dScreenTextureVar(fragment({ ScreenGlass: { texture: 'a.png', textureVar: '--screen' } })), '--screen');
    assert.equal(scene3dScreenTextureVar(fragment({ ScreenMaterial: { texture: 'a.png' } })), undefined);
    assert.equal(scene3dScreenTextureVar(fragment({ LogoMat: { texture: 'a.svg', textureVar: '--logo', target: 'mask' } })), undefined);
    assert.equal(scene3dScreenTextureVar('<!-- <script type="application/json" data-akari-3d-scene>{}</script> -->'), undefined);
    assert.equal(scene3dScreenTextureVar(undefined), undefined);
    assert.deepEqual(scene3dScreenVars('--akari-screen-src', 'assets\\clips\\demo.mp4'), { '--akari-screen-src': 'assets/clips/demo.mp4' });
    assert.equal(scene3dScreenVars('--akari-screen-src', '../outside.mp4'), undefined);
    assert.equal(scene3dScreenVars('--akari-screen-src', 'C:/abs.mp4'), undefined);
    assert.equal(scene3dScreenVars(undefined, 'a.mp4'), undefined);
    assert.deepEqual([...scene3dOwnedKnobVars(phone)], ['--phone-demo-screen-preset', '--phone-demo-screen-src']);
});

test('動きの選択肢: 先頭は止める・重複と名前なしを除く', () => {
    assert.deepEqual(scene3dMotionOptions(phone), [
        { value: 'none', label: 'なし（止める）' },
        { value: 'Turntable', label: 'ターンテーブル' },
        { value: 'HoldLeftFront', label: 'HoldLeftFront' },
    ]);
    assert.deepEqual(scene3dMotionOptions(undefined), [{ value: 'none', label: 'なし（止める）' }]);
});

test('置いた直後は静止（--akari-3d-clip: none）、回転は書かない', () => {
    assert.deepEqual(scene3dPlacementVars({ '--phone-demo-finish': 'black-titanium' }),
        { '--phone-demo-finish': 'black-titanium', '--akari-3d-clip': 'none' });
});
