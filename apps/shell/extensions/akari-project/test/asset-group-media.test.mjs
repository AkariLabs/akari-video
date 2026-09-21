import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyMaterialKind, resolveAssetGroupMedia } from '../lib/common/asset-group-media.js';

const files = (...names) => names.map(name => ({ name, isDirectory: false }));

for (const [label, category, names, expected] of [
    ['音声 1 本', 'audio', ['meta.json', 'track.wav', 'preview.png'], { kind: 'audio', mediaName: 'track.wav' }],
    ['音声 0 本', 'audio', ['meta.json', 'preview.png'], { kind: 'other' }],
    ['音声 2 本', 'audio', ['piano-1.mp3', 'piano-2.mp3'], { kind: 'other' }],
    ['動画 1 本と音声・画像の混在', 'broll', ['clip.mp4', 'voice.wav', 'still.png', 'preview.png', 'meta.json', 'transcript.srt', 'script.md'], { kind: 'video', mediaName: 'clip.mp4' }],
    ['動画 0 本', 'broll', ['voice.wav', 'still.png'], { kind: 'other' }],
    ['動画 2 本', 'broll', ['clip.mp4', 'demo.mov'], { kind: 'other' }],
    ['画像 1 本', 'still', ['still.png', 'preview.png', 'meta.json'], { kind: 'image', mediaName: 'still.png' }],
    ['preview.png のみ', 'still', ['preview.png'], { kind: 'other' }],
    ['画像 0 本', 'still', ['meta.json'], { kind: 'other' }],
    ['画像 1 本 + fragment.html', 'still', ['still.png', 'fragment.html', 'preview.png', 'meta.json'], { kind: 'image', mediaName: 'still.png' }],
    ['画像 0 本 + fragment.html', 'still', ['fragment.html', 'preview.png', 'meta.json'], { kind: 'other' }],
    ['画像 2 本 + fragment.html', 'still', ['one.jpg', 'two.webp', 'fragment.html', 'preview.png', 'meta.json'], { kind: 'other' }],
    ['HTM を含む画像', 'still', ['still.png', 'fragment.HTM'], { kind: 'image', mediaName: 'still.png' }],
    ['画像 2 本', 'still', ['one.jpg', 'two.webp', 'preview.png'], { kind: 'other' }],
    ['overlay', 'overlay', ['clip.mp4', 'still.png'], { kind: 'other' }],
    ['overlay の画像 1 本 + fragment.html', 'overlay', ['still.png', 'fragment.html', 'preview.png', 'meta.json'], { kind: 'other' }],
    ['scene3d のデモ動画', 'scene3d', ['demo.mp4'], { kind: 'other' }],
    ['font', 'font', ['font.woff2', 'specimen.png'], { kind: 'other' }],
    ['未知カテゴリ', 'unknown', ['clip.mp4'], { kind: 'other' }],
    ['未定義カテゴリ', undefined, ['clip.mp4'], { kind: 'other' }],
    ['空カテゴリ', '', ['clip.mp4'], { kind: 'other' }],
    ['子なし', 'audio', [], { kind: 'other' }],
    ['大文字の音声拡張子', 'audio', ['Track.MP3'], { kind: 'audio', mediaName: 'Track.MP3' }],
    ['大文字の動画拡張子', 'broll', ['Clip.MOV'], { kind: 'video', mediaName: 'Clip.MOV' }],
    ['大文字の画像拡張子とプレビュー除外', 'still', ['Still.JPEG', 'PREVIEW.PNG'], { kind: 'image', mediaName: 'Still.JPEG' }]
]) {
    test(`resolveAssetGroupMedia: ${label}`, () => {
        assert.deepEqual(resolveAssetGroupMedia(category, files(...names)), expected);
    });
}

for (const [category, name, kind] of [['audio', 'track.wav', 'audio'], ['broll', 'clip.mp4', 'video'], ['still', 'still.png', 'image']]) {
    test(`resolveAssetGroupMedia: ${category} のディレクトリは数えない`, () => {
        const directories = [
            { name: `directory-${name}`, isDirectory: true },
            { name: 'fragment.html', isDirectory: true }
        ];
        assert.deepEqual(resolveAssetGroupMedia(category, directories), { kind: 'other' });
        assert.deepEqual(resolveAssetGroupMedia(category, [...directories, ...files(name)]), { kind, mediaName: name });
    });
}

for (const [kind, category, extensions] of [
    ['video', 'broll', ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi']],
    ['audio', 'audio', ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg']],
    ['image', 'still', ['png', 'jpg', 'jpeg', 'gif', 'webp']]
]) {
    test(`classifyMaterialKind: ${kind} の既存拡張子を生ファイル・グループで共有する`, () => {
        for (const extension of extensions) {
            for (const name of [`media.${extension}`, `Media.${extension.toUpperCase()}`]) {
                assert.equal(classifyMaterialKind(name), kind, name);
                assert.deepEqual(resolveAssetGroupMedia(category, files(name)), { kind, mediaName: name });
            }
        }
    });
}

test('classifyMaterialKind: 未対応の名前を従来どおり other にする', () => {
    for (const name of ['', 'mp4', 'clip.mp4.bak', 'sound.aiff', 'still.svg', 'fragment.html', 'meta.json']) {
        assert.equal(classifyMaterialKind(name), 'other', name);
    }
});
