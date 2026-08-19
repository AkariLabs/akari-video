import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const LOCAL_SERVER_AVAILABLE = await new Promise(resolveAvailable => {
  const probe = createServer();
  probe.once('error', () => resolveAvailable(false));
  probe.listen(0, '127.0.0.1', () => probe.close(() => resolveAvailable(true)));
});
const serverTest = LOCAL_SERVER_AVAILABLE
  ? test
  : (name, fn) => test(name, { skip: 'sandbox cannot bind a localhost fixture server' }, fn);

import { run, runUpdateCommand } from '../src/cli.mjs';
import { resolveRepoAssets } from '../src/repo-assets.mjs';
import { resolveCachePath } from '../src/update-check.mjs';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(packageRoot, '..', '..');

/**
 * 受け入れ条件の実演: フィクスチャフィード（新版あり）+ AKARI_HOME=一時 dir で
 * `akari` を 2 回実行すると 1 回目は通知なし・2 回目に通知が出る。さらに
 * `akari update --dismiss` の後の 3 回目では通知が出ない。
 *
 * ここだけは「テスト内ローカルサーバー」への実 fetch を許可し（実 GitHub へは
 * 触れない）、`triggerBackgroundRefresh` の実体である detached 子プロセスの
 * spawn までを実際に動かして確認する（起動非ブロック性のスタブ検証は
 * update-check.test.mjs 側の役割）。
 */

async function withFixtureServer(feed, callback) {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(feed));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const feedUrl = `http://127.0.0.1:${address.port}/latest.json`;
  try {
    return await callback(feedUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function waitForFile(path, { timeoutMs = 4000, intervalMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await access(path);
      return;
    } catch {
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for ${path}`);
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
}

function collectLogs() {
  const lines = [];
  return { log: (line) => lines.push(line), lines };
}

async function withScratchProject(callback) {
  const root = await mkdtemp(join(tmpdir(), 'akari-update-integration-'));
  try {
    // scaffold 済み状態にしておく（本テストの主眼は更新チェックであり、
    // project-scaffold の分岐は cli.test.mjs 側の役割）。
    await mkdir(join(root, '.akari'), { recursive: true });
    await writeFile(join(root, '.akari', 'connections.json'), JSON.stringify({ providers: [], policy: {} }), 'utf8');
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

serverTest('akari 実行 1 回目: キャッシュ未形成のため通知なし。2 回目: バックグラウンド fetch 完了後に 1 行通知が出る', async (t) => {
  await withScratchProject(async (projectRoot) => {
    const home = await mkdtemp(join(tmpdir(), 'akari-home-'));
    t.after(() => rm(home, { recursive: true, force: true }));

    const feed = {
      schema: 1,
      product: '0.2.0',
      channel: 'prerelease',
      notes_url: 'https://github.com/AkariLabs/akari-video/releases/tag/v0.2.0',
      components: { cli: { version: '0.2.0', npm: 'akari-video' } }
    };

    await withFixtureServer(feed, async (feedUrl) => {
      const env = { ...process.env, AKARI_HOME: home, AKARI_UPDATE_FEED_URL: feedUrl };
      const assets = resolveRepoAssets(repoRoot);
      const baseOptions = {
        projectRoot,
        assets,
        runDoctor: () => ({ status: 0 }),
        resolveClaude: () => '/fake/bin/claude',
        spawnClaude: () => ({ status: 0 }),
        env,
        currentVersion: '0.1.0'
        // refreshUpdate は指定しない — 実体の triggerBackgroundRefresh を使い、
        // detached 子プロセスが実際に spawn されることまで確認する。
      };

      // 1 回目: キャッシュがまだ無いので通知は出ない。
      const { log: log1, lines: lines1 } = collectLogs();
      await run([], { ...baseOptions, log: log1 });
      assert.ok(!lines1.some((line) => line.startsWith('⬆ AKARI Video')), '1 回目は通知が出ないこと（実出力: ' + JSON.stringify(lines1) + '）');

      // バックグラウンド fetch（detached 子プロセス）がキャッシュを書き終えるのを待つ。
      await waitForFile(resolveCachePath(env));

      // 2 回目: キャッシュに新版が乗っているので 1 行通知が出る。
      const { log: log2, lines: lines2 } = collectLogs();
      await run([], { ...baseOptions, log: log2 });
      const notice = lines2.find((line) => line.startsWith('⬆ AKARI Video'));
      assert.ok(notice, '2 回目は通知が出ること（実出力: ' + JSON.stringify(lines2) + '）');
      assert.equal(notice, '⬆ AKARI Video v0.2.0（プレリリース）があります（現在 v0.1.0）→ 詳細: akari update');

      // akari update --dismiss で今回の版を既読にする。
      const { log: logUpdate, lines: linesUpdate } = collectLogs();
      await runUpdateCommand(['--dismiss'], { log: logUpdate, env, currentVersion: '0.1.0' });
      assert.ok(linesUpdate.some((line) => line.includes('今後表示しません')), '実出力: ' + JSON.stringify(linesUpdate));

      // 3 回目: dismissed 済みのため通知は出ない。
      const { log: log3, lines: lines3 } = collectLogs();
      await run([], { ...baseOptions, log: log3, refreshUpdate: () => {} });
      assert.ok(!lines3.some((line) => line.startsWith('⬆ AKARI Video')), '3 回目（dismiss 後）は通知が出ないこと（実出力: ' + JSON.stringify(lines3) + '）');
    });
  });
});
