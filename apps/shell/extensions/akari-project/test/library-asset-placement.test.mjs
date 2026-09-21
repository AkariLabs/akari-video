import test from 'node:test';
import assert from 'node:assert/strict';
import { canPlaceLibraryAsset, resolveLibraryAssetMedia } from '../lib/common/library-asset-placement.js';

const files = (...names) => names.map(name => ({ name, isDirectory: false }));
for (const category of ['audio', 'broll', 'still']) {
    test(`${category}: available / cached は配置可能、locked は拒否`, () => {
        for (const state of ['available', 'cached', undefined]) assert.equal(canPlaceLibraryAsset({ origin: 'resolver', category, state }), true);
        assert.equal(canPlaceLibraryAsset({ origin: 'resolver', category, state: 'locked' }), false);
    });
    test(`${category}: local は取得状態によらず直接配置を拒否`, () => {
        for (const state of [undefined, 'available', 'cached', 'locked']) {
            assert.equal(canPlaceLibraryAsset({ origin: 'local', category, state }), false);
        }
    });
}
for (const category of ['overlay', 'scene3d', 'pack', 'font', 'preset:textstyle', 'unknown']) {
    test(`${category}: 直接配置対象外`, () => assert.equal(canPlaceLibraryAsset({ origin: 'resolver', category }), false));
}
for (const [label, item, children, expected] of [
    ['単一音声', { category: 'audio' }, files('a.mp3'), { kind: 'audio', mediaName: 'a.mp3' }],
    ['試聴の b テイク', { category: 'audio', mediaUrl: 'https://example.test/b.mp3?token=1' }, files('a.mp3', 'b.mp3'), { kind: 'audio', mediaName: 'b.mp3' }],
    ['file URL とエンコード', { category: 'audio', mediaUrl: 'file:///cache/take%20b.mp3' }, files('a.mp3', 'take b.mp3'), { kind: 'audio', mediaName: 'take b.mp3' }],
    ['試聴名が無い', { category: 'audio', mediaUrl: 'https://example.test/c.mp3' }, files('a.mp3', 'b.mp3'), { kind: 'other' }],
    ['試聴 URL が壊れている', { category: 'audio', mediaUrl: '%' }, files('a.mp3', 'b.mp3'), { kind: 'other' }],
    ['試聴 URL が無い', { category: 'audio' }, files('a.mp3', 'b.mp3'), { kind: 'other' }],
    ['meta 付きパック', { category: 'audio', mediaUrl: 'https://example.test/b.mp3' }, files('meta.json', 'a.mp3', 'b.mp3'), { kind: 'other' }],
    ['同名ディレクトリは選ばない', { category: 'audio', mediaUrl: 'https://example.test/b.mp3' }, [...files('a.mp3', 'c.mp3'), { name: 'b.mp3', isDirectory: true }], { kind: 'other' }],
    ['動画と音声の混在', { category: 'broll' }, files('clip.mp4', 'voice.wav', 'still.png', 'meta.json'), { kind: 'video', mediaName: 'clip.mp4' }],
    ['HTML シート', { category: 'still' }, files('still.png', 'fragment.html'), { kind: 'other' }],
    ['画像', { category: 'still' }, files('still.png', 'preview.png'), { kind: 'image', mediaName: 'still.png' }],
]) {
    test(`主メディア: ${label}`, () => assert.deepEqual(resolveLibraryAssetMedia(item, children), expected));
}
