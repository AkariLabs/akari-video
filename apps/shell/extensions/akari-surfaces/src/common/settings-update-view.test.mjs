import assert from 'node:assert/strict';
import test from 'node:test';
import { applyShellUpdaterEvent, beginUserInitiatedUpdaterCheck, INITIAL_SHELL_UPDATER_UI_STATE } from '../../lib/common/shell-update-applier.js';
import { resolveSettingsUpdateView } from '../../lib/common/settings-update-view.js';

const view = (state, lastEventKind, downloadUrl) => resolveSettingsUpdateView({
    state, lastEventKind, currentVersion: '0.1.82', lastChecked: '2026/9/26 12:00:00', downloadUrl
});

test('押した直後は同期的に確認中となり、ボタンが無効になる', () => {
    const pending = view(beginUserInitiatedUpdaterCheck(INITIAL_SHELL_UPDATER_UI_STATE), 'checking-for-update');
    assert.equal(pending.label, '確認しています…');
    assert.equal(pending.button.disabled, true);
    assert.equal(pending.button.kind, 'check');
});

test('新版の DL 中は新旧の版を表示し、完了後は再起動ボタンへ進む', () => {
    const downloading = applyShellUpdaterEvent(INITIAL_SHELL_UPDATER_UI_STATE, { kind: 'update-available', version: '0.1.87' });
    const inProgress = view(downloading, 'update-available');
    assert.match(inProgress.label, /v0\.1\.87.*ダウンロードしています/);
    assert.match(inProgress.detail, /現在 v0\.1\.82/);
    assert.equal(inProgress.button.disabled, true);
    const ready = view(applyShellUpdaterEvent(downloading, { kind: 'update-downloaded', version: '0.1.87' }), 'update-downloaded');
    assert.equal(ready.label, 'v0.1.87 の準備ができました');
    assert.deepEqual(ready.button, { kind: 'restart', label: '再起動して更新', disabled: false, primary: true });
});

test('最新版は現在版と最終確認時刻を表示する', () => {
    const latest = view(applyShellUpdaterEvent(INITIAL_SHELL_UPDATER_UI_STATE, { kind: 'update-not-available' }), 'update-not-available');
    assert.equal(latest.label, '最新です（v0.1.82）');
    assert.match(latest.detail, /2026\/9\/26 12:00:00/);
});

test('失敗は理由と再試行を表示し、配布先があればブラウザ導線も出す', () => {
    const failed = applyShellUpdaterEvent(beginUserInitiatedUpdaterCheck(INITIAL_SHELL_UPDATER_UI_STATE), {
        kind: 'error', reason: 'オフラインのため確認できませんでした'
    });
    const fallback = view(failed, 'error', 'https://example.com/update.dmg');
    assert.match(fallback.label, /オフライン/);
    assert.equal(fallback.button.label, 'もう一度確かめる');
    assert.equal(fallback.button.disabled, false);
    assert.equal(fallback.browserFallback, true);
    assert.equal(view(failed, 'error').browserFallback, false);
});
