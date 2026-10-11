import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { isScene3dPath, scene3dMotionOptions, scene3dOwnedKnobVars, scene3dPlacementVars, scene3dScreenKnobs,
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

test('画面のツマミ: -screen-src の media と custom を持つ -screen-preset', () => {
    assert.deepEqual(scene3dScreenKnobs(phone), { src: '--phone-demo-screen-src', preset: '--phone-demo-screen-preset' });
    assert.deepEqual(scene3dScreenVars(phone, 'assets\\clips\\demo.mp4'),
        { '--phone-demo-screen-preset': 'custom', '--phone-demo-screen-src': 'assets/clips/demo.mp4' });
    const noPreset = { knobs: [{ cssVar: '--x-screen-src', type: 'media' }, { cssVar: '--x-screen-preset', type: 'dropdown', options: ['home'] }] };
    assert.deepEqual(scene3dScreenVars(noPreset, 'a.mp4'), { '--x-screen-src': 'a.mp4' });
    assert.equal(scene3dScreenKnobs({ knobs: [{ cssVar: '--logo-src', type: 'media' }] }), undefined);
    assert.equal(scene3dScreenVars(phone, '../outside.mp4'), undefined);
    assert.equal(scene3dScreenVars(phone, 'C:/abs.mp4'), undefined);
    assert.deepEqual([...scene3dOwnedKnobVars(phone)], ['--phone-demo-screen-src', '--phone-demo-screen-preset']);
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
