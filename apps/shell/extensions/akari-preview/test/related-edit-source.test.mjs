import assert from 'node:assert/strict';
import test from 'node:test';

import { editReferencesRawMedia } from '../lib/common/related-edit-source.js';

const output = { width: 1920, height: 1080, fps: 30 };

test('v2 標準配置: ルート直下 edit.json の sources[].path が assets/ の raw media に一致する', () => {
    const edit = {
        version: 2, output, tracks: [],
        sources: [
            { id: 'main', path: 'assets/source.mp4', proxy: null },
            { id: 'render', path: 'exports/render.mp4', proxy: null }
        ]
    };
    assert.equal(editReferencesRawMedia(
        edit,
        'file:///project/edit.json',
        'file:///project/assets/source.mp4'
    ), true);
    assert.equal(editReferencesRawMedia(
        edit,
        'file:///project/edit.json',
        'file:///project/exports/render.mp4'
    ), true);
});

test('v2 は basename だけでなく絶対 URI で照合し、別ディレクトリの同名素材を拾わない', () => {
    const edit = {
        version: 2, output, tracks: [],
        sources: [{ id: 'main', path: 'assets/source.mp4' }]
    };
    assert.equal(editReferencesRawMedia(
        edit,
        'file:///project/edit.json',
        'file:///project/other/source.mp4'
    ), false);
    assert.equal(editReferencesRawMedia(
        edit,
        'file:///another-project/edit.json',
        'file:///project/assets/source.mp4'
    ), false);
});

test('空の v2 素材表は raw media に一致しない', () => {
    const edit = { version: 2, output, tracks: [], sources: [] };
    assert.equal(editReferencesRawMedia(
        edit,
        'file:///project/edit.json',
        'file:///project/assets/source.mp4'
    ), false);
});
