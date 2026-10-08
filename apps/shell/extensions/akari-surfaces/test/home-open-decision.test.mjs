import test from 'node:test';
import assert from 'node:assert/strict';
import { decideOpenFlow, openChoices, shouldAnimateOpen } from '../lib/browser/home/home-open-decision.js';

test('確認を省く設定は作業中でない場合だけ有効', () => {
    assert.equal(decideOpenFlow({ ask: false, busy: false, hasOrigin: true, reducedMotion: false }), 'direct');
    assert.equal(decideOpenFlow({ ask: false, busy: true, hasOrigin: true, reducedMotion: false }), 'confirm');
    assert.equal(decideOpenFlow({ ask: true, busy: false, hasOrigin: false, reducedMotion: true }), 'confirm');
});

test('作業中は予約を先頭に置き、動きは押した位置がある場合だけ', () => {
    assert.deepEqual(openChoices(true), ['after-work', 'here', 'new-window']);
    assert.deepEqual(openChoices(false), ['here', 'new-window']);
    assert.equal(shouldAnimateOpen({ hasOrigin: true, reducedMotion: false }), true);
    assert.equal(shouldAnimateOpen({ hasOrigin: false, reducedMotion: false }), false);
    assert.equal(shouldAnimateOpen({ hasOrigin: true, reducedMotion: true }), false);
});
