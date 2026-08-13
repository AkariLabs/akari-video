import assert from 'node:assert/strict';
import test from 'node:test';

import { editReferencesRawMedia } from '../lib/common/related-edit-source.js';

test('v1 標準配置: ルート直下 edit.json の sources[].path が assets/ の raw media に一致する', () => {
    const edit = {
        version: 1,
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

test('v1 は basename だけでなく絶対 URI で照合し、別ディレクトリの同名素材を拾わない', () => {
    const edit = {
        version: 1,
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

test('v0 source.path は従来どおり basename 一致で候補 edit.json を見つける', () => {
    const edit = { version: 0, source: { path: 'media/legacy.mp4' } };
    assert.equal(editReferencesRawMedia(
        edit,
        'file:///project/edit.json',
        'file:///project/assets/legacy.mp4'
    ), true);
    assert.equal(editReferencesRawMedia(
        edit,
        'file:///project/edit.json',
        'file:///project/assets/different.mp4'
    ), false);
});

test('壊れた sources[] エントリは無視し、後続の有効な v1 source を照合する', () => {
    const edit = {
        version: 1,
        sources: [null, { path: '' }, { path: 42 }, { path: 'assets/source.mp4' }]
    };
    assert.equal(editReferencesRawMedia(
        edit,
        'file:///project/edit.json',
        'file:///project/assets/source.mp4'
    ), true);
});
