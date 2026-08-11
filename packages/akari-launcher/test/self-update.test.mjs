import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { applySelfUpdate, isRunningFromAppDir, resolveAppDir, resolveAppPreviousDir, resolveStagingRoot, rollbackSelfUpdate } from '../src/self-update.mjs';

/**
 * self-update.mjs の検証（タスク契約 2026-08-11-update-u4-cli-self-update 受け入れ条件）:
 *   - sha256 不一致で適用拒否 + app 不変
 *   - DL 途中失敗で app 不変
 *   - rollback
 *   - インストール元判定（app 外実行で縮退）
 * すべて実ファイル + ローカル HTTP サーバー（update-integration.test.mjs と同じ流儀）で
 * 決定論的に検証する。実 GitHub には一切触れない。
 */

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/** 単一の先頭ディレクトリを持つ tar.gz を作る（release.yml の `git archive` 出力と同形）。 */
async function buildAppTarball({ version, extraFiles = {} }) {
  const workDir = await mkdtemp(join(tmpdir(), 'akari-app-fixture-src-'));
  const prefix = 'app-fixture';
  const root = join(workDir, prefix);
  await mkdir(join(root, 'packages', 'akari-launcher'), { recursive: true });
  await writeFile(
    join(root, 'packages', 'akari-launcher', 'package.json'),
    JSON.stringify({ name: 'akari-video', version }),
    'utf8'
  );
  for (const [relPath, content] of Object.entries(extraFiles)) {
    const full = join(root, relPath);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf8');
  }
  const outDir = await mkdtemp(join(tmpdir(), 'akari-app-fixture-out-'));
  const tarPath = join(outDir, 'app.tgz');
  const result = spawnSync('tar', ['-czf', tarPath, '-C', workDir, prefix], { stdio: 'pipe' });
  assert.equal(result.status, 0, result.stderr?.toString());
  const buffer = await readFile(tarPath);
  await rm(workDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
  return buffer;
}

async function withFixtureServer(handler, callback) {
  const server = createServer(handler);
  await new Promise((resolveReady) => server.listen(0, '127.0.0.1', resolveReady));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    return await callback(baseUrl);
  } finally {
    await new Promise((resolveClosed) => server.close(resolveClosed));
  }
}

async function withScratchHome(callback) {
  const home = await mkdtemp(join(tmpdir(), 'akari-self-update-home-'));
  try {
    return await callback({ AKARI_HOME: home });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

/** AKARI_HOME/app に「旧版」を模した実ディレクトリを作る（node_modules 込み）。 */
async function seedOldApp(env, { version = '0.1.0', ref = 'v0.1.0' } = {}) {
  const appDir = resolveAppDir(env);
  await mkdir(join(appDir, 'packages', 'akari-launcher'), { recursive: true });
  await writeFile(
    join(appDir, 'packages', 'akari-launcher', 'package.json'),
    JSON.stringify({ name: 'akari-video', version }),
    'utf8'
  );
  await mkdir(join(appDir, 'node_modules'), { recursive: true });
  await writeFile(join(appDir, 'node_modules', '.marker'), 'old-node-modules', 'utf8');
  await writeFile(join(appDir, 'old-only-file.txt'), 'existed before the update', 'utf8');
  await writeFile(join(appDir, '.akari-install-ref'), `${ref}\n`, 'utf8');
  return appDir;
}

function collectLogs() {
  const lines = [];
  return { log: (line) => lines.push(line), lines };
}

async function packageVersionAt(appDir) {
  const raw = await readFile(join(appDir, 'packages', 'akari-launcher', 'package.json'), 'utf8');
  return JSON.parse(raw).version;
}

test('isRunningFromAppDir: launcherRoot が AKARI_HOME/app と一致すれば true、それ以外は false', async () => {
  await withScratchHome(async (env) => {
    assert.equal(isRunningFromAppDir({ env, launcherRoot: resolveAppDir(env) }), true);
    assert.equal(isRunningFromAppDir({ env, launcherRoot: '/some/other/checkout' }), false);
  });
});

test('applySelfUpdate: 正常系 — DL・sha256 検証・展開・スワップ・node_modules 引き継ぎ・.akari-install-ref 更新まで一気通貫', async () => {
  await withScratchHome(async (env) => {
    await seedOldApp(env, { version: '0.1.0', ref: 'v0.1.0' });
    const tarball = await buildAppTarball({ version: '0.2.0', extraFiles: { 'new-only-file.txt': 'brand new content' } });
    const expectedSha = sha256(tarball);

    await withFixtureServer(
      (req, res) => {
        res.writeHead(200, { 'content-type': 'application/gzip' });
        res.end(tarball);
      },
      async (baseUrl) => {
        const feed = {
          schema: 1,
          product: '0.2.0',
          channel: 'prerelease',
          notes_url: 'https://github.com/AkariLabs/akari-video/releases/tag/v0.2.0',
          components: { app: { url: `${baseUrl}/app.tgz`, sha256: expectedSha } }
        };
        const { log, lines } = collectLogs();
        const result = await applySelfUpdate({ env, feed, log, runNpmInstall: () => ({ ok: true }) });

        assert.equal(result.exitCode, 0);
        assert.equal(result.applied, true);
        assert.equal(result.version, '0.2.0');
        assert.ok(lines.some((line) => line.includes('v0.2.0 に更新しました')), JSON.stringify(lines));
        assert.ok(lines.some((line) => line.includes(feed.notes_url)));

        const appDir = resolveAppDir(env);
        assert.equal(await packageVersionAt(appDir), '0.2.0');
        assert.equal(await readFile(join(appDir, 'new-only-file.txt'), 'utf8'), 'brand new content');
        assert.equal(existsSync(join(appDir, 'old-only-file.txt')), false, '新版に無いファイルは残らないこと');
        assert.equal(await readFile(join(appDir, 'node_modules', '.marker'), 'utf8'), 'old-node-modules', 'node_modules は旧版から引き継がれること');
        assert.equal((await readFile(join(appDir, '.akari-install-ref'), 'utf8')).trim(), 'v0.2.0');

        const previousDir = resolveAppPreviousDir(env);
        assert.equal(await packageVersionAt(previousDir), '0.1.0', '旧版は app-previous に 1 世代保持されること');
        assert.equal(await readFile(join(previousDir, 'node_modules', '.marker'), 'utf8'), 'old-node-modules', 'app-previous も node_modules を保持し続けること（rollback 後も動く状態を保つ）');

        // staging に残骸を残さない
        const stagingRoot = resolveStagingRoot(env);
        assert.equal(existsSync(join(stagingRoot, '0.2.0')), false);
        assert.equal(existsSync(join(stagingRoot, '.download-0.2.0.tar.gz')), false);
      }
    );
  });
});

test('applySelfUpdate: sha256 不一致（1 バイト改竄）なら適用を拒否し、app は変更前と完全同一のまま', async () => {
  await withScratchHome(async (env) => {
    await seedOldApp(env, { version: '0.1.0' });
    const tarball = await buildAppTarball({ version: '0.2.0' });
    const correctSha = sha256(tarball);
    const tampered = Buffer.from(tarball);
    tampered[0] = tampered[0] ^ 0xff; // 1 バイト改竄（フィード記載の sha256 とは一致しなくなる）

    await withFixtureServer(
      (req, res) => {
        res.writeHead(200, { 'content-type': 'application/gzip' });
        res.end(tampered);
      },
      async (baseUrl) => {
        const feed = {
          schema: 1,
          product: '0.2.0',
          notes_url: 'https://example.invalid/notes',
          // フィードには「正しい」sha256（=リリース時に計上された値）を載せる。
          // 転送中に改竄されたバイト列と食い違うことを検出できるかを見る。
          components: { app: { url: `${baseUrl}/app.tgz`, sha256: correctSha } }
        };
        const { log, lines } = collectLogs();
        const result = await applySelfUpdate({ env, feed, log, runNpmInstall: () => ({ ok: true }) });

        assert.equal(result.exitCode, 1);
        assert.equal(result.applied, false);
        assert.ok(lines.some((line) => line.includes('sha256 不一致')), JSON.stringify(lines));

        const appDir = resolveAppDir(env);
        assert.equal(await packageVersionAt(appDir), '0.1.0', 'app は改竄検出時に一切変更されないこと');
        assert.equal(await readFile(join(appDir, 'node_modules', '.marker'), 'utf8'), 'old-node-modules');
        assert.equal(existsSync(resolveAppPreviousDir(env)), false, 'app-previous も作られないこと');
      }
    );
  });
});

test('applySelfUpdate: ダウンロード途中失敗（接続不可）でも app は変更前と同一のまま', async () => {
  await withScratchHome(async (env) => {
    await seedOldApp(env, { version: '0.1.0' });
    const feed = {
      schema: 1,
      product: '0.2.0',
      notes_url: 'https://example.invalid/notes',
      // 127.0.0.1 の未使用ポート — ECONNREFUSED を実測で起こす。
      components: { app: { url: 'http://127.0.0.1:1/app.tgz', sha256: 'f'.repeat(64) } }
    };
    const { log, lines } = collectLogs();
    const result = await applySelfUpdate({ env, feed, log, timeoutMs: 2000, runNpmInstall: () => ({ ok: true }) });

    assert.equal(result.exitCode, 1);
    assert.equal(result.applied, false);
    assert.ok(lines.some((line) => line.includes('ダウンロードに失敗しました')), JSON.stringify(lines));

    const appDir = resolveAppDir(env);
    assert.equal(await packageVersionAt(appDir), '0.1.0');
    assert.equal(existsSync(resolveAppPreviousDir(env)), false);
  });
});

test('applySelfUpdate: フィードに components.app が無ければ適用せず失敗を返す（呼び出し側の縮退判定と二重化した安全網）', async () => {
  await withScratchHome(async (env) => {
    await seedOldApp(env, { version: '0.1.0' });
    const feed = { schema: 1, product: '0.2.0', components: { cli: { version: '0.2.0' } } };
    const { log, lines } = collectLogs();
    const result = await applySelfUpdate({ env, feed, log });
    assert.equal(result.exitCode, 1);
    assert.equal(result.applied, false);
    assert.ok(lines.some((line) => line.includes('app 成分がありません')));
  });
});

test('rollbackSelfUpdate: app-previous を app へ戻す（往復可能）', async () => {
  await withScratchHome(async (env) => {
    await seedOldApp(env, { version: '0.1.0', ref: 'v0.1.0' });
    const tarball = await buildAppTarball({ version: '0.2.0' });
    const expectedSha = sha256(tarball);

    await withFixtureServer(
      (req, res) => {
        res.writeHead(200, { 'content-type': 'application/gzip' });
        res.end(tarball);
      },
      async (baseUrl) => {
        const feed = {
          schema: 1,
          product: '0.2.0',
          components: { app: { url: `${baseUrl}/app.tgz`, sha256: expectedSha } }
        };
        const applyResult = await applySelfUpdate({ env, feed, log: () => {}, runNpmInstall: () => ({ ok: true }) });
        assert.equal(applyResult.exitCode, 0);
        assert.equal(await packageVersionAt(resolveAppDir(env)), '0.2.0');

        const { log, lines } = collectLogs();
        const rollbackResult = rollbackSelfUpdate({ env, log });
        assert.equal(rollbackResult.exitCode, 0);
        assert.equal(rollbackResult.rolledBack, true);
        assert.ok(lines.some((line) => line.includes('v0.1.0 へロールバックしました')), JSON.stringify(lines));

        const appDir = resolveAppDir(env);
        assert.equal(await packageVersionAt(appDir), '0.1.0', 'app が旧版へ戻ること');
        assert.equal(await readFile(join(appDir, 'node_modules', '.marker'), 'utf8'), 'old-node-modules');
        assert.equal(await packageVersionAt(resolveAppPreviousDir(env)), '0.2.0', '入れ替えなので直前の app（新版）が app-previous に残ること');
      }
    );
  });
});

test('rollbackSelfUpdate: app-previous が無ければロールバック対象なしとして失敗を返す', async () => {
  await withScratchHome(async (env) => {
    await seedOldApp(env, { version: '0.1.0' });
    const { log, lines } = collectLogs();
    const result = rollbackSelfUpdate({ env, log });
    assert.equal(result.exitCode, 1);
    assert.equal(result.rolledBack, false);
    assert.ok(lines.some((line) => line.includes('ロールバック対象がありません')));
  });
});
