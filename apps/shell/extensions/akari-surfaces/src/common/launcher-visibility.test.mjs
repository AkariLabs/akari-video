import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldAutoOpenProjectLauncher } from '../../lib/common/launcher-visibility.js';

const BASE = {
    hasOpenProject: false,
    firstRunWillAutoOpen: false,
    dismissedThisSession: false
};

test('プロジェクト無しで起動すると自動表示する', () => {
    assert.equal(shouldAutoOpenProjectLauncher(BASE), true);
});

test('プロジェクトを開いて起動したときは自動表示しない', () => {
    assert.equal(shouldAutoOpenProjectLauncher({ ...BASE, hasOpenProject: true }), false);
});

test('初回セットアップが自動表示される起動では、ランチャーはここでは開かない（優先関係）', () => {
    assert.equal(shouldAutoOpenProjectLauncher({ ...BASE, firstRunWillAutoOpen: true }), false);
});

test('同一セッション内で一度閉じたら再度は自動表示しない', () => {
    assert.equal(shouldAutoOpenProjectLauncher({ ...BASE, dismissedThisSession: true }), false);
});

test('プロジェクトが開いていて初回セットアップも優先で閉じ済みでも、理由に関わらず false のまま', () => {
    assert.equal(
        shouldAutoOpenProjectLauncher({ hasOpenProject: true, firstRunWillAutoOpen: true, dismissedThisSession: true }),
        false
    );
});
