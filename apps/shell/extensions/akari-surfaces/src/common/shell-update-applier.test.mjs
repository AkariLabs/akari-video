import assert from 'node:assert/strict';
import test from 'node:test';

// update-feed.test.mjs と同じ流儀（`src/common/` 同居 — task.md 所有パス境界のため
// `test/` へは置けない）。`npm run build:ext`（tsc -b）で隣の shell-update-applier.ts を
// コンパイルした後、`node --test` が拾って直接実行できる。
import {
    applyImmediateUpdaterFallback,
    applyShellUpdaterEvent,
    beginUserInitiatedUpdaterCheck,
    checkForShellUpdatesOnHomeShow,
    formatDownloadedBannerText,
    formatDownloadingBannerText,
    formatUpdaterFallbackText,
    INITIAL_SHELL_UPDATER_UI_STATE,
    isAppTranslocationPath,
    resolveAllowPrerelease,
    resolveShellUpdaterErrorReason,
    resolveUpdateButtonAction,
    shouldOpenUpdaterBrowserFallback
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

test('applyShellUpdaterEvent: DL 済み版より新しい update-available が staged を追い越し、新版の DL 済みへ進む', () => {
    const downloaded = { downloaded: true, downloadedVersion: '0.1.19' };
    const downloading = applyShellUpdaterEvent(downloaded, { kind: 'update-available', version: '0.1.20' });
    assert.deepEqual(downloading, { downloaded: false, downloading: true, downloadingVersion: '0.1.20' });
    assert.deepEqual(applyShellUpdaterEvent(downloading, { kind: 'update-downloaded', version: '0.1.20' }), {
        downloaded: true,
        downloadedVersion: '0.1.20'
    });
});

test('applyShellUpdaterEvent: DL 済み版と同じ・古い update-available では staged を維持する', () => {
    const downloaded = { downloaded: true, downloadedVersion: '0.1.19' };
    assert.equal(applyShellUpdaterEvent(downloaded, { kind: 'update-available', version: '0.1.19' }), downloaded);
    assert.equal(applyShellUpdaterEvent(downloaded, { kind: 'update-available', version: '0.1.18' }), downloaded);
});

test('applyShellUpdaterEvent: staged より古い update-downloaded では状態を巻き戻さない', () => {
    const downloaded = { downloaded: true, downloadedVersion: '0.1.20' };
    assert.equal(applyShellUpdaterEvent(downloaded, { kind: 'update-downloaded', version: '0.1.19' }), downloaded);
});

test('applyShellUpdaterEvent: error は reason を保持し、DL 済みなら既存状態を維持する', () => {
    const downloaded = { downloaded: true, downloadedVersion: '0.2.0' };
    assert.deepEqual(applyShellUpdaterEvent(downloaded, { kind: 'error', reason: 'network down' }), downloaded);
    assert.deepEqual(applyShellUpdaterEvent(INITIAL_SHELL_UPDATER_UI_STATE, { kind: 'error', reason: 'oops' }), {
        downloaded: false,
        failed: true,
        failureReason: 'oops',
        fallbackReason: undefined
    });
    const downloading = { downloaded: false, downloading: true, downloadingVersion: '0.2.0' };
    assert.deepEqual(applyShellUpdaterEvent(downloading, { kind: 'error', message: 'legacy message' }), {
        downloaded: false,
        failed: true,
        failureReason: 'legacy message',
        fallbackReason: undefined
    });
});

test('applyShellUpdaterEvent: checking-for-update / update-not-available は failed を解除して再試行から回復できる', () => {
    const downloading = { downloaded: false, downloading: true, downloadingVersion: '0.2.0' };
    assert.deepEqual(applyShellUpdaterEvent(downloading, { kind: 'update-not-available' }), { downloaded: false });
    assert.deepEqual(applyShellUpdaterEvent(INITIAL_SHELL_UPDATER_UI_STATE, { kind: 'update-not-available' }), INITIAL_SHELL_UPDATER_UI_STATE);
    assert.deepEqual(applyShellUpdaterEvent(downloading, { kind: 'checking-for-update' }), downloading);
    assert.deepEqual(applyShellUpdaterEvent(INITIAL_SHELL_UPDATER_UI_STATE, { kind: 'checking-for-update' }), INITIAL_SHELL_UPDATER_UI_STATE);
    const failed = { downloaded: false, failed: true, failureReason: 'offline' };
    assert.deepEqual(applyShellUpdaterEvent(failed, { kind: 'checking-for-update' }), INITIAL_SHELL_UPDATER_UI_STATE);
    assert.deepEqual(applyShellUpdaterEvent(failed, { kind: 'update-not-available' }), INITIAL_SHELL_UPDATER_UI_STATE);
    const downloadingAfterFailure = {
        downloaded: false,
        downloading: true,
        downloadingVersion: '0.2.0',
        failed: true,
        failureReason: 'offline',
        fallbackReason: 'offline',
        checkRequestedByUser: true
    };
    assert.deepEqual(applyShellUpdaterEvent(downloadingAfterFailure, { kind: 'checking-for-update' }), {
        downloaded: false,
        downloading: true,
        downloadingVersion: '0.2.0',
        checkRequestedByUser: true
    });
});

test('failed 中の更新ボタンも API があればまず再試行し、明示クリックの失敗だけブラウザ縮退理由を出す', () => {
    const failed = { downloaded: false, failed: true, failureReason: 'offline' };
    assert.equal(resolveUpdateButtonAction(failed, true), 'check');
    const checking = beginUserInitiatedUpdaterCheck(failed);
    assert.deepEqual(checking, { downloaded: false, checkRequestedByUser: true });
    const error = { kind: 'error', reason: 'still offline' };
    assert.equal(shouldOpenUpdaterBrowserFallback(checking, error), true);
    const fallback = applyShellUpdaterEvent(checking, error);
    assert.equal(formatUpdaterFallbackText(fallback), 'アプリ内更新が使えないため、ブラウザでダウンロードページを開きます（理由: still offline）');
});

test('ホーム表示時の updater 再チェックは DL 済み状態による分岐を持たず、API を 1 回だけ発火する', async () => {
    let checks = 0;
    checkForShellUpdatesOnHomeShow({
        checkForUpdatesNow: async () => {
            checks += 1;
            throw new Error('background failure');
        }
    });
    assert.equal(checks, 1);
    await Promise.resolve();
});

test('バックグラウンドチェックの失敗では縮退表示もブラウザ遷移も発生しない', () => {
    const error = { kind: 'error', reason: 'background failure' };
    assert.equal(shouldOpenUpdaterBrowserFallback(INITIAL_SHELL_UPDATER_UI_STATE, error), false);
    const failed = applyShellUpdaterEvent(INITIAL_SHELL_UPDATER_UI_STATE, error);
    assert.equal(formatUpdaterFallbackText(failed), '');
});

test('API 不在時は明示クリックから即ブラウザ縮退し、理由を一行表示する', () => {
    assert.equal(resolveUpdateButtonAction(INITIAL_SHELL_UPDATER_UI_STATE, false), 'browser-fallback');
    const fallback = applyImmediateUpdaterFallback(INITIAL_SHELL_UPDATER_UI_STATE, 'アプリ内更新機能を利用できませんでした');
    assert.equal(formatUpdaterFallbackText(fallback), 'アプリ内更新が使えないため、ブラウザでダウンロードページを開きます（理由: アプリ内更新機能を利用できませんでした）');
});

test('App Translocation の実行パスだけを検知し、具体的な移動案内を優先する', () => {
    const translated = '/private/var/folders/xx/AppTranslocation/ABC/d/AKARI Video.app/Contents/MacOS/AKARI Video';
    assert.equal(isAppTranslocationPath(translated), true);
    assert.equal(isAppTranslocationPath('/Applications/AKARI Video.app/Contents/MacOS/AKARI Video'), false);
    assert.equal(isAppTranslocationPath('/tmp/AppTranslocation-backup/AKARI Video'), false);
    assert.equal(resolveShellUpdaterErrorReason('network down', translated), 'アプリを Applications フォルダへ移動してから再起動してください');
});

test('ネットワーク系エラーは再試行方法を含む理由へ整形し、それ以外は生 message を保つ', () => {
    assert.equal(
        resolveShellUpdaterErrorReason('net::ERR_INTERNET_DISCONNECTED', '/Applications/AKARI Video.app/Contents/MacOS/AKARI Video'),
        'オフラインのため確認できませんでした。ネットワーク接続後にもう一度押すか、アプリを再起動してください'
    );
    assert.equal(resolveShellUpdaterErrorReason('signature validation failed', '/Applications/AKARI Video.app'), 'signature validation failed');
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
