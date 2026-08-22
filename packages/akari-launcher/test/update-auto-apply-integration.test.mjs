import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
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

import { resolveAppDir, resolveAppPreviousDir, resolveStagingDir } from '../src/self-update.mjs';
import { maybeStageInBackground, resolveCachePath } from '../src/update-check.mjs';

/**
 * U5（タスク契約 2026-08-11-update-u5-cli-auto-update）受け入れ条件の実演:
 *   - fixture 環境（AKARI_HOME + AKARI_UPDATE_FEED_URL 差し替え）で、1 回目の起動で
 *     裏 DL が staging を作り、2 回目の起動で新版に切り替わる（`akari --version` が新版）
 *   - `AKARI_NO_AUTO_UPDATE=1` では staging も適用も発生しない
 *   - staging の tarball 改竄（検証 NG）では適用されず app 不変
 *
 * update-apply-integration.test.mjs（U4）と同じ流儀で決定論的に検証する: DL（staging）は
 * 実ローカル HTTP サーバーへ「このテストプロセス自身」から fetch する（= 実際に
 * `triggerBackgroundRefresh` が spawn する detached 子プロセスの中身と全く同じ関数
 * `maybeStageInBackground` を直接呼ぶ。中身のロジックは U4/U5 のどの既存テストとも
 * 共通で、ここで重複実装しない）。「2 回目の起動」だけは実際に
 * `node bin/akari.mjs --version` を子プロセスとして spawn し、ファイル上のスワップと
 * 出力文言を実演する（このステップはネットワークに一切触れないので、子プロセスの
 * ネットワーク到達性に依存しない）。
 *
 * 「1 回目の起動自体が staging DL の完了を待たない」という非ブロック性そのものは、
 * 実 detached 子プロセスの完了を待つと本質的に時間依存の非決定論的なテストになって
 * しまうため、ここでは検証対象にしない。その非ブロック性は test/cli.test.mjs 側の
 * `refreshUpdate` 非 await 検証（`run()` がバックグラウンド fetch の解決を待たずに
 * 戻ることを直接固定する）で決定論的に担保している。
 */

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function buildAppTarball({ version }) {
  const workDir = await mkdtemp(join(tmpdir(), 'akari-auto-apply-fixture-src-'));
  const prefix = 'app-fixture';
  const root = join(workDir, prefix);
  // 本物の bin/akari.mjs 一式をコピーし、package.json の version だけ差し替える —
  // 新版側の展開結果も「本物」で、スワップ後に実際にそのまま実行できることまで検証する。
  await mkdir(join(root, 'packages', 'akari-launcher'), { recursive: true });
  await cp(join(packageRoot, 'bin'), join(root, 'packages', 'akari-launcher', 'bin'), { recursive: true });
  await cp(join(packageRoot, 'src'), join(root, 'packages', 'akari-launcher', 'src'), { recursive: true });
  const pkgRaw = await readFile(join(packageRoot, 'package.json'), 'utf8');
  const pkg = JSON.parse(pkgRaw);
  pkg.version = version;
  await writeFile(join(root, 'packages', 'akari-launcher', 'package.json'), JSON.stringify(pkg), 'utf8');

  const outDir = await mkdtemp(join(tmpdir(), 'akari-auto-apply-fixture-out-'));
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

function akariVersionOf(appDir, extraEnv = {}) {
  const bin = join(appDir, 'packages', 'akari-launcher', 'bin', 'akari.mjs');
  return execFileSync(process.execPath, [bin, '--version'], { encoding: 'utf8', env: { ...process.env, ...extraEnv } });
}

/**
 * ディスク上の package.json を直接読む（`akari --version` を経由しない）。
 * `--version` の呼び出しそのものが「起動」として自動適用を誘発してしまうため、
 * 「まだ適用されていないこと（staging 完了直後）」を確かめるにはこちらを使う。
 */
async function packageVersionAt(appDir) {
  const raw = await readFile(join(appDir, 'packages', 'akari-launcher', 'package.json'), 'utf8');
  return JSON.parse(raw).version;
}

/** feed（JSON）と tarball の両方を配る HTTP サーバー。`/latest.json` と `/app.tgz`。 */
async function withFixtureServer(tarball, feedFactory, callback) {
  let baseUrl;
  const server = createServer((req, res) => {
    if (req.url === '/app.tgz') {
      res.writeHead(200, { 'content-type': 'application/gzip' });
      res.end(tarball);
      return;
    }
    if (req.url === '/latest.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(feedFactory(baseUrl)));
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  await new Promise((resolveReady) => server.listen(0, '127.0.0.1', resolveReady));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    return await callback(baseUrl);
  } finally {
    await new Promise((resolveClosed) => server.close(resolveClosed));
  }
}

async function withScratchHome(callback) {
  const home = await mkdtemp(join(tmpdir(), 'akari-auto-apply-home-'));
  // macOS では /var → /private/var のシンボリックリンクがあり、`os.tmpdir()` は未解決の
  // `/var/...` 形を返す。spawn した `bin/akari.mjs` 側は `import.meta.url` 由来の解決済み
  // 実パスで `isRunningFromAppDir` の一致判定を行うため、fixture の AKARI_HOME もここで
  // 実パスへ揃えておく（実運用の `~/.akari` はこの種のシンボリックリンクを経由しないため
  // 無関係 — このテスト fixture のパス由来の問題）。
  const realHome = realpathSync(home);
  try {
    return await callback({ AKARI_HOME: realHome });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

/**
 * 「1 回目の起動の裏 DL が完了済み」の状態を、実際に detached 子プロセスが呼ぶのと
 * 同じ関数（`maybeStageInBackground`）をこのテストプロセスから直接呼んで作る
 * （子プロセス分離そのものは update-check.mjs の既存テストで別途検証済み。ここでは
 * 「staging が完了した後、次回起動でどう振る舞うか」に焦点を絞る）。
 */
async function stageForNextLaunch(env, appDir, feed) {
  const staged = await maybeStageInBackground({ env, feed, launcherRoot: appDir });
  assert.equal(staged?.ok, true, JSON.stringify(staged));
  await writeFile(
    resolveCachePath(env),
    JSON.stringify({ schema: 1, fetched_at: 't0', feed, dismissed: {}, staged: { version: staged.version, sha256: staged.sha256, staged_at: 't0' } }),
    'utf8'
  );
  return staged;
}

serverTest('U5 一気通貫: 1 回目の起動で裏 staging が完了し、2 回目の起動（akari --version）で新版に切り替わる。成功通知も出る', async () => {
  await withScratchHome(async (env) => {
    const appDir = await seedOldApp(env, '0.1.0');
    assert.match(akariVersionOf(appDir, env), /^v0\.1\.0$/m);

    const tarball = await buildAppTarball({ version: '0.2.0' });
    const expectedSha = sha256(tarball);
    const notesUrl = 'https://github.com/AkariLabs/akari-video/releases/tag/v0.2.0';
    const feedFactory = (baseUrl) => ({
      schema: 1,
      product: '0.2.0',
      channel: 'prerelease',
      notes_url: notesUrl,
      components: { app: { url: `${baseUrl}/app.tgz`, sha256: expectedSha } }
    });

    await withFixtureServer(tarball, feedFactory, async (baseUrl) => {
      const feed = feedFactory(baseUrl);

      // --- 1 回目の起動: 裏 staging（実 DL + sha256 検証 + 展開）が完了する。
      await stageForNextLaunch(env, appDir, feed);

      const cacheAfterFirstLaunch = JSON.parse(await readFile(resolveCachePath(env), 'utf8'));
      assert.equal(cacheAfterFirstLaunch.feed.product, '0.2.0');
      assert.ok(cacheAfterFirstLaunch.staged, '1 回目の起動後、staged がキャッシュに記録されていること');
      assert.equal(cacheAfterFirstLaunch.staged.version, '0.2.0');
      assert.equal(cacheAfterFirstLaunch.staged.sha256, expectedSha);
      assert.equal(existsSync(resolveStagingDir(env, '0.2.0')), true, 'staging ディレクトリが実在すること');
      // まだ適用（スワップ）はされていないこと（ディスク上を直接確認 — `--version` の呼び出し
      // 自体が「起動」として自動適用を誘発してしまうため、それを経由せずに確かめる）。
      assert.equal(await packageVersionAt(appDir), '0.1.0');

      // --- 2 回目の起動: `akari --version` を実 spawn（ネットワークには触れない —
      //     staging は既に完了済みで、あとはファイル上のスワップのみ）。
      //     bin/akari.mjs の先頭で自動適用が走り、その場で新版に切り替わる。
      const result = akariVersionOf(appDir, env);

      assert.match(result, /v0\.2\.0 に更新しました/, result);
      assert.ok(result.includes(notesUrl), result);
      assert.match(result, /^v0\.2\.0$/m, 'akari --version が新版を返すこと');

      const previousDir = resolveAppPreviousDir(env);
      const previousPkg = JSON.parse(await readFile(join(previousDir, 'packages', 'akari-launcher', 'package.json'), 'utf8'));
      assert.equal(previousPkg.version, '0.1.0', '旧版が app-previous に 1 世代保持されること');
      assert.equal(await readFile(join(appDir, 'node_modules', '.marker'), 'utf8'), 'preserved', 'node_modules が引き継がれること');

      const cacheAfterSecondLaunch = JSON.parse(await readFile(resolveCachePath(env), 'utf8'));
      assert.equal(cacheAfterSecondLaunch.staged, undefined, '適用後は staged がキャッシュから消えていること');

      // --- 3 回目の起動: ループガード — 既に適用済みなので、再度呼んでも通知は出ない
      //     （staging ディレクトリが既に消費済みのため自然に no-op）。
      const thirdResult = akariVersionOf(appDir, env);
      assert.ok(!thirdResult.includes('に更新しました'), '3 回目の起動では再適用の通知が出ないこと');
      assert.match(thirdResult, /^v0\.2\.0$/m);
    });
  });
});
serverTest('U5: AKARI_NO_AUTO_UPDATE=1 では 1 回目の起動で staging が作られず、2 回目の起動でも適用されない', async () => {
  await withScratchHome(async (env) => {
    const appDir = await seedOldApp(env, '0.1.0');
    const tarball = await buildAppTarball({ version: '0.2.0' });
    const expectedSha = sha256(tarball);
    const feedFactory = (baseUrl) => ({
      schema: 1,
      product: '0.2.0',
      notes_url: 'https://example.invalid/notes',
      components: { app: { url: `${baseUrl}/app.tgz`, sha256: expectedSha } }
    });

    await withFixtureServer(tarball, feedFactory, async (baseUrl) => {
      const feed = feedFactory(baseUrl);
      const optOutEnv = { ...env, AKARI_NO_AUTO_UPDATE: '1' };

      // 1 回目の起動相当: opt-out 環境では staging 自体が適格性判定で弾かれる。
      const staged = await maybeStageInBackground({ env: optOutEnv, feed, launcherRoot: appDir });
      assert.equal(staged, null, 'opt-out では staging を試みないこと');
      assert.equal(existsSync(resolveStagingDir(env, '0.2.0')), false);

      // U2 の通知用フィード取得自体は独立して続く（ここでは directly cache に書いて模す —
      // runBackgroundFetch 自体の「opt-out でも feed は書く」は update-check.test.mjs で検証済み）。
      await writeFile(resolveCachePath(env), JSON.stringify({ schema: 1, fetched_at: 't0', feed, dismissed: {} }), 'utf8');

      const versionOutput = akariVersionOf(appDir, optOutEnv);
      assert.ok(!versionOutput.includes('に更新しました'));
      assert.match(versionOutput, /^v0\.1\.0$/m, 'opt-out では適用もされないこと');
    });
  });
});

serverTest('U5: staging の tarball が改竄されていれば staged が記録されず、2 回目の起動でも app は不変', async () => {
  await withScratchHome(async (env) => {
    const appDir = await seedOldApp(env, '0.1.0');
    const tarball = await buildAppTarball({ version: '0.2.0' });
    const correctSha = sha256(tarball);
    const tampered = Buffer.from(tarball);
    tampered[0] = tampered[0] ^ 0xff;
    const feedFactory = (baseUrl) => ({
      schema: 1,
      product: '0.2.0',
      notes_url: 'https://example.invalid/notes',
      // フィードには「正しい」sha256 を載せる（転送物だけ改竄されている状況を模す）。
      components: { app: { url: `${baseUrl}/app.tgz`, sha256: correctSha } }
    });

    await withFixtureServer(tampered, feedFactory, async (baseUrl) => {
      const feed = feedFactory(baseUrl);
      const staged = await maybeStageInBackground({ env, feed, launcherRoot: appDir });
      assert.equal(staged.ok, false, '検証 NG では staging が失敗として返ること');
      assert.equal(existsSync(resolveStagingDir(env, '0.2.0')), false);

      await writeFile(resolveCachePath(env), JSON.stringify({ schema: 1, fetched_at: 't0', feed, dismissed: {} }), 'utf8');

      const versionOutput = akariVersionOf(appDir, env);
      assert.ok(!versionOutput.includes('に更新しました'));
      assert.match(versionOutput, /^v0\.1\.0$/m, '検証 NG のときは適用されず app が不変のこと');
    });
  });
});
