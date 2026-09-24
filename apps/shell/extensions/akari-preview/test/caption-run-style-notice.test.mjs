import test from 'node:test';
import assert from 'node:assert/strict';
import { captionRunOmittedNotice } from '../lib/common/caption-run-style-notice.js';

test('範囲に写せない見た目は利用者向けの語で一行にする', () => {
    assert.equal(captionRunOmittedNotice(['background', 'shadow', 'animation', 'shadow']),
        '文字範囲に使えない見た目を省きました: 座布団・影・動き');
    assert.equal(captionRunOmittedNotice(['future_filter']),
        '文字範囲に使えない見た目を省きました: その他の見た目');
    assert.equal(captionRunOmittedNotice([]), undefined);
});
