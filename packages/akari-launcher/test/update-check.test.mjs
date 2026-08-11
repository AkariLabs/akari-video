import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  checkForUpdateSync,
  compareVersions,
  evaluateUpdateStatus,
  maybeApplyPendingUpdateOnLaunch,
  maybeStageInBackground,
  readCacheSync,
  readOwnVersion,
  recordDismissalSync,
  resolveCachePath,
  runBackgroundFetch
} from '../src/update-check.mjs';
import { resolveAppDir, resolveAppPreviousDir, resolveStagingDir } from '../src/self-update.mjs';

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

// --- U5（タスク契約 2026-08-11-update-u5-cli-auto-update）: バックグラウンド staging +
// 次回起動時の自動適用の検証。self-update.test.mjs / update-apply-integration.test.mjs と
// 同じ流儀（実 tar・実ローカル HTTP サーバー・実ファイル）で決定論的に検証する。

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/** 単一の先頭ディレクトリを持つ tar.gz を作る（self-update.test.mjs と同じ fixture 流儀）。 */
async function buildAppTarball({ version, extraFiles = {} }) {
  const workDir = await mkdtemp(join(tmpdir(), 'akari-check-app-fixture-src-'));
  const prefix = 'app-fixture';
  const root = join(workDir, prefix);
  await mkdir(join(root, 'packages', 'akari-launcher'), { recursive: true });
  await writeFile(join(root, 'packages', 'akari-launcher', 'package.json'), JSON.stringify({ name: 'akari-video', version }), 'utf8');
  for (const [relPath, content] of Object.entries(extraFiles)) {
    const full = join(root, relPath);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf8');
  }
  const outDir = await mkdtemp(join(tmpdir(), 'akari-check-app-fixture-out-'));
  const tarPath = join(outDir, 'app.tgz');
  const result = spawnSync('tar', ['-czf', tarPath, '-C', workDir, prefix], { stdio: 'pipe' });
  assert.equal(result.status, 0, result.stderr?.toString());
  const buffer = await readFile(tarPath);
  await rm(workDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
  return buffer;
}

/** AKARI_HOME/app に「旧版」を模した実ディレクトリを作る（node_modules 込み）。 */
async function seedOldApp(env, { version = '0.1.0' } = {}) {
  const appDir = resolveAppDir(env);
  await mkdir(join(appDir, 'packages', 'akari-launcher'), { recursive: true });
  await writeFile(join(appDir, 'packages', 'akari-launcher', 'package.json'), JSON.stringify({ name: 'akari-video', version }), 'utf8');
  await mkdir(join(appDir, 'node_modules'), { recursive: true });
  await writeFile(join(appDir, 'node_modules', '.marker'), 'old-node-modules', 'utf8');
  return appDir;
}

async function packageVersionAt(dir) {
  const raw = await readFile(join(dir, 'packages', 'akari-launcher', 'package.json'), 'utf8');
  return JSON.parse(raw).version;
}

/** feed（JSON）と tarball の両方を配る HTTP サーバー。`/latest.json` と `/app.tgz`。 */
async function withCombinedFixtureServer(tarball, callback) {
  const server = createServer((req, res) => {
    if (req.url === '/app.tgz') {
      res.writeHead(200, { 'content-type': 'application/gzip' });
      res.end(tarball);
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  await new Promise((resolveReady) => server.listen(0, '127.0.0.1', resolveReady));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    return await callback(baseUrl);
  } finally {
    await new Promise((resolveClosed) => server.close(resolveClosed));
  }
}

function buildFeedWithApp({ version, appUrl, sha256: expectedSha, notesUrl }) {
  return {
    schema: 1,
    product: version,
    channel: 'prerelease',
    notes_url: notesUrl ?? `https://github.com/AkariLabs/akari-video/releases/tag/v${version}`,
    components: { app: { url: appUrl, sha256: expectedSha } }
  };
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

// --- maybeStageInBackground（契約 §11: staging DL の適格性判定 + 実行） ---

test('maybeStageInBackground: 新版 + app 経由 + components.app ありなら staging を作る', async () => {
  await withScratchHome(async (env) => {
    const appDir = await seedOldApp(env, { version: '0.1.0' });
    const tarball = await buildAppTarball({ version: '9.9.9' });
    const expectedSha = sha256(tarball);
    await withCombinedFixtureServer(tarball, async (baseUrl) => {
      const feed = buildFeedWithApp({ version: '9.9.9', appUrl: `${baseUrl}/app.tgz`, sha256: expectedSha });
      const result = await maybeStageInBackground({ env, feed, launcherRoot: appDir });
      assert.equal(result.ok, true);
      assert.equal(result.version, '9.9.9');
      assert.equal(await packageVersionAt(resolveStagingDir(env, '9.9.9')), '9.9.9');
    });
  });
});

test('maybeStageInBackground: AKARI_NO_AUTO_UPDATE=1 なら staging せず null（ネットワークにも触れない）', async () => {
  await withScratchHome(async (env) => {
    const appDir = await seedOldApp(env, { version: '0.1.0' });
    const feed = buildFeedWithApp({ version: '9.9.9', appUrl: 'http://127.0.0.1:1/should-not-be-fetched.tgz', sha256: 'f'.repeat(64) });
    const result = await maybeStageInBackground({ env: { ...env, AKARI_NO_AUTO_UPDATE: '1' }, feed, launcherRoot: appDir });
    assert.equal(result, null);
    assert.equal(existsSync(resolveStagingDir(env, '9.9.9')), false);
  });
});

test('maybeStageInBackground: app 外実行（launcherRoot 不一致）なら staging せず null', async () => {
  await withScratchHome(async (env) => {
    await seedOldApp(env, { version: '0.1.0' });
    const feed = buildFeedWithApp({ version: '9.9.9', appUrl: 'http://127.0.0.1:1/should-not-be-fetched.tgz', sha256: 'f'.repeat(64) });
    const result = await maybeStageInBackground({ env, feed, launcherRoot: '/some/other/checkout' });
    assert.equal(result, null);
    assert.equal(existsSync(resolveStagingDir(env, '9.9.9')), false);
  });
});

test('maybeStageInBackground: components.app が無い（旧フィード）なら staging せず null', async () => {
  await withScratchHome(async (env) => {
    const appDir = await seedOldApp(env, { version: '0.1.0' });
    const feed = { schema: 1, product: '9.9.9', components: { cli: { version: '9.9.9' } } };
    const result = await maybeStageInBackground({ env, feed, launcherRoot: appDir });
    assert.equal(result, null);
  });
});

test('maybeStageInBackground: 新版が無ければ staging せず null（インストール済み版が readOwnVersion 由来）', async () => {
  await withScratchHome(async (env) => {
    const appDir = await seedOldApp(env, { version: '0.1.0' });
    const own = readOwnVersion();
    const feed = buildFeedWithApp({ version: own, appUrl: 'http://127.0.0.1:1/should-not-be-fetched.tgz', sha256: 'f'.repeat(64) });
    const result = await maybeStageInBackground({ env, feed, launcherRoot: appDir });
    assert.equal(result, null);
  });
});

// --- runBackgroundFetch × staging 統合（フィード取得成功後に staging を試みる） ---

test('runBackgroundFetch: 適格条件が揃えば feed キャッシュに加えて staged も記録し、staging ディレクトリが実在する', async () => {
  await withScratchHome(async (env) => {
    const appDir = await seedOldApp(env, { version: '0.1.0' });
    const tarball = await buildAppTarball({ version: '9.9.9' });
    const expectedSha = sha256(tarball);
    await withCombinedFixtureServer(tarball, async (baseUrl) => {
      const feed = buildFeedWithApp({ version: '9.9.9', appUrl: `${baseUrl}/app.tgz`, sha256: expectedSha });
      const server = createServer((req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(feed));
      });
      await new Promise((resolveReady) => server.listen(0, '127.0.0.1', resolveReady));
      const address = server.address();
      try {
        await runBackgroundFetch({ env: { ...env, AKARI_UPDATE_FEED_URL: `http://127.0.0.1:${address.port}/latest.json` }, launcherRoot: appDir });
      } finally {
        await new Promise((resolveClosed) => server.close(resolveClosed));
      }

      const cache = readCacheSync(resolveCachePath(env));
      assert.equal(cache.feed.product, '9.9.9');
      assert.ok(cache.staged, 'staged が記録されていること');
      assert.equal(cache.staged.version, '9.9.9');
      assert.equal(cache.staged.sha256, expectedSha);
      assert.ok(typeof cache.staged.staged_at === 'string');
      assert.equal(await packageVersionAt(resolveStagingDir(env, '9.9.9')), '9.9.9');
    });
  });
});

test('runBackgroundFetch: AKARI_NO_AUTO_UPDATE=1 では feed は書くが staged は書かない（U2 通知のみに縮退）', async () => {
  await withScratchHome(async (env) => {
    const appDir = await seedOldApp(env, { version: '0.1.0' });
    const feed = buildFeedWithApp({ version: '9.9.9', appUrl: 'http://127.0.0.1:1/should-not-be-fetched.tgz', sha256: 'f'.repeat(64) });
    await withFixtureServer(
      (req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(feed));
      },
      async (feedUrl) => {
        await runBackgroundFetch({ env: { ...env, AKARI_UPDATE_FEED_URL: feedUrl, AKARI_NO_AUTO_UPDATE: '1' }, launcherRoot: appDir });
      }
    );
    const cache = readCacheSync(resolveCachePath(env));
    assert.equal(cache.feed.product, '9.9.9', '通知用のフィード取得自体は続くこと（U2 は生かす）');
    assert.equal(cache.staged, undefined, 'staged は書かれないこと');
    assert.equal(existsSync(resolveStagingDir(env, '9.9.9')), false);
  });
});

test('runBackgroundFetch: staging tarball が改竄されていれば feed は書くが staged は書かず、例外も投げない（沈黙）', async () => {
  await withScratchHome(async (env) => {
    const appDir = await seedOldApp(env, { version: '0.1.0' });
    const tarball = await buildAppTarball({ version: '9.9.9' });
    const correctSha = sha256(tarball);
    const tampered = Buffer.from(tarball);
    tampered[0] = tampered[0] ^ 0xff;

    const server = createServer((req, res) => {
      if (req.url === '/latest.json') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(buildFeedWithApp({ version: '9.9.9', appUrl: `http://127.0.0.1:${server.address().port}/app.tgz`, sha256: correctSha })));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/gzip' });
      res.end(tampered);
    });
    await new Promise((resolveReady) => server.listen(0, '127.0.0.1', resolveReady));
    const address = server.address();
    try {
      await assert.doesNotReject(runBackgroundFetch({ env: { ...env, AKARI_UPDATE_FEED_URL: `http://127.0.0.1:${address.port}/latest.json` }, launcherRoot: appDir }));
    } finally {
      await new Promise((resolveClosed) => server.close(resolveClosed));
    }

    const cache = readCacheSync(resolveCachePath(env));
    assert.equal(cache.feed.product, '9.9.9');
    assert.equal(cache.staged, undefined);
    assert.equal(existsSync(resolveStagingDir(env, '9.9.9')), false);
  });
});

// --- maybeApplyPendingUpdateOnLaunch（契約 §11: 起動の頭での自動適用） ---

async function stageForLaunch(env, appDir, { version = '9.9.9' } = {}) {
  const tarball = await buildAppTarball({ version });
  const expectedSha = sha256(tarball);
  return withCombinedFixtureServer(tarball, async (baseUrl) => {
    const feed = buildFeedWithApp({ version, appUrl: `${baseUrl}/app.tgz`, sha256: expectedSha });
    const staged = await maybeStageInBackground({ env, feed, launcherRoot: appDir });
    assert.equal(staged.ok, true);
    await writeFile(resolveCachePath(env), JSON.stringify({ schema: 1, fetched_at: 't0', feed, dismissed: {}, staged: { version, sha256: staged.sha256, staged_at: 't0' } }), 'utf8');
    return feed;
  });
}

test('maybeApplyPendingUpdateOnLaunch: staged が feed 最新と一致していればスワップし、成功を通知する', async () => {
  await withScratchHome(async (env) => {
    const appDir = await seedOldApp(env, { version: '0.1.0' });
    const feed = await stageForLaunch(env, appDir);

    const lines = [];
    const result = maybeApplyPendingUpdateOnLaunch({ env, log: (line) => lines.push(line), launcherRoot: appDir });

    assert.equal(result.applied, true);
    assert.equal(result.version, '9.9.9');
    assert.ok(lines.some((line) => line.includes('v9.9.9 に更新しました')), JSON.stringify(lines));
    assert.ok(lines.some((line) => line.includes(feed.notes_url)));
    assert.equal(await packageVersionAt(appDir), '9.9.9');
    assert.equal(await packageVersionAt(resolveAppPreviousDir(env)), '0.1.0');

    const cache = readCacheSync(resolveCachePath(env));
    assert.equal(cache.staged, undefined, '適用後は staged がキャッシュから消えていること');
    assert.equal(cache.feed.product, '9.9.9', 'feed 自体は残ること（バージョン表示等に使う）');
  });
});

test('maybeApplyPendingUpdateOnLaunch: staged が無ければ何もしない', async () => {
  await withScratchHome(async (env) => {
    const appDir = await seedOldApp(env, { version: '0.1.0' });
    await writeFile(resolveCachePath(env), JSON.stringify({ schema: 1, feed: buildFeedWithApp({ version: '9.9.9', appUrl: 'x', sha256: 'f'.repeat(64) }), dismissed: {} }), 'utf8');
    const result = maybeApplyPendingUpdateOnLaunch({ env, launcherRoot: appDir });
    assert.equal(result.applied, false);
    assert.equal(await packageVersionAt(appDir), '0.1.0');
  });
});

test('maybeApplyPendingUpdateOnLaunch: staged の版が最新フィードと不一致（stale）なら何もしない', async () => {
  await withScratchHome(async (env) => {
    const appDir = await seedOldApp(env, { version: '0.1.0' });
    const feed = buildFeedWithApp({ version: '9.9.9', appUrl: 'x', sha256: 'f'.repeat(64) });
    // staged はもっと古い版（例えば前回チェック時点の版）を指しており、feed は既に先へ進んでいる。
    await writeFile(resolveCachePath(env), JSON.stringify({ schema: 1, feed, dismissed: {}, staged: { version: '5.0.0', sha256: 'a'.repeat(64), staged_at: 't0' } }), 'utf8');
    const result = maybeApplyPendingUpdateOnLaunch({ env, launcherRoot: appDir });
    assert.equal(result.applied, false);
    assert.equal(result.reason, 'no-matching-staged-update');
    assert.equal(await packageVersionAt(appDir), '0.1.0');
  });
});

test('maybeApplyPendingUpdateOnLaunch: AKARI_NO_AUTO_UPDATE=1 では staged があっても適用しない', async () => {
  await withScratchHome(async (env) => {
    const appDir = await seedOldApp(env, { version: '0.1.0' });
    await stageForLaunch(env, appDir);
    const result = maybeApplyPendingUpdateOnLaunch({ env: { ...env, AKARI_NO_AUTO_UPDATE: '1' }, launcherRoot: appDir });
    assert.equal(result.applied, false);
    assert.equal(result.reason, 'opt-out');
    assert.equal(await packageVersionAt(appDir), '0.1.0');
  });
});

test('maybeApplyPendingUpdateOnLaunch: app 外実行（launcherRoot 不一致）では適用しない', async () => {
  await withScratchHome(async (env) => {
    const appDir = await seedOldApp(env, { version: '0.1.0' });
    await stageForLaunch(env, appDir);
    const result = maybeApplyPendingUpdateOnLaunch({ env, launcherRoot: '/some/other/checkout' });
    assert.equal(result.applied, false);
    assert.equal(result.reason, 'not-app-dir');
    assert.equal(await packageVersionAt(appDir), '0.1.0');
  });
});

test('maybeApplyPendingUpdateOnLaunch: staging ディレクトリが既に消費済み（存在しない）なら適用しない（ループガード）', async () => {
  await withScratchHome(async (env) => {
    const appDir = await seedOldApp(env, { version: '0.1.0' });
    const feed = buildFeedWithApp({ version: '9.9.9', appUrl: 'x', sha256: 'f'.repeat(64) });
    // staged はキャッシュにあるが、対応する staging ディレクトリは無い（既に消費済み、を模す）。
    await writeFile(resolveCachePath(env), JSON.stringify({ schema: 1, feed, dismissed: {}, staged: { version: '9.9.9', sha256: 'f'.repeat(64), staged_at: 't0' } }), 'utf8');
    const result = maybeApplyPendingUpdateOnLaunch({ env, launcherRoot: appDir });
    assert.equal(result.applied, false);
    assert.equal(result.reason, 'staging-missing');
  });
});

test('maybeApplyPendingUpdateOnLaunch: 1 起動につき適用 1 回 — 同一プロセス内で 2 回呼んでも 2 回目は自然に no-op', async () => {
  await withScratchHome(async (env) => {
    const appDir = await seedOldApp(env, { version: '0.1.0' });
    await stageForLaunch(env, appDir);

    const first = maybeApplyPendingUpdateOnLaunch({ env, launcherRoot: appDir });
    assert.equal(first.applied, true);

    const second = maybeApplyPendingUpdateOnLaunch({ env, launcherRoot: appDir });
    assert.equal(second.applied, false, 'ループガード: 2 回目は staging 消費済みのため no-op になること');
    assert.equal(await packageVersionAt(appDir), '9.9.9', '2 回目の呼び出しで app が壊れていないこと');
  });
});

test('maybeApplyPendingUpdateOnLaunch: ロック競合時は静かに見送り、app は変更されない', async () => {
  await withScratchHome(async (env) => {
    const appDir = await seedOldApp(env, { version: '0.1.0' });
    await stageForLaunch(env, appDir);
    mkdirSync(join(env.AKARI_HOME, 'update-apply.lock'), { recursive: true });

    const lines = [];
    const result = maybeApplyPendingUpdateOnLaunch({ env, log: (line) => lines.push(line), launcherRoot: appDir });
    assert.equal(result.applied, false);
    assert.equal(result.reason, 'lock-contention');
    assert.deepEqual(lines, [], 'ロック競合はユーザーに見せず沈黙すること（swapStagedApp 内部ログを渡していない）');
    assert.equal(await packageVersionAt(appDir), '0.1.0');
  });
});

test('maybeApplyPendingUpdateOnLaunch: 既定では npm install を一切実行しない（起動時にネットワークを待たない）', async () => {
  await withScratchHome(async (env) => {
    const appDir = await seedOldApp(env, { version: '0.1.0' });
    await stageForLaunch(env, appDir);
    const startedAt = Date.now();
    const result = maybeApplyPendingUpdateOnLaunch({ env, launcherRoot: appDir });
    const elapsedMs = Date.now() - startedAt;
    assert.equal(result.applied, true);
    assert.ok(elapsedMs < 2000, `npm install が実行されていれば有意に遅くなるはず（実測 ${elapsedMs}ms）`);
  });
});
