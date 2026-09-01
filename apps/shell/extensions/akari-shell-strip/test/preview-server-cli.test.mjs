import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildPreviewOpenUrl,
    buildPreviewServerArgs,
    describePreviewServerFailure,
    parsePreviewServerReadyUrl,
    PREVIEW_SERVER_DEFAULT_PORT,
    PREVIEW_SERVER_HOST,
    PREVIEW_SERVER_PORT_ATTEMPTS,
    PREVIEW_SERVER_READY_TIMEOUT_MS
} from '../lib/common/preview-server-cli.js';

// server.mjs 末尾（server.listen コールバック）の実起動ログ 4 行（task.md 事実確認 3）。
const READY_LOG = [
    '  AKARI Video Preview Server',
    '  http://127.0.0.1:4567',
    '  bind: 127.0.0.1:4567',
    '  project: /projects/demo'
].join('\n');

test('定数: akari.sh --preview の既定（4567 起点・10 個・127.0.0.1・10 秒）に揃う', () => {
    assert.equal(PREVIEW_SERVER_DEFAULT_PORT, 4567);
    assert.equal(PREVIEW_SERVER_PORT_ATTEMPTS, 10);
    assert.equal(PREVIEW_SERVER_HOST, '127.0.0.1');
    assert.equal(PREVIEW_SERVER_READY_TIMEOUT_MS, 10_000);
});

test('buildPreviewServerArgs: [projectRoot, --port, <n>, --host, 127.0.0.1]', () => {
    assert.deepEqual(
        buildPreviewServerArgs('/projects/demo', 4568),
        ['/projects/demo', '--port', '4568', '--host', '127.0.0.1']
    );
});

test('parsePreviewServerReadyUrl: 実ログ 4 行から最初の URL を拾う（末尾スラッシュ無し）', () => {
    assert.equal(parsePreviewServerReadyUrl(READY_LOG), 'http://127.0.0.1:4567');
});

test('parsePreviewServerReadyUrl: URL 行が無ければ undefined', () => {
    assert.equal(parsePreviewServerReadyUrl('[watch] watching /projects/demo\n'), undefined);
    assert.equal(parsePreviewServerReadyUrl(''), undefined);
});

test('buildPreviewOpenUrl: latest はルート', () => {
    assert.equal(buildPreviewOpenUrl('http://127.0.0.1:4567', 'latest'), 'http://127.0.0.1:4567/');
});

test('buildPreviewOpenUrl: legacy は ?frameEngine=0（従来 DOM プレビュー）', () => {
    assert.equal(buildPreviewOpenUrl('http://127.0.0.1:4567', 'legacy'), 'http://127.0.0.1:4567/?frameEngine=0');
});

test('describePreviewServerFailure: stderr に EADDRINUSE → ポート使用中の日本語', () => {
    const summary = describePreviewServerFailure(
        1,
        'Error: listen EADDRINUSE: address already in use 127.0.0.1:4567',
        4567
    );
    assert.equal(summary, 'ポート 4567 は別のプロセスが使用中です');
});

test('describePreviewServerFailure: stderr ありは末尾要約', () => {
    const summary = describePreviewServerFailure(1, 'first line\nError: something broke\n', 4567);
    assert.match(summary, /Error: something broke/);
});

test('describePreviewServerFailure: stderr 空は exit code を明記', () => {
    assert.equal(
        describePreviewServerFailure(3, '', 4567),
        'exit code 3 で終了しました（エラー出力はありません）'
    );
    assert.equal(
        describePreviewServerFailure(null, '   \n', 4567),
        'exit code 不明 で終了しました（エラー出力はありません）'
    );
});
