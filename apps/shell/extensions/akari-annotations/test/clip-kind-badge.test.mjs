import assert from 'node:assert/strict';
import test from 'node:test';

import { clipKindBadge } from '../lib/common/clip-kind-badge.js';

for (const [kind, text] of [
    ['html', 'HTML'],
    ['scene3d', '3D'],
    ['video', '動画'],
    ['image', '画像'],
    ['audio', '音声'],
    ['caption', '字幕']
]) {
    test(`${kind} は素材カードと同じ語彙・title の札を返す`, () => {
        const item = Object.freeze({ source: Object.freeze({ kind }) });
        assert.deepEqual(clipKindBadge(item), { text, title: `種別: ${text}` });
    });
}

test('未知の kind と source のないアイテムには札を出さない', () => {
    for (const kind of ['unknown', 'group', 'toString', '__proto__', '']) {
        assert.equal(clipKindBadge({ source: { kind } }), undefined);
    }
    assert.equal(clipKindBadge({}), undefined);
    assert.equal(clipKindBadge(undefined), undefined);
});

for (const [name, source, context, text] of [
    ['media + 動画パス', { kind: 'media', src: 'source-id' }, { path: 'assets/movie.MP4', lane: 'visual' }, '動画'],
    ['media + 画像パス', { kind: 'media', src: 'source-id' }, { path: 'assets/still.PNG', lane: 'visual' }, '画像'],
    ['media + audio lane', { kind: 'media', src: 'source-id' }, { path: 'assets/movie.mp4', lane: 'audio' }, '音声'],
    ['audio lane は画像拡張子より優先', { kind: 'media' }, { path: 'assets/still.png', lane: 'audio' }, '音声'],
    ['media + 音声パス', { kind: 'media', src: 'source-id' }, { path: 'assets/voice.WAV' }, '音声'],
    ['media は source.src にフォールバック', { kind: 'media', src: 'assets/still.JpEg' }, {}, '画像'],
    ['media は文脈の path を優先', { kind: 'media', src: 'assets/still.png' }, { path: 'assets/movie.mov' }, '動画'],
    ['media の未判定拡張子', { kind: 'media', src: 'assets/movie.custom' }, {}, '動画'],
    ['media のパスなし', { kind: 'media' }, {}, '動画'],
    ['media のパスなし + audio lane', { kind: 'media' }, { lane: 'audio' }, '音声'],
    ['html + scene3d の参照解決パス', { kind: 'html', src: 'scene-source' }, { path: 'assets/scene3d/studio/fragment.html' }, '3D'],
    ['html は source.path にフォールバック', { kind: 'html', path: 'assets/scene3d/studio/fragment.html' }, {}, '3D'],
    ['html + Windows のパス区切り', { kind: 'html' }, { path: 'C:\\assets\\scene3d\\studio\\fragment.html' }, '3D'],
    ['html はディレクトリ要素の完全一致のみ', { kind: 'html', path: 'assets/my-scene3d/fragment.html' }, {}, 'HTML'],
    ['html は文脈の path を優先', { kind: 'html', path: 'assets/scene3d/studio/fragment.html' }, { path: 'assets/overlay/title/fragment.html' }, 'HTML'],
    ['未知の kind は文脈があっても未知', { kind: 'unknown' }, { path: 'assets/still.png', lane: 'audio' }, undefined]
]) {
    test(name, () => {
        const item = Object.freeze({ source: Object.freeze(source) });
        assert.deepEqual(clipKindBadge(item, Object.freeze(context)), text === undefined ? undefined : { text, title: `種別: ${text}` });
    });
}

for (const [text, extensions] of [
    ['画像', ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'avif', 'heic']],
    ['音声', ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'aif', 'aiff']]
]) {
    test(`${text} の全拡張子を大文字・小文字ともに判定する`, () => {
        for (const extension of extensions) {
            for (const suffix of [extension, extension.toUpperCase()]) {
                assert.deepEqual(clipKindBadge({ source: { kind: 'media', src: `assets/clip.${suffix}` } }), { text, title: `種別: ${text}` });
            }
        }
    });
}
