import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  checkForUpdateSync,
  compareVersions,
  evaluateUpdateStatus,
  readCacheSync,
  recordDismissalSync,
  resolveCachePath,
  runBackgroundFetch
} from '../src/update-check.mjs';

// 契約 §3 の latest.json 例に準拠したフィクスチャ（product を現在版 0.1.0 より進める）。
const VALID_FEED = {
  schema: 1,
  product: '0.2.0',
  channel: 'prerelease',
  released: '2026-07-27T00:00:00+09:00',
  notes_url: 'https://github.com/AkariLabs/akari-video/releases/tag/v0.2.0',
  components: {
    shell: { version: '0.2.0', mac: { url: 'https://example.invalid/shell.zip', sha256: 'a'.repeat(64) } },
    cli: { version: '0.2.0', npm: 'akari-video', tarball: { url: 'https://example.invalid/cli.tgz', sha256: 'b'.repeat(64) } },
    plugin: { version: '0.2.0' }
  }
};

async function withScratchHome(callback) {
  const root = await mkdtemp(join(tmpdir(), 'akari-update-check-test-'));
  try {
    return await callback({ AKARI_HOME: root });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeCacheFixture(env, cache) {
  await mkdir(env.AKARI_HOME, { recursive: true });
  await writeFile(resolveCachePath(env), JSON.stringify(cache, null, 2), 'utf8');
}

/** テスト内ローカル HTTP サーバーでフィードを配信する（実 GitHub へは fetch しない）。 */
async function withFixtureServer(respond, callback) {
  const server = createServer((req, res) => respond(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const feedUrl = `http://127.0.0.1:${address.port}/latest.json`;
  try {
    return await callback(feedUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// --- compareVersions ---

test('compareVersions: major.minor.patch を数値比較する', () => {
  assert.equal(compareVersions('0.2.0', '0.1.0'), 1);
  assert.equal(compareVersions('0.1.0', '0.1.0'), 0);
  assert.equal(compareVersions('0.1.0', '0.2.0'), -1);
  assert.equal(compareVersions('1.0.0', '0.9.9'), 1);
  assert.equal(compareVersions('0.10.0', '0.9.0'), 1, '桁数の異なる文字列比較にならないこと');
});

// --- 6 ケース: 新版あり/なし/dismissed済み/キャッシュ無し/壊れたキャッシュ/壊れたフィード ---

test('ケース1: 新版あり — キャッシュに現在版より新しい product があれば available: true', async () => {
  await withScratchHome(async (env) => {
    await writeCacheFixture(env, { schema: 1, fetched_at: '2026-07-27T00:00:00.000Z', feed: VALID_FEED, dismissed: {} });
    const status = checkForUpdateSync({ currentVersion: '0.1.0', env });
    assert.equal(status.available, true);
    assert.equal(status.latestVersion, '0.2.0');
    assert.equal(status.channel, 'prerelease');
    assert.equal(status.notesUrl, VALID_FEED.notes_url);
  });
});

test('ケース2: 新版なし — フィードの product が現在版と同じか古ければ available: false', async () => {
  await withScratchHome(async (env) => {
    await writeCacheFixture(env, { schema: 1, feed: { ...VALID_FEED, product: '0.1.0' }, dismissed: {} });
    assert.equal(checkForUpdateSync({ currentVersion: '0.1.0', env }).available, false);

    await writeCacheFixture(env, { schema: 1, feed: { ...VALID_FEED, product: '0.0.9' }, dismissed: {} });
    assert.equal(checkForUpdateSync({ currentVersion: '0.1.0', env }).available, false);
  });
});

test('ケース3: dismissed 済み — 新版はあるが dismissed に記録済みの版は available: false', async () => {
  await withScratchHome(async (env) => {
    await writeCacheFixture(env, {
      schema: 1,
      feed: VALID_FEED,
      dismissed: { '0.2.0': '2026-07-27T01:00:00.000Z' }
    });
    const status = checkForUpdateSync({ currentVersion: '0.1.0', env });
    assert.equal(status.available, false);
    assert.equal(status.dismissed, true);
  });
});

test('ケース4: キャッシュ無し — ファイルが存在しなくても例外を投げず available: false', async () => {
  await withScratchHome(async (env) => {
    const status = checkForUpdateSync({ currentVersion: '0.1.0', env });
    assert.equal(status.available, false);
    assert.equal(readCacheSync(resolveCachePath(env)), null);
  });
});

test('ケース5: 壊れたキャッシュ — JSON パースに失敗しても例外を投げず available: false', async () => {
  await withScratchHome(async (env) => {
    await mkdir(env.AKARI_HOME, { recursive: true });
    await writeFile(resolveCachePath(env), '{ this is not json', 'utf8');
    const status = checkForUpdateSync({ currentVersion: '0.1.0', env });
    assert.equal(status.available, false);
  });
});

test('ケース6: 壊れたフィード — バックグラウンド fetch がスキーマ不明のフィードを取得しても、キャッシュを書き換えず沈黙する', async () => {
  await withScratchHome(async (env) => {
    await withFixtureServer(
      (req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ not_a_feed: true })); // product も schema も無い
      },
      async (feedUrl) => {
        await runBackgroundFetch({ env: { ...env, AKARI_UPDATE_FEED_URL: feedUrl } });
        assert.equal(readCacheSync(resolveCachePath(env)), null, 'スキーマ不明のフィードでキャッシュが作られていないこと');
      }
    );
  });
});

// --- 起動非ブロック性: 同期パスは fetch に一切触れない ---

test('起動非ブロック性: checkForUpdateSync は fetch を一切呼ばない（呼ばれたら fail するスタブで担保）', async () => {
  await withScratchHome(async (env) => {
    await writeCacheFixture(env, { schema: 1, feed: VALID_FEED, dismissed: {} });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => {
      throw new Error('同期パスから fetch が呼ばれた（起動をブロックしてはいけない）');
    };
    try {
      assert.doesNotThrow(() => checkForUpdateSync({ currentVersion: '0.1.0', env }));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// --- runBackgroundFetch: 正常系（ローカルサーバーから取得しキャッシュへ反映） ---

test('runBackgroundFetch: 正常なフィードを取得しキャッシュへ書き込む（dismissed は既存キャッシュから引き継ぐ）', async () => {
  await withScratchHome(async (env) => {
    await writeCacheFixture(env, { schema: 1, fetched_at: 'old', feed: null, dismissed: { '0.0.5': 'x' } });
    await withFixtureServer(
      (req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(VALID_FEED));
      },
      async (feedUrl) => {
        await runBackgroundFetch({ env: { ...env, AKARI_UPDATE_FEED_URL: feedUrl } });
        const cache = readCacheSync(resolveCachePath(env));
        assert.equal(cache.feed.product, '0.2.0');
        assert.deepEqual(cache.dismissed, { '0.0.5': 'x' });
        assert.ok(cache.fetched_at && cache.fetched_at !== 'old');
      }
    );
  });
});

test('runBackgroundFetch: オフライン（接続できないポート）でも例外を投げず、キャッシュは変更されない', async () => {
  await withScratchHome(async (env) => {
    // どのサーバーも listen していないポート宛て（接続失敗を安定して起こす）。
    const unreachableUrl = 'http://127.0.0.1:1/latest.json';
    await assert.doesNotReject(runBackgroundFetch({ env: { ...env, AKARI_UPDATE_FEED_URL: unreachableUrl } }));
    assert.equal(readCacheSync(resolveCachePath(env)), null);
  });
});

test('runBackgroundFetch: 404 などの非 200 応答は沈黙してキャッシュを書かない', async () => {
  await withScratchHome(async (env) => {
    await withFixtureServer(
      (req, res) => {
        res.writeHead(404);
        res.end('not found');
      },
      async (feedUrl) => {
        await runBackgroundFetch({ env: { ...env, AKARI_UPDATE_FEED_URL: feedUrl } });
        assert.equal(readCacheSync(resolveCachePath(env)), null);
      }
    );
  });
});

// --- recordDismissalSync ---

test('recordDismissalSync: dismissed に版を追加し、既存の feed/fetched_at は保持する', async () => {
  await withScratchHome(async (env) => {
    await writeCacheFixture(env, { schema: 1, fetched_at: 't0', feed: VALID_FEED, dismissed: { '0.0.5': 'x' } });
    const next = recordDismissalSync({ version: '0.2.0', env, now: new Date('2026-07-27T02:00:00.000Z') });
    assert.equal(next.dismissed['0.2.0'], '2026-07-27T02:00:00.000Z');
    assert.equal(next.dismissed['0.0.5'], 'x');
    assert.equal(next.feed.product, '0.2.0');
    assert.equal(next.fetched_at, 't0');

    // checkForUpdateSync がその後 available:false を返すことも合わせて確認する。
    const status = checkForUpdateSync({ currentVersion: '0.1.0', env });
    assert.equal(status.available, false);
    assert.equal(status.dismissed, true);
  });
});

test('recordDismissalSync: キャッシュが無い状態から呼んでも新規作成できる', async () => {
  await withScratchHome(async (env) => {
    const next = recordDismissalSync({ version: '0.2.0', env, now: new Date('2026-07-27T03:00:00.000Z') });
    assert.deepEqual(next.dismissed, { '0.2.0': '2026-07-27T03:00:00.000Z' });
    const persisted = JSON.parse(await readFile(resolveCachePath(env), 'utf8'));
    assert.deepEqual(persisted.dismissed, { '0.2.0': '2026-07-27T03:00:00.000Z' });
  });
});

// --- evaluateUpdateStatus（純関数の単体テスト） ---

test('evaluateUpdateStatus: cache が null なら available: false', () => {
  assert.equal(evaluateUpdateStatus({ currentVersion: '0.1.0', cache: null }).available, false);
});

test('evaluateUpdateStatus: feed.product が欠けている壊れたフィードなら available: false', () => {
  const status = evaluateUpdateStatus({ currentVersion: '0.1.0', cache: { schema: 1, feed: { schema: 1 }, dismissed: {} } });
  assert.equal(status.available, false);
});
