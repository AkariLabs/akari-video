import assert from 'node:assert/strict';
import test from 'node:test';
import { withCaptionPreviewFailure } from '../lib/browser/inspector/caption-preview-write.js';

test('字幕効果の失敗だけ仮適用の解除を通知する', async () => {
    const notices = [];
    const request = { kind: 'caption-style-effect', id: 'placed', value: {} };
    const failed = await withCaptionPreviewFailure(request,
        Promise.resolve({ ok: false, message: '保存できません' }), detail => notices.push(detail));
    assert.equal(failed.ok, false);
    assert.deepEqual(notices, [{ captionId: 'placed', textStyle: null, failed: true }]);
    await withCaptionPreviewFailure(request, Promise.resolve({ ok: true }), detail => notices.push(detail));
    await withCaptionPreviewFailure({ kind: 'caption-text', id: 'placed', value: '文字' },
        Promise.resolve({ ok: false }), detail => notices.push(detail));
    assert.equal(notices.length, 1);
});
