import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveThumbnailCacheKey, thumbnailCacheFileName } from '../lib/node/thumbnail-cache.js';

// キャッシュキー導出の単体テスト（task.md L0 必須項目）。
// path + size + mtime 由来（project-structure-v0 契約 §2-2: 再生成可能・削除安全）。

test('deriveThumbnailCacheKey: 同じ path/size/mtime は同じキーになる（決定論的）', () => {
    const a = deriveThumbnailCacheKey('assets/clip.mp4', 12345, 1700000000000);
    const b = deriveThumbnailCacheKey('assets/clip.mp4', 12345, 1700000000000);
    assert.equal(a, b);
});

test('deriveThumbnailCacheKey: path が違えば別のキー', () => {
    const a = deriveThumbnailCacheKey('assets/clip.mp4', 12345, 1700000000000);
    const b = deriveThumbnailCacheKey('assets/other.mp4', 12345, 1700000000000);
    assert.notEqual(a, b);
});

test('deriveThumbnailCacheKey: size が違えば別のキー（原本が変われば再生成される）', () => {
    const a = deriveThumbnailCacheKey('assets/clip.mp4', 12345, 1700000000000);
    const b = deriveThumbnailCacheKey('assets/clip.mp4', 99999, 1700000000000);
    assert.notEqual(a, b);
});

test('deriveThumbnailCacheKey: mtime が違えば別のキー', () => {
    const a = deriveThumbnailCacheKey('assets/clip.mp4', 12345, 1700000000000);
    const b = deriveThumbnailCacheKey('assets/clip.mp4', 12345, 1700000005000);
    assert.notEqual(a, b);
});

test('deriveThumbnailCacheKey: 英数字のみの短い文字列を返す（ファイル名として安全）', () => {
    const key = deriveThumbnailCacheKey('assets/日本語ファイル名.mp4', 1, 1);
    assert.match(key, /^[0-9a-f]{16}$/);
});

test('thumbnailCacheFileName: キー + 拡張子を連結する', () => {
    assert.equal(thumbnailCacheFileName('abc123', '.jpg'), 'abc123.jpg');
});

test('thumbnailCacheFileName: 先頭ドット無しの拡張子も受け付ける', () => {
    assert.equal(thumbnailCacheFileName('abc123', 'png'), 'abc123.png');
});

test('thumbnailCacheFileName: 拡張子は小文字化する', () => {
    assert.equal(thumbnailCacheFileName('abc123', '.PNG'), 'abc123.png');
});
