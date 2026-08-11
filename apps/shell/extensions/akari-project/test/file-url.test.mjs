import test from 'node:test';
import assert from 'node:assert/strict';
import { toFileUrl } from '../lib/common/file-url.js';

test('toFileUrl: スペースを含むパスをパーセントエンコードする', () => {
    assert.equal(toFileUrl('/tmp/videos/My Video.mp4'), 'file:///tmp/videos/My%20Video.mp4');
});

test('toFileUrl: 日本語を含むパスをパーセントエンコードする', () => {
    assert.equal(
        toFileUrl('/tmp/videos/素材/クリップ.mp4'),
        'file:///tmp/videos/%E7%B4%A0%E6%9D%90/%E3%82%AF%E3%83%AA%E3%83%83%E3%83%97.mp4'
    );
});

test('toFileUrl: スペースと日本語が混在するディレクトリ名も扱える', () => {
    assert.equal(toFileUrl('/tmp/a b/c.mp4'), 'file:///tmp/a%20b/c.mp4');
});
