import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolveResolverPreviewUrl, resolveResolverCatalogUrls } from '../lib/node/resolver-preview-url.js';

// resolver カタログの preview（絶対 URL または base 相対キー）+ base（リモート URL または
// ローカルディレクトリパス）から <img src> にそのまま渡せる URL を組み立てる純関数のテスト。

test('resolveResolverPreviewUrl: preview が無ければ undefined', () => {
    assert.equal(resolveResolverPreviewUrl(undefined, 'https://akari.video/assets/'), undefined);
    assert.equal(resolveResolverPreviewUrl('', 'https://akari.video/assets/'), undefined);
});

test('resolveResolverPreviewUrl: preview が既に絶対 URL ならそのまま返す（base 無視）', () => {
    const preview = 'https://cdn.example.com/x/preview.png';
    assert.equal(resolveResolverPreviewUrl(preview, 'https://akari.video/assets/'), preview);
    assert.equal(resolveResolverPreviewUrl(preview, '/local/dist-assets'), preview);
});

test('resolveResolverPreviewUrl: base がリモート URL のとき、相対キーを絶対 URL 化する', () => {
    const result = resolveResolverPreviewUrl('still/br-typing-laptop/v1/preview.png', 'https://akari.video/assets/');
    assert.equal(result, 'https://akari.video/assets/still/br-typing-laptop/v1/preview.png');
});

test('resolveResolverPreviewUrl: base がローカルディレクトリのとき、file: URI 化する', () => {
    const result = resolveResolverPreviewUrl('still/br-typing-laptop/v1/preview.png', '/tmp/dist-assets');
    assert.equal(result, pathToFileURL(resolve('/tmp/dist-assets', 'still/br-typing-laptop/v1/preview.png')).toString());
    assert.ok(result.startsWith('file://'));
});

test('resolveResolverPreviewUrl: base が相対パスでも path.resolve と同じ規則で解決する', () => {
    const result = resolveResolverPreviewUrl('preview.png', 'dist-assets');
    assert.equal(result, pathToFileURL(resolve('dist-assets', 'preview.png')).toString());
});

test('resolveResolverCatalogUrls: local preview inside library wins over remote base', t => {
    const libraryDir = mkdtempSync(resolve(tmpdir(), 'akari-preview-url-'));
    t.after(() => rmSync(libraryDir, { recursive: true, force: true }));
    writeFileSync(resolve(libraryDir, 'thumbnail.png'), 'image');
    assert.equal(resolveResolverCatalogUrls({
        category: 'overlay', id: 'frame', title: 'Frame', libraryDir, preview: 'thumbnail.png'
    }, 'https://akari.video/assets/').previewUrl, pathToFileURL(resolve(libraryDir, 'thumbnail.png')).href);
    assert.equal(resolveResolverCatalogUrls({
        category: 'overlay', id: 'frame', title: 'Frame', libraryDir, preview: 'missing.png'
    }, 'https://akari.video/assets/').previewUrl, 'https://akari.video/assets/missing.png');
});
