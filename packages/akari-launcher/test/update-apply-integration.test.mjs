import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

import { runUpdateCommand } from '../src/cli.mjs';
import { resolveAppDir, resolveAppPreviousDir } from '../src/self-update.mjs';

/**
 * `runUpdateCommand` 経由の受け入れ条件の実演（task.md 「受け入れ条件」を直接なぞる）:
 *   - ローカル fixture（旧版相当の app ディレクトリ + AKARI_UPDATE_FEED_URL 相当の自作フィード
 *     + tarball）で `akari update` → app が新版に置き換わり `akari --version` が新版を返す
 *   - `akari update --rollback` で旧版復帰（`akari --version` が旧版に戻る）
 *   - app 外（モノレポ checkout 相当）から実行すると適用せず案内表示
 *
 * 「実際の bin/akari.mjs を子プロセスで起動して --version を確認する」ところまでやる
 * ことで、self-update.test.mjs（applySelfUpdate 単体）より一段実機に近い検証にしてある。
 */

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function buildAppTarball({ version }) {
  const workDir = await mkdtemp(join(tmpdir(), 'akari-apply-fixture-src-'));
  const prefix = 'app-fixture';
  const root = join(workDir, prefix);
  // 本物の bin/akari.mjs 一式をコピーし、package.json の version だけ差し替える —
  // `node <展開先>/packages/akari-launcher/bin/akari.mjs --version` を実際に spawn して
  // 版を読み取れるようにするため（fixture が最小限のダミーだと --version 実演ができない）。
  await mkdir(join(root, 'packages', 'akari-launcher'), { recursive: true });
  await cp(join(packageRoot, 'bin'), join(root, 'packages', 'akari-launcher', 'bin'), { recursive: true });
  await cp(join(packageRoot, 'src'), join(root, 'packages', 'akari-launcher', 'src'), { recursive: true });
  const pkgRaw = await readFile(join(packageRoot, 'package.json'), 'utf8');
  const pkg = JSON.parse(pkgRaw);
  pkg.version = version;
  await writeFile(join(root, 'packages', 'akari-launcher', 'package.json'), JSON.stringify(pkg), 'utf8');

  const outDir = await mkdtemp(join(tmpdir(), 'akari-apply-fixture-out-'));
  const tarPath = join(outDir, 'app.tgz');
  const result = spawnSync('tar', ['-czf', tarPath, '-C', workDir, prefix], { stdio: 'pipe' });
  assert.equal(result.status, 0, result.stderr?.toString());
  const buffer = await readFile(tarPath);
  await rm(workDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
  return buffer;
}

async function seedOldApp(env, version) {
  const appDir = resolveAppDir(env);
  await mkdir(join(appDir, 'packages', 'akari-launcher'), { recursive: true });
  await cp(join(packageRoot, 'bin'), join(appDir, 'packages', 'akari-launcher', 'bin'), { recursive: true });
  await cp(join(packageRoot, 'src'), join(appDir, 'packages', 'akari-launcher', 'src'), { recursive: true });
  const pkgRaw = await readFile(join(packageRoot, 'package.json'), 'utf8');
  const pkg = JSON.parse(pkgRaw);
  pkg.version = version;
  await writeFile(join(appDir, 'packages', 'akari-launcher', 'package.json'), JSON.stringify(pkg), 'utf8');
  await mkdir(join(appDir, 'node_modules'), { recursive: true });
  await writeFile(join(appDir, 'node_modules', '.marker'), 'preserved', 'utf8');
  return appDir;
}

function akariVersionOf(appDir) {
  const bin = join(appDir, 'packages', 'akari-launcher', 'bin', 'akari.mjs');
  const result = execFileSync(process.execPath, [bin, '--version'], { encoding: 'utf8' });
  return result.trim();
}

async function withFixtureServer(tarball, callback) {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/gzip' });
    res.end(tarball);
  });
  await new Promise((resolveReady) => server.listen(0, '127.0.0.1', resolveReady));
  const address = server.address();
  try {
    return await callback(`http://127.0.0.1:${address.port}/app.tgz`);
  } finally {
    await new Promise((resolveClosed) => server.close(resolveClosed));
  }
}

async function withScratchHome(callback) {
  const home = await mkdtemp(join(tmpdir(), 'akari-apply-integration-home-'));
  try {
    return await callback({ AKARI_HOME: home });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

function collectLogs() {
  const lines = [];
  return { log: (line) => lines.push(line), lines };
}

serverTest('akari update: app 経由インストール + 新版フィードなら実適用し、akari --version が新版を返す。--rollback で旧版に戻る', async () => {
  await withScratchHome(async (env) => {
    const appDir = await seedOldApp(env, '0.1.0');
    assert.equal(akariVersionOf(appDir), 'v0.1.0');

    const tarball = await buildAppTarball({ version: '0.2.0' });
    const expectedSha = sha256(tarball);

    await withFixtureServer(tarball, async (tarballUrl) => {
      const feed = {
        schema: 1,
        product: '0.2.0',
        channel: 'prerelease',
        notes_url: 'https://github.com/AkariLabs/akari-video/releases/tag/v0.2.0',
        components: { app: { url: tarballUrl, sha256: expectedSha } }
      };
      const cache = { schema: 1, fetched_at: 't0', feed, dismissed: {} };
      await mkdir(env.AKARI_HOME, { recursive: true });
      await writeFile(join(env.AKARI_HOME, 'update-check.json'), JSON.stringify(cache), 'utf8');

      const { log, lines } = collectLogs();
      // launcherRoot をこの fixture の appDir に見せかける（isRunningFromAppDir が
      // true を返す経路）。runUpdateCommand の既定 applySelfUpdate をそのまま使う
      // （= 本物の DL・sha256 検証・展開・スワップを実演する）。npm install だけは
      // 実ネットワーク（レジストリ照会）に触れ数秒〜十数秒かかるため、決定論のために
      // スタブへ差し替える（fixture tarball には package.json の依存が無く npm install
      // 自体は無害だが、決定論・速度のためにスタブ化する）。
      const result = await runUpdateCommand([], {
        log,
        env,
        currentVersion: '0.1.0',
        launcherRoot: appDir,
        runNpmInstall: () => ({ ok: true })
      });

      assert.equal(result.exitCode, 0);
      assert.ok(lines.some((line) => line.includes('v0.2.0 に更新しました')), JSON.stringify(lines));
      assert.equal(akariVersionOf(appDir), 'v0.2.0', 'akari --version が新版を返すこと');

      const { log: rbLog, lines: rbLines } = collectLogs();
      const rollbackResult = await runUpdateCommand(['--rollback'], { log: rbLog, env, currentVersion: '0.2.0' });
      assert.equal(rollbackResult.exitCode, 0);
      assert.ok(rbLines.some((line) => line.includes('v0.1.0 へロールバックしました')), JSON.stringify(rbLines));
      assert.equal(akariVersionOf(appDir), 'v0.1.0', '--rollback 後は akari --version が旧版に戻ること');
    });
  });
});

serverTest('akari update: app 外（モノレポ checkout 相当）から実行すると適用せず従来の案内表示に縮退する', async () => {
  await withScratchHome(async (env) => {
    await seedOldApp(env, '0.1.0');
    const feed = {
      schema: 1,
      product: '0.2.0',
      notes_url: 'https://example.invalid/notes',
      components: { app: { url: 'http://127.0.0.1:1/should-not-be-fetched.tgz', sha256: 'f'.repeat(64) } }
    };
    const cache = { schema: 1, feed, dismissed: {} };
    await writeFile(join(env.AKARI_HOME, 'update-check.json'), JSON.stringify(cache), 'utf8');

    const { log, lines } = collectLogs();
    const result = await runUpdateCommand([], {
      log,
      env,
      currentVersion: '0.1.0',
      // launcherRoot を注入しない → 既定値（このテストファイル自身のモノレポ checkout 位置）
      // が使われ、AKARI_HOME/app とは一致しない。
      applySelfUpdate: () => {
        throw new Error('app 外実行なのに self-update が呼ばれてしまった');
      }
    });

    assert.equal(result.exitCode, 0);
    assert.ok(lines.some((line) => line.includes('最新バージョン: v0.2.0')), JSON.stringify(lines));
    assert.ok(lines.some((line) => line.includes('npm i -g')), '従来どおりの手動インストール案内が出ること');
    assert.equal(existsSync(resolveAppPreviousDir(env)), false, '適用されていないこと');
  });
});

serverTest('akari update: フィードに components.app が無い（旧フィード）場合も案内表示に縮退する', async () => {
  await withScratchHome(async (env) => {
    const appDir = await seedOldApp(env, '0.1.0');
    const feed = {
      schema: 1,
      product: '0.2.0',
      notes_url: 'https://example.invalid/notes',
      components: { cli: { version: '0.2.0', tarball: { url: 'https://example.invalid/cli.tgz' } } }
    };
    const cache = { schema: 1, feed, dismissed: {} };
    await writeFile(join(env.AKARI_HOME, 'update-check.json'), JSON.stringify(cache), 'utf8');

    const { log, lines } = collectLogs();
    const result = await runUpdateCommand([], {
      log,
      env,
      currentVersion: '0.1.0',
      launcherRoot: appDir, // app 経由実行ではあるが、フィード側に components.app が無い
      applySelfUpdate: () => {
        throw new Error('components.app が無いのに self-update が呼ばれてしまった');
      }
    });

    assert.equal(result.exitCode, 0);
    assert.ok(lines.some((line) => line.includes('最新バージョン: v0.2.0')), JSON.stringify(lines));
    assert.equal(akariVersionOf(appDir), 'v0.1.0', '適用されていないこと');
  });
});
