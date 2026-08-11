import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldAutoOpenFirstRunSetup } from '../../lib/common/first-run-onboarding.js';

const FIRST_RUN = {
    hasOpenProject: false,
    hasCreatorRootPointer: false,
    hasProjectHistory: false,
    markerSeen: false
};

test('完全初回だけセットアップを自動表示する', () => {
    assert.equal(shouldAutoOpenFirstRunSetup(FIRST_RUN), true);
});

test('表示済みマーカーがあれば2回目以降は自動表示しない', () => {
    assert.equal(shouldAutoOpenFirstRunSetup({ ...FIRST_RUN, markerSeen: true }), false);
});

test('作業場ポインタまたはプロジェクト履歴があれば既存利用者として自動表示しない', () => {
    assert.equal(shouldAutoOpenFirstRunSetup({ ...FIRST_RUN, hasCreatorRootPointer: true }), false);
    assert.equal(shouldAutoOpenFirstRunSetup({ ...FIRST_RUN, hasProjectHistory: true }), false);
});

test('プロジェクトを開いているときは自動表示しない', () => {
    assert.equal(shouldAutoOpenFirstRunSetup({ ...FIRST_RUN, hasOpenProject: true }), false);
});
