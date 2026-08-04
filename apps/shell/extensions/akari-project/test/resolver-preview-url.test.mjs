import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { resolveResolverPreviewUrl } from '../lib/node/resolver-preview-url.js';

// resolver カタログの preview（絶対 URL または base 相対キー）+ base（リモート URL または
// ローカルディレクトリパス）から <img src> にそのまま渡せる URL を組み立てる純関数のテスト。

test('resolveResolverPreviewUrl: preview が無ければ undefined', () => {
    assert.equal(resolveResolverPreviewUrl(undefined, 'https://akari-oss.app/assets/'), undefined);
    assert.equal(resolveResolverPreviewUrl('', 'https://akari-oss.app/assets/'), undefined);
});

test('resolveResolverPreviewUrl: preview が既に絶対 URL ならそのまま返す（base 無視）', () => {
    const preview = 'https://cdn.example.com/x/preview.png';
    assert.equal(resolveResolverPreviewUrl(preview, 'https://akari-oss.app/assets/'), preview);
    assert.equal(resolveResolverPreviewUrl(preview, '/local/dist-assets'), preview);
});

test('resolveResolverPreviewUrl: base がリモート URL のとき、相対キーを絶対 URL 化する', () => {
    const result = resolveResolverPreviewUrl('still/br-typing-laptop/v1/preview.png', 'https://akari-oss.app/assets/');
    assert.equal(result, 'https://akari-oss.app/assets/still/br-typing-laptop/v1/preview.png');
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
