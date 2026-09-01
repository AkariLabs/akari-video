import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { shouldAutoScroll } = require('../lib/common/daihon-autoscroll.js');

test('再生中・行が不可視・手動スクロールから2秒以上で自動追従する', () => {
    assert.equal(shouldAutoScroll({
        playing: true, currentRowVisible: false, userScrolledRecentlyMs: 2000
    }), true);
});

test('停止中は自動追従しない', () => {
    assert.equal(shouldAutoScroll({
        playing: false, currentRowVisible: false, userScrolledRecentlyMs: 5000
    }), false);
});

test('現在行が見えている間は自動追従しない', () => {
    assert.equal(shouldAutoScroll({
        playing: true, currentRowVisible: true, userScrolledRecentlyMs: 5000
    }), false);
});

test('手動スクロールから2秒未満は自動追従しない', () => {
    assert.equal(shouldAutoScroll({
        playing: true, currentRowVisible: false, userScrolledRecentlyMs: 1999
    }), false);
});
