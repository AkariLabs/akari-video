import { setLanguage } from '@akari-video/i18n';
import { after } from 'node:test';
setLanguage('ja');
after(() => setLanguage(undefined));
import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizePreviewError } from '../lib/common/preview-error-summary.js';

test('エラー要旨は先頭行だけを空白正規化しスタック断片を除く', () => {
    assert.equal(
        summarizePreviewError(new Error('  source.path   が不正です  \n    at load (preview.js:12:4)')),
        'source.path が不正です'
    );
    assert.equal(
        summarizePreviewError(new Error('読み込み失敗 at loadPreview (preview.js:12:4)')),
        '読み込み失敗'
    );
    assert.equal(summarizePreviewError({ code: 7 }), '原因不明のエラーです。');
});

test('JSON.parse の SyntaxError は edit.json の文脈を付ける', () => {
    const error = new SyntaxError("Expected property name or '}' in JSON at position 1 (line 1 column 2)");
    assert.equal(
        summarizePreviewError(error),
        "edit.json を JSON として読めません（Expected property name or '}' in JSON at position 1 (line 1 column 2)）"
    );
});

test('見つからない素材は、長い絶対パスではなくファイル名で伝える', () => {
    const windows = new Error("ENOENT: no such file or directory, realpath 'c:\\work\\a long project folder name\\channels\\demo\\videos\\demo-video\\assets\\generated\\city map.png'");
    assert.equal(summarizePreviewError(windows), '素材がまだ見つかりません（city map.png）');
    const posix = new Error("ENOENT: no such file or directory, stat '/work/demo/assets/generated/map.png'");
    assert.equal(summarizePreviewError(posix), '素材がまだ見つかりません（map.png）');
});

test('要旨は 160 文字以内へ省略し空なら既定文言へ落とす', () => {
    const summary = summarizePreviewError(new Error('x'.repeat(200)));
    assert.equal(summary.length, 160);
    assert.ok(summary.endsWith('…'));
    assert.equal(summarizePreviewError(new Error(' \n at load (preview.js:1:2)')), '原因不明のエラーです。');
    assert.equal(summarizePreviewError(null), '原因不明のエラーです。');
    assert.equal(summarizePreviewError(undefined), '原因不明のエラーです。');
});
