import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { automaticGuideTransition, guideRecoveryView } = require('../../lib/onboarding/recovery-model.js');
const facts = { step: 'tour3', sub: 1, elapsedMs: 0, idleMs: 0, hasVisibleAction: false, transitioning: false, failed: false };

test('画面案内は利用者の操作まで自動進行しない', () => {
    assert.equal(automaticGuideTransition('tour0', 0), undefined);
    assert.equal(automaticGuideTransition('tour2', 0), undefined);
    assert.equal(automaticGuideTransition('tour3', 1), undefined);
    assert.equal(automaticGuideTransition('tour3', 0), undefined);
});

test('自動進行が失敗した画面は再試行と閉じるで回復できる', () => {
    assert.deepEqual(guideRecoveryView({ ...facts, failed: true, elapsedMs: 2500 }),
        { showFallbackNext: false, showIdleClose: false, showError: true, showRetry: true });
    assert.deepEqual(guideRecoveryView({ ...facts, failed: true, transitioning: true, elapsedMs: 12000, idleMs: 12000 }),
        { showFallbackNext: false, showIdleClose: false, showError: true, showRetry: false });
});

test('自動進行の代わりに遅れて次へを出すこともない', () => {
    assert.equal(guideRecoveryView({ ...facts, elapsedMs: 5299 }).showFallbackNext, false);
    assert.equal(guideRecoveryView({ ...facts, elapsedMs: 5300 }).showFallbackNext, false);
    assert.equal(guideRecoveryView({ ...facts, elapsedMs: 5300, transitioning: true }).showFallbackNext, false);
    assert.equal(guideRecoveryView({ ...facts, elapsedMs: 5300, hasVisibleAction: true }).showFallbackNext, false);
    assert.equal(guideRecoveryView({ ...facts, step: 'tour0', sub: 0, elapsedMs: 5200 }).showFallbackNext, false);
    assert.equal(guideRecoveryView({ ...facts, step: 'tour2', sub: 0, elapsedMs: 6000,
        hasVisibleAction: true }).showFallbackNext, false);
});

test('同じ画面で10秒無操作なら閉じるを表示し、完了画面では表示しない', () => {
    assert.equal(guideRecoveryView({ ...facts, elapsedMs: 20000, idleMs: 9999 }).showIdleClose, false);
    assert.equal(guideRecoveryView({ ...facts, elapsedMs: 20000, idleMs: 10000 }).showIdleClose, true);
    assert.equal(guideRecoveryView({ ...facts, step: 'done', elapsedMs: 20000, idleMs: 20000 }).showIdleClose, false);
});
