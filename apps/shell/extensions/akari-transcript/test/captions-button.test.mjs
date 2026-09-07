import test from 'node:test';
import assert from 'node:assert/strict';
import { captionsButtonLabel } from '../lib/common/captions-button.js';

test('処理済みの素材がなければ連続実行の文言を表示する', () => {
    for (const states of [[], ['none'], ['running'], ['none', 'running']]) {
        assert.equal(captionsButtonLabel(states), '文字起こしして字幕を作る');
    }
});
test('処理済みの素材があれば字幕生成の文言を表示する', () => {
    assert.equal(captionsButtonLabel(['done']), '字幕を作る');
    assert.equal(captionsButtonLabel(['none', 'done']), '字幕を作る');
});
