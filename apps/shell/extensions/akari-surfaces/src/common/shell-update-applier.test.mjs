import assert from 'node:assert/strict';
import test from 'node:test';

// update-feed.test.mjs と同じ流儀（`src/common/` 同居 — task.md 所有パス境界のため
// `test/` へは置けない）。`npm run build:ext`（tsc -b）で隣の shell-update-applier.ts を
// コンパイルした後、`node --test` が拾って直接実行できる。
import {
    applyShellUpdaterEvent,
    formatDownloadedBannerText,
    formatDownloadingBannerText,
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

test('applyShellUpdaterEvent: update-available で「ダウンロード中」状態になる（autoDownload の進行を可視化）', () => {
    const next = applyShellUpdaterEvent(INITIAL_SHELL_UPDATER_UI_STATE, { kind: 'update-available', version: '0.2.0' });
    assert.deepEqual(next, { downloaded: false, downloading: true, downloadingVersion: '0.2.0' });
});

test('applyShellUpdaterEvent: version の無い update-available は無視する（壊れたペイロード対策）', () => {
    assert.deepEqual(applyShellUpdaterEvent(INITIAL_SHELL_UPDATER_UI_STATE, { kind: 'update-available' }), INITIAL_SHELL_UPDATER_UI_STATE);
});

test('applyShellUpdaterEvent: ダウンロード中 → update-downloaded で DL 済み状態へ進む', () => {
    const downloading = { downloaded: false, downloading: true, downloadingVersion: '0.2.0' };
    assert.deepEqual(applyShellUpdaterEvent(downloading, { kind: 'update-downloaded', version: '0.2.0' }), { downloaded: true, downloadedVersion: '0.2.0' });
});

test('applyShellUpdaterEvent: error はユーザーに例外を露出しない（契約§11）— DL 済みなら維持、それ以外は failed で手動 DL へ縮退', () => {
    const downloaded = { downloaded: true, downloadedVersion: '0.2.0' };
    assert.deepEqual(applyShellUpdaterEvent(downloaded, { kind: 'error', message: 'network down' }), downloaded);
    assert.deepEqual(applyShellUpdaterEvent(INITIAL_SHELL_UPDATER_UI_STATE, { kind: 'error', message: 'oops' }), { downloaded: false, failed: true });
    const downloading = { downloaded: false, downloading: true, downloadingVersion: '0.2.0' };
    assert.deepEqual(applyShellUpdaterEvent(downloading, { kind: 'error', message: 'oops' }), { downloaded: false, failed: true });
});

test('applyShellUpdaterEvent: update-not-available はダウンロード中表示だけ畳む / checking-for-update は状態を変えない', () => {
    const downloading = { downloaded: false, downloading: true, downloadingVersion: '0.2.0' };
    assert.deepEqual(applyShellUpdaterEvent(downloading, { kind: 'update-not-available' }), { downloaded: false });
    assert.deepEqual(applyShellUpdaterEvent(INITIAL_SHELL_UPDATER_UI_STATE, { kind: 'update-not-available' }), INITIAL_SHELL_UPDATER_UI_STATE);
    assert.deepEqual(applyShellUpdaterEvent(downloading, { kind: 'checking-for-update' }), downloading);
    assert.deepEqual(applyShellUpdaterEvent(INITIAL_SHELL_UPDATER_UI_STATE, { kind: 'checking-for-update' }), INITIAL_SHELL_UPDATER_UI_STATE);
});

test('applyShellUpdaterEvent: DL 済み状態から再度 update-available / error が来ても downloaded は維持される（DL 済みバナーが消えない）', () => {
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

test('formatDownloadingBannerText: ダウンロード中 + version ありなら文言が入る', () => {
    assert.equal(
        formatDownloadingBannerText({ downloaded: false, downloading: true, downloadingVersion: '0.2.0' }),
        'AKARI Video v0.2.0 をダウンロードしています。完了すると再起動ボタンが表示されます。'
    );
});

test('formatDownloadingBannerText: DL 中でない / version 無し / DL 済みは空文字（バナー非表示の合図）', () => {
    assert.equal(formatDownloadingBannerText(INITIAL_SHELL_UPDATER_UI_STATE), '');
    assert.equal(formatDownloadingBannerText({ downloaded: false, downloading: true }), '');
    assert.equal(formatDownloadingBannerText({ downloaded: true, downloadedVersion: '0.2.0', downloading: true, downloadingVersion: '0.2.0' }), '');
});
