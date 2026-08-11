import assert from 'node:assert/strict';
import test from 'node:test';

// update-feed.test.mjs と同じ流儀（`src/common/` 同居 — task.md 所有パス境界のため
// `test/` へは置けない）。`npm run build:ext`（tsc -b）で隣の shell-update-applier.ts を
// コンパイルした後、`node --test` が拾って直接実行できる。
import {
    applyShellUpdaterEvent,
    formatDownloadedBannerText,
    INITIAL_SHELL_UPDATER_UI_STATE,
    resolveAllowPrerelease
} from '../../lib/common/shell-update-applier.js';

test('applyShellUpdaterEvent: update-downloaded で downloaded: true + version が入る（通知→DL済み・再起動ボタンの遷移）', () => {
    const next = applyShellUpdaterEvent(INITIAL_SHELL_UPDATER_UI_STATE, { kind: 'update-downloaded', version: '0.2.0' });
    assert.deepEqual(next, { downloaded: true, downloadedVersion: '0.2.0' });
});

test('applyShellUpdaterEvent: version の無い update-downloaded は無視する（壊れたペイロード対策）', () => {
    const next = applyShellUpdaterEvent(INITIAL_SHELL_UPDATER_UI_STATE, { kind: 'update-downloaded' });
    assert.deepEqual(next, INITIAL_SHELL_UPDATER_UI_STATE);
});

test('applyShellUpdaterEvent: error は状態を変えず沈黙する（契約§11の沈黙原則）', () => {
    const downloaded = { downloaded: true, downloadedVersion: '0.2.0' };
    assert.deepEqual(applyShellUpdaterEvent(downloaded, { kind: 'error', message: 'network down' }), downloaded);
    assert.deepEqual(applyShellUpdaterEvent(INITIAL_SHELL_UPDATER_UI_STATE, { kind: 'error', message: 'oops' }), INITIAL_SHELL_UPDATER_UI_STATE);
});

test('applyShellUpdaterEvent: update-available / update-not-available / checking-for-update は状態を変えない（U2 バナーが「通知」を担うため）', () => {
    for (const kind of ['update-available', 'update-not-available', 'checking-for-update']) {
        assert.deepEqual(applyShellUpdaterEvent(INITIAL_SHELL_UPDATER_UI_STATE, { kind, version: '0.2.0' }), INITIAL_SHELL_UPDATER_UI_STATE);
    }
});

test('applyShellUpdaterEvent: DL 済み状態から再度 update-available が来ても downloaded は維持される（DL 済みバナーが消えない）', () => {
    const downloaded = { downloaded: true, downloadedVersion: '0.2.0' };
    assert.deepEqual(applyShellUpdaterEvent(downloaded, { kind: 'update-available', version: '0.2.0' }), downloaded);
});

test('resolveAllowPrerelease: stable 以外（prerelease・undefined・null・壊れた値）はすべて true', () => {
    assert.equal(resolveAllowPrerelease('prerelease'), true);
    assert.equal(resolveAllowPrerelease(undefined), true);
    assert.equal(resolveAllowPrerelease(null), true);
    assert.equal(resolveAllowPrerelease(''), true);
});

test('resolveAllowPrerelease: stable のときだけ false', () => {
    assert.equal(resolveAllowPrerelease('stable'), false);
});

test('formatDownloadedBannerText: downloaded: true + version ありなら文言が入る', () => {
    assert.equal(
        formatDownloadedBannerText({ downloaded: true, downloadedVersion: '0.2.0' }),
        'AKARI Video v0.2.0 をダウンロード済みです。再起動すると適用されます。'
    );
});

test('formatDownloadedBannerText: downloaded: false / version 無しは空文字（バナー非表示の合図）', () => {
    assert.equal(formatDownloadedBannerText(INITIAL_SHELL_UPDATER_UI_STATE), '');
    assert.equal(formatDownloadedBannerText({ downloaded: true }), '');
});
