import test from 'node:test';
import assert from 'node:assert/strict';
import { nextCaptionNotices } from '../lib/common/caption-notice-state.js';

test('連続する同文通知は 1 つにまとめ、別の通知は出す', () => {
    assert.deepEqual(nextCaptionNotices(undefined, ['文字範囲 1 件が外れました',
        '文字範囲 1 件が外れました', '強調 1 件が外れました']), {
        show: ['文字範囲 1 件が外れました', '強調 1 件が外れました'],
        last: '強調 1 件が外れました'
    });
    assert.deepEqual(nextCaptionNotices('強調 1 件が外れました', ['強調 1 件が外れました']), {
        show: [], last: '強調 1 件が外れました'
    });
});
