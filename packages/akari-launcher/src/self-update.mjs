import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveAkariHome } from './update-check.mjs';

/**
 * `akari update` の実適用（update-and-versioning 契約（内部リポ）§11）:
 * フィードの `components.app`（install.sh が入れるフル構成ソース tarball）を
 * DL → sha256 検証 → `~/.akari/staging/<version>/` へ展開 →（検証完了までスワップ開始しない）
 * → `~/.akari/app` と rename ベースで入れ替え → 旧版は `~/.akari/app-previous/` に 1 世代保持。
 *
 * 「update は明示操作」なので、この一連の処理は U2 の沈黙原則（起動時チェックの失敗沈黙）の
 * 対象外 — 失敗は必ず `log` で明示する。途中失敗（DL 断・検証 NG・rename 失敗）では
 * `~/.akari/app` を一切書き換えない（検証・展開はすべて `~/.akari/staging/` 側で完結させ、
 * app 本体に触れるのは「展開済みかつ検証済み」の段になってから）。
 *
 * U5（タスク契約 2026-08-11-update-u5-cli-auto-update）でこのファイルは 2 つの新しい
 * 呼び出し口を得た。ロジックの重複実装を避けるため、DL/検証/展開（`stageSelfUpdate`）と
 * スワップのみ（`swapStagedApp`）を分離し、`applySelfUpdate`（`akari update` 用・既存）は
 * この 2 つを直列に呼ぶだけの薄い合成関数にした:
 *   - バックグラウンド staging（`update-check.mjs` の `runBackgroundFetch` 拡張）は
 *     `stageSelfUpdate` だけを呼ぶ（スワップはしない・DL と検証だけ裏で済ませる）
 *   - 次回起動時の自動適用（`update-check.mjs` の `maybeApplyPendingUpdateOnLaunch`）は
 *     staging 済みディレクトリを受けて `swapStagedApp` だけを呼ぶ（DL はしない）。
 *     スワップは多重実行を防ぐためロックファイル（`~/.akari/update-apply.lock`）で
 *     ガードする（`swapStagedApp` 内蔵・`akari update` の明示適用にも同じガードが効く）
 */

const THIS_FILE = fileURLToPath(import.meta.url);
// packages/akari-launcher/src/ から見て 1 つ上（このパッケージのルート）。
const PACKAGE_ROOT = resolve(dirname(THIS_FILE), '..');
// install.sh が展開するのはモノレポのルートそのもの（$INSTALL_DIR 直下に
// packages/ apps/ 等が並ぶ）。このファイルの実行位置からモノレポルート相当を
// 逆算し、`~/.akari/app`（AKARI_HOME 考慮）と一致するかどうかで「app 経由で
// 動いているか」を判定する（repo-assets.mjs の DEFAULT_REPO_ROOT_CANDIDATE と同じ導出）。
const DEFAULT_LAUNCHER_ROOT_CANDIDATE = resolve(PACKAGE_ROOT, '..', '..');

// フィード metadata 取得（update-check.mjs）は数 KB なので 5s で十分だが、こちらは
// 数 MB のフル構成ソース tarball の DL のため、同じ「AbortController + タイムアウト」の
// 型は踏襲しつつ値だけ緩める。
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 60_000;

export function resolveAppDir(env = process.env) {
  return join(resolveAkariHome(env), 'app');
}

export function resolveAppPreviousDir(env = process.env) {
  return join(resolveAkariHome(env), 'app-previous');
}

export function resolveStagingRoot(env = process.env) {
  return join(resolveAkariHome(env), 'staging');
}

export function resolveStagingDir(env = process.env, version) {
  return join(resolveStagingRoot(env), version);
}

/**
 * 実行中のランチャーが `~/.akari/app`（`AKARI_HOME` 考慮）配下から動いているか。
 * npm グローバル / git checkout（モノレポ開発）ではここが false になり、
 * 呼び出し側（cli.mjs）は自動適用をせず従来の案内表示へ縮退する。
 */
export function isRunningFromAppDir({ env = process.env, launcherRoot = DEFAULT_LAUNCHER_ROOT_CANDIDATE } = {}) {
  return resolve(launcherRoot) === resolve(resolveAppDir(env));
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

async function downloadFile({ url, destPath, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_DOWNLOAD_TIMEOUT_MS }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(url, { signal: controller.signal });
  } catch (error) {
    throw new Error(`ネットワークエラー: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, buffer);
}

/**
 * `tar.gz` を展開する。install.sh の `fetch_release_tarball` と同じ意味論
 * （`--strip-components=1`）— tarball は単一の先頭ディレクトリを持つ想定
 * （release.yml は `git archive` で作るため codeload.github.com のタグ tarball と同形）。
 */
function extractTarGz({ tarPath, destDir }) {
  const result = spawnSync('tar', ['-xzf', tarPath, '-C', destDir, '--strip-components=1'], { stdio: 'pipe' });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`tar が失敗しました（code ${result.status}）: ${result.stderr?.toString().trim() ?? ''}`);
  }
}

/** install.sh `update_install()` と同じ意味論: 適用後に npm install で node_modules を整合させる。 */
function defaultRunNpmInstall({ cwd }) {
  const result = spawnSync('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], { cwd, stdio: 'pipe' });
  if (result.error) {
    return { ok: false, message: result.error.message };
  }
  if (result.status !== 0) {
    return { ok: false, message: result.stderr?.toString().trim() };
  }
  return { ok: true };
}

function readVersionAt(appDir) {
  try {
    const raw = readFileSync(join(appDir, 'packages', 'akari-launcher', 'package.json'), 'utf8');
    return JSON.parse(raw).version ?? null;
  } catch {
    return null;
  }
}

// 同時実行ガード（U5・契約 §11「同時実行ガード」）: スワップ（rename）を多重実行させない
// ロックファイル。`mkdirSync` の EEXIST はディレクトリ作成のアトミック性を借りた
// クロスプロセスの排他制御（Windows でも同じ意味論で動く）。クラッシュ跡で残った
// ロックは一定時間で「陳腐」とみなして奪取する（保持者が消えても永久にロックされないため）。
const APPLY_LOCK_STALE_MS = 60_000;

function resolveApplyLockPath(env) {
  return join(resolveAkariHome(env), 'update-apply.lock');
}

function acquireApplyLock(env) {
  const lockPath = resolveApplyLockPath(env);
  try {
    mkdirSync(lockPath, { recursive: false });
    return lockPath;
  } catch (error) {
    if (error?.code !== 'EEXIST') {
      return null;
    }
    try {
      const info = statSync(lockPath);
      if (Date.now() - info.mtimeMs > APPLY_LOCK_STALE_MS) {
        rmSync(lockPath, { recursive: true, force: true });
        mkdirSync(lockPath, { recursive: false });
        return lockPath;
      }
    } catch {
      // 陳腐判定・奪取のどちらかに失敗したら「取得失敗」として扱う（安全側に倒す）。
    }
    return null;
  }
}

function releaseApplyLock(lockPath) {
  if (lockPath) {
    rmSync(lockPath, { recursive: true, force: true });
  }
}

/**
 * DL → sha256 検証 → `~/.akari/staging/<version>/` への展開まで（スワップはしない）。
 * `akari update`（`applySelfUpdate`）とバックグラウンド staging
 * （`update-check.mjs` の `runBackgroundFetch`）の両方から呼ばれる共有本体。
 * 失敗時は `log` を呼んでから `{ ok: false }` を返す（呼び出し側が「沈黙するか表示するか」を
 * `log` に no-op を渡すかどうかで選べるようにしてある — バックグラウンド側は no-op を渡す）。
 */
export async function stageSelfUpdate({
  env = process.env,
  feed,
  log = () => {},
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_DOWNLOAD_TIMEOUT_MS,
  extract = extractTarGz
} = {}) {
  const appComponent = feed?.components?.app;
  if (!appComponent?.url || !appComponent?.sha256) {
    log('更新フィードに app 成分がありません（旧フィード）。手動更新の案内に切り替えます。');
    return { ok: false, reason: 'no-app-component' };
  }

  const version = feed.product;
  const stagingRoot = resolveStagingRoot(env);
  const stagingDir = resolveStagingDir(env, version);
  const downloadPath = join(stagingRoot, `.download-${version}.tar.gz`);

  // 前回の失敗試行の残骸を掃除してから始める（検証完了までスワップは始めない、の前提）。
  rmSync(stagingDir, { recursive: true, force: true });
  rmSync(downloadPath, { force: true });
  mkdirSync(stagingRoot, { recursive: true });

  log(`v${version} をダウンロードしています…`);
  try {
    await downloadFile({ url: appComponent.url, destPath: downloadPath, fetchImpl, timeoutMs });
  } catch (error) {
    rmSync(downloadPath, { force: true });
    log(`更新のダウンロードに失敗しました（現在のインストールは変更していません）: ${error.message}`);
    return { ok: false, reason: 'download-failed' };
  }

  const actualSha256 = sha256File(downloadPath);
  if (actualSha256 !== appComponent.sha256) {
    rmSync(downloadPath, { force: true });
    log(`更新の検証に失敗しました（sha256 不一致。期待値 ${appComponent.sha256} / 実際 ${actualSha256}）。適用を中止しました（現在のインストールは変更していません）。`);
    return { ok: false, reason: 'hash-mismatch' };
  }

  mkdirSync(stagingDir, { recursive: true });
  try {
    extract({ tarPath: downloadPath, destDir: stagingDir });
  } catch (error) {
    rmSync(stagingDir, { recursive: true, force: true });
    rmSync(downloadPath, { force: true });
    log(`更新の展開に失敗しました（現在のインストールは変更していません）: ${error instanceof Error ? error.message : String(error)}`);
    return { ok: false, reason: 'extract-failed' };
  }
  rmSync(downloadPath, { force: true });

  return { ok: true, version, stagingDir, sha256: actualSha256 };
}

/**
 * 検証済みで展開済みの `stagingDir` を `~/.akari/app` へスワップするだけの本体
 * （DL はしない）。`applySelfUpdate`（`akari update`）と、次回起動時の自動適用
 * （`update-check.mjs` の `maybeApplyPendingUpdateOnLaunch`）の両方から呼ばれる。
 * ロックを取得できない場合は「今回の適用を静かに見送る」（部分適用状態を作らないための
 * 多重スワップ防止・契約 §11「同時実行ガード」） — 呼び出し側が沈黙させたい場合は
 * `log` に no-op を渡す。
 */
export function swapStagedApp({
  env = process.env,
  version,
  stagingDir,
  log = () => {},
  runNpmInstall = defaultRunNpmInstall,
  notesUrl
} = {}) {
  const lockPath = acquireApplyLock(env);
  if (!lockPath) {
    log('他のプロセスが更新を適用中のため、今回の適用は見送りました。次回に持ち越します。');
    return { exitCode: 1, applied: false, lockContention: true };
  }

  try {
    const appDir = resolveAppDir(env);
    const appPreviousDir = resolveAppPreviousDir(env);

    // ここから先だけが `~/.akari/app` に触れる区間。rename は同一ファイルシステム内
    // （どちらも AKARI_HOME 配下）なのでアトミック。失敗したら退避した旧 app を戻す。
    const swapTag = `${appDir}.swap-${Date.now()}`;
    const hadExistingApp = existsSync(appDir);
    if (hadExistingApp) {
      try {
        renameSync(appDir, swapTag);
      } catch (error) {
        rmSync(stagingDir, { recursive: true, force: true });
        log(`更新の適用に失敗しました（既存インストールの退避に失敗。現在のインストールは変更していません）: ${error.message}`);
        return { exitCode: 1, applied: false };
      }
    }

    try {
      if (hadExistingApp) {
        // node_modules は「引き継ぐ」＝コピー（move ではない）。旧世代（app-previous に
        // なる swapTag）が node_modules を失うと --rollback しても動かないインストールに
        // なってしまうため、両方に実体を持たせる（install.sh update_install() は
        // 「previous」概念自体を持たないので move で済んでいたが、こちらは 1 世代保持が
        // 要件のため複製が必要）。
        const oldNodeModules = join(swapTag, 'node_modules');
        if (existsSync(oldNodeModules)) {
          cpSync(oldNodeModules, join(stagingDir, 'node_modules'), { recursive: true });
        }
      }
      renameSync(stagingDir, appDir);
    } catch (error) {
      // 部分適用状態を残さない: 退避した旧 app を appDir へ戻す。
      if (hadExistingApp && existsSync(swapTag)) {
        try {
          renameSync(swapTag, appDir);
        } catch {
          // 復元も失敗した場合は打つ手がない。手動介入を促すメッセージだけ残す。
          log(`重大: 旧インストールの復元にも失敗しました。手動確認が必要です（退避先: ${swapTag}）。`);
        }
      }
      rmSync(stagingDir, { recursive: true, force: true });
      log(`更新の適用に失敗しました（切り替えに失敗。可能な範囲で元の状態へ復元しました）: ${error instanceof Error ? error.message : String(error)}`);
      return { exitCode: 1, applied: false };
    }

    // 旧世代の確定: 1 世代のみ保持（既存の app-previous は破棄）。node_modules は
    // 上でコピー済みなので、swapTag（旧 app 丸ごと）をそのまま app-previous にできる。
    rmSync(appPreviousDir, { recursive: true, force: true });
    if (hadExistingApp) {
      renameSync(swapTag, appPreviousDir);
    }

    writeFileSync(join(appDir, '.akari-install-ref'), `v${version}\n`, 'utf8');

    const npmResult = runNpmInstall({ cwd: appDir });
    if (!npmResult.ok) {
      log(`npm install が失敗しました（更新自体は適用済みです。問題が続く場合は \`akari update --rollback\` を検討してください）: ${npmResult.message ?? ''}`);
    }

    log(`v${version} に更新しました`);
    if (notesUrl) {
      log(`リリースノート: ${notesUrl}`);
    }
    return { exitCode: 0, applied: true, version, npmInstallOk: npmResult.ok };
  } finally {
    releaseApplyLock(lockPath);
  }
}

/**
 * `akari update` の実適用本体。呼び出し側（cli.mjs）は既に「自己更新の対象になる」ことを
 * 確認してから呼ぶ（フィードに `components.app` がある・app 経由実行である・新版がある）。
 * 各段の失敗は `log` で明示し、`~/.akari/app` が失敗以前の状態のまま保たれることを保証する。
 * 実体は `stageSelfUpdate`（DL・検証・展開）→ `swapStagedApp`（スワップ）の合成（U5 で分離）。
 */
export async function applySelfUpdate({
  env = process.env,
  feed,
  log = () => {},
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_DOWNLOAD_TIMEOUT_MS,
  extract = extractTarGz,
  runNpmInstall = defaultRunNpmInstall
} = {}) {
  const staged = await stageSelfUpdate({ env, feed, log, fetchImpl, timeoutMs, extract });
  if (!staged.ok) {
    return { exitCode: 1, applied: false };
  }
  return swapStagedApp({
    env,
    version: staged.version,
    stagingDir: staged.stagingDir,
    log,
    runNpmInstall,
    notesUrl: feed.notes_url
  });
}

/**
 * `akari update --rollback`: `app-previous` を `app` へ戻す。往復可能である必要はない
 * （契約 §11 = 「1 段」）が、実装としては単純な 3 段 rename（app ⇄ app-previous の
 * 入れ替え）にしてあるため、結果として往復もできる。
 */
export function rollbackSelfUpdate({ env = process.env, log = () => {} } = {}) {
  const appDir = resolveAppDir(env);
  const appPreviousDir = resolveAppPreviousDir(env);

  if (!existsSync(appPreviousDir)) {
    log('ロールバック対象がありません（保存されている前バージョンがありません）。');
    return { exitCode: 1, rolledBack: false };
  }

  const swapTag = `${appDir}.rollback-${Date.now()}`;
  const hadExistingApp = existsSync(appDir);
  try {
    if (hadExistingApp) {
      renameSync(appDir, swapTag);
    }
    renameSync(appPreviousDir, appDir);
    if (hadExistingApp) {
      renameSync(swapTag, appPreviousDir);
    }
  } catch (error) {
    log(`ロールバックに失敗しました: ${error instanceof Error ? error.message : String(error)}`);
    return { exitCode: 1, rolledBack: false };
  }

  const version = readVersionAt(appDir);
  if (version) {
    // install-ref が無い古い app-previous へ戻した場合も、以後の更新判定を本体版基準に保つ。
    writeFileSync(join(appDir, '.akari-install-ref'), `v${version}\n`, 'utf8');
  }
  log(version ? `v${version} へロールバックしました` : 'ロールバックしました');
  return { exitCode: 0, rolledBack: true, version };
}
