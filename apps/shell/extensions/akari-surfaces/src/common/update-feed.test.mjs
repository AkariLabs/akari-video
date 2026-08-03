import assert from 'node:assert/strict';
import test from 'node:test';

// このファイルはあえて `src/common/` に同居させている（`test/` は本タスクの
// 編集境界外 — task.md 所有パスは `apps/shell/extensions/akari-surfaces/src/` のみ）。
// node --test は既定でリポジトリ全体を再帰探索し、場所によらず `*.test.mjs` を
// 拾うため、`npm run build:ext`（tsc -b）でこの隣の update-feed.ts をコンパイルした
// 後に `node --test src/common/update-feed.test.mjs` として直接実行できる。
import {
    compareVersions,
    evaluateUpdateStatus,
    formatHomeBannerText,
    isValidFeedShape,
    parseUpdateCache,
    resolveUpdateDownloadUrl,
    withDismissedVersion,
    withFetchedFeed
} from '../../lib/common/update-feed.js';

const VALID_FEED = {
    schema: 1,
    product: '0.2.0',
    channel: 'prerelease',
    notes_url: 'https://github.com/AkariLabs/akari-video/releases/tag/v0.2.0',
    components: { cli: { version: '0.2.0' } }
};

// 実スキーマ（scripts/release/gen-latest-json.mjs が生成する latest.json）どおり
// components.shell.mac/win/win_zip を持つフィード（F7-v1 のテスト用）。
const FEED_WITH_SHELL_ASSETS = {
    ...VALID_FEED,
    components: {
        ...VALID_FEED.components,
        shell: {
            version: '0.2.0',
            mac: { url: 'https://github.com/AkariLabs/akari-video/releases/download/v0.2.0/shell-mac.zip', sha256: 'aaa' },
            win: { url: 'https://github.com/AkariLabs/akari-video/releases/download/v0.2.0/shell-win-setup.exe', sha256: 'bbb' },
            win_zip: { url: 'https://github.com/AkariLabs/akari-video/releases/download/v0.2.0/shell-win.zip', sha256: 'ccc' }
        }
    }
};

test('compareVersions: major.minor.patch を数値比較する', () => {
    assert.equal(compareVersions('0.2.0', '0.1.0'), 1);
    assert.equal(compareVersions('0.1.0', '0.1.0'), 0);
    assert.equal(compareVersions('0.1.0', '0.2.0'), -1);
    assert.equal(compareVersions('0.10.0', '0.9.0'), 1, '桁数の異なる文字列比較にならないこと');
});

test('isValidFeedShape: schema/product が揃っていれば true', () => {
    assert.equal(isValidFeedShape(VALID_FEED), true);
    assert.equal(isValidFeedShape({ schema: 1 }), false, 'product が無ければ false');
    assert.equal(isValidFeedShape(null), false);
    assert.equal(isValidFeedShape('not an object'), false);
});

test('parseUpdateCache: 壊れた JSON は例外を投げず null', () => {
    assert.equal(parseUpdateCache('{ not json'), null);
});

test('parseUpdateCache: 正常な JSON はそのまま返す', () => {
    const cache = parseUpdateCache(JSON.stringify({ schema: 1, feed: VALID_FEED, dismissed: {} }));
    assert.equal(cache.feed.product, '0.2.0');
});

test('evaluateUpdateStatus: 新版があり dismissed されていなければ available: true', () => {
    const cache = { schema: 1, fetched_at: '2026-07-26T00:00:00.000Z', feed: VALID_FEED, dismissed: {} };
    const status = evaluateUpdateStatus('0.1.0', cache);
    assert.equal(status.available, true);
    assert.equal(status.latestVersion, '0.2.0');
    assert.equal(status.channel, 'prerelease');
    assert.equal(status.notesUrl, VALID_FEED.notes_url);
});

test('evaluateUpdateStatus: 現在と同じか新しくなければ available: false', () => {
    const sameCache = { schema: 1, feed: { ...VALID_FEED, product: '0.1.0' }, dismissed: {} };
    assert.equal(evaluateUpdateStatus('0.1.0', sameCache).available, false);
});

test('evaluateUpdateStatus: dismissed 済みの版では available: false', () => {
    const cache = { schema: 1, feed: VALID_FEED, dismissed: { '0.2.0': '2026-07-26T01:00:00.000Z' } };
    const status = evaluateUpdateStatus('0.1.0', cache);
    assert.equal(status.available, false);
    assert.equal(status.dismissed, true);
});

test('evaluateUpdateStatus: キャッシュ無し(null)は available: false（例外にならない）', () => {
    assert.equal(evaluateUpdateStatus('0.1.0', null).available, false);
});

test('evaluateUpdateStatus: 壊れたフィード（product が無い）は available: false', () => {
    const cache = { schema: 1, feed: { schema: 1 }, dismissed: {} };
    assert.equal(evaluateUpdateStatus('0.1.0', cache).available, false);
});

test('evaluateUpdateStatus: platform を渡すと downloadUrl に自プラットフォームの配布物 URL が入る（F7-v1）', () => {
    const cache = { schema: 1, feed: FEED_WITH_SHELL_ASSETS, dismissed: {} };
    assert.equal(evaluateUpdateStatus('0.1.0', cache, 'mac').downloadUrl, FEED_WITH_SHELL_ASSETS.components.shell.mac.url);
    assert.equal(evaluateUpdateStatus('0.1.0', cache, 'win').downloadUrl, FEED_WITH_SHELL_ASSETS.components.shell.win.url);
});

test('evaluateUpdateStatus: platform 省略時 / 配布物 URL が無い版は downloadUrl が notes_url にフォールバックする', () => {
    const cache = { schema: 1, feed: FEED_WITH_SHELL_ASSETS, dismissed: {} };
    assert.equal(evaluateUpdateStatus('0.1.0', cache).downloadUrl, FEED_WITH_SHELL_ASSETS.notes_url);
    const noAssetsCache = { schema: 1, feed: VALID_FEED, dismissed: {} };
    assert.equal(evaluateUpdateStatus('0.1.0', noAssetsCache, 'mac').downloadUrl, VALID_FEED.notes_url);
});

test('resolveUpdateDownloadUrl: 自プラットフォームの配布物 URL を優先する', () => {
    assert.equal(resolveUpdateDownloadUrl(FEED_WITH_SHELL_ASSETS, 'mac'), FEED_WITH_SHELL_ASSETS.components.shell.mac.url);
});

test('resolveUpdateDownloadUrl: 配布物 URL が無ければ notes_url へフォールバックする', () => {
    assert.equal(resolveUpdateDownloadUrl(VALID_FEED, 'mac'), VALID_FEED.notes_url);
    assert.equal(resolveUpdateDownloadUrl(FEED_WITH_SHELL_ASSETS, undefined), FEED_WITH_SHELL_ASSETS.notes_url);
});

test('resolveUpdateDownloadUrl: feed が無ければ undefined', () => {
    assert.equal(resolveUpdateDownloadUrl(null, 'mac'), undefined);
    assert.equal(resolveUpdateDownloadUrl(undefined, undefined), undefined);
});

test('formatHomeBannerText: プレリリースの版名が付く（task.md 指示どおりの文言）', () => {
    const text = formatHomeBannerText({ available: true, latestVersion: '0.2.0', channel: 'prerelease' });
    assert.equal(text, 'AKARI Video v0.2.0（プレリリース）が利用できます');
});

test('formatHomeBannerText: stable は版名の注記なし', () => {
    const text = formatHomeBannerText({ available: true, latestVersion: '0.2.0', channel: 'stable' });
    assert.equal(text, 'AKARI Video v0.2.0が利用できます');
});

test('formatHomeBannerText: available: false なら空文字（バナー非表示の合図）', () => {
    assert.equal(formatHomeBannerText({ available: false }), '');
});

test('withDismissedVersion: dismissed を追加しつつ他フィールド（feed 等）は維持する', () => {
    const cache = { schema: 1, fetched_at: 't', feed: VALID_FEED, dismissed: { '0.1.0': 'x' } };
    const next = withDismissedVersion(cache, '0.2.0', '2026-07-26T02:00:00.000Z');
    assert.deepEqual(next.dismissed, { '0.1.0': 'x', '0.2.0': '2026-07-26T02:00:00.000Z' });
    assert.equal(next.feed.product, '0.2.0');
});

test('withDismissedVersion: キャッシュが無い状態(null)からでも組み立てられる', () => {
    const next = withDismissedVersion(null, '0.2.0', '2026-07-26T02:30:00.000Z');
    assert.deepEqual(next.dismissed, { '0.2.0': '2026-07-26T02:30:00.000Z' });
});

test('withFetchedFeed: 取得したフィードで置き換えつつ dismissed は温存する', () => {
    const existing = { schema: 1, fetched_at: 'old', feed: null, dismissed: { '0.1.0': 'x' } };
    const next = withFetchedFeed(existing, VALID_FEED, '2026-07-26T03:00:00.000Z');
    assert.equal(next.feed.product, '0.2.0');
    assert.deepEqual(next.dismissed, { '0.1.0': 'x' });
    assert.equal(next.fetched_at, '2026-07-26T03:00:00.000Z');
});
