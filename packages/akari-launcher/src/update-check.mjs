import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isRunningFromAppDir, resolveStagingDir, stageSelfUpdate, swapStagedApp } from './self-update.mjs';

/**
 * CLI（と、同じ契約に従うシェル）の更新検知・通知の共通ロジック
 * （update-and-versioning 契約（内部リポ）§3 §4、
 * skills-update-check 契約（内部リポ）§2 の検知規律を継承）。
 *
 * 起動をブロックしない: このファイルの同期関数（`checkForUpdateSync` /
 * `readCacheSync` など）は一切ネットワークに触れない。fetch は
 * `triggerBackgroundRefresh` が起動する detached な子プロセス（このファイル自身を
 * `--background-fetch` 付きで再実行する）の中でのみ行い、結果をキャッシュへ
 * 書くだけで終わる（通知は次回セッションで効く）。fetch 失敗・スキーマ不明・
 * オフラインはすべて沈黙する（何も出さず終了）。
 *
 * U5（タスク契約 2026-08-11-update-u5-cli-auto-update・契約 §11）でこのファイルに
 * 2 つの責務が増えた:
 *   - `runBackgroundFetch` はフィード取得後、条件が揃えば（新版あり・
 *     `AKARI_NO_AUTO_UPDATE` 未設定・app 経由インストール）新版を
 *     `~/.akari/staging/<version>/` へ DL + sha256 検証まで裏で済ませ、
 *     キャッシュに `staged`（版・sha256・staged_at）を記録する
 *     （`self-update.mjs` の `stageSelfUpdate` を呼ぶだけ・スワップはしない）
 *   - `maybeApplyPendingUpdateOnLaunch` は起動の頭で呼ぶ関数。`staged` が
 *     最新フィードと一致していれば `self-update.mjs` の `swapStagedApp` を呼んで
 *     アトミックにスワップする（DL はしない・ロック競合や opt-out は沈黙して見送る。
 *     成功時の 1 行通知だけは呼び出し側の `log` で明示的に出す）
 * 両者とも DL・適用の重い処理そのものは `self-update.mjs` に委譲し、ここでは
 * 「いつ・どの条件で呼ぶか」「キャッシュにどう記録するか」だけを扱う（U4 のモジュールの
 * 再利用・ロジックの重複実装をしない、という U5 タスク契約の指示に従う）。
 */

export const DEFAULT_UPDATE_FEED_URL = 'https://github.com/AkariLabs/akari-video/releases/download/updates/latest.json';

const CACHE_SCHEMA = 1;
const FETCH_TIMEOUT_MS = 5000;

const THIS_FILE = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = dirname(dirname(THIS_FILE));

export function resolveFeedUrl(env = process.env) {
  return env.AKARI_UPDATE_FEED_URL || DEFAULT_UPDATE_FEED_URL;
}

/** `~/.akari`（既定）または `AKARI_HOME`（テスト用にルートを差し替え可能）。 */
export function resolveAkariHome(env = process.env) {
  return env.AKARI_HOME || join(homedir(), '.akari');
}

export function resolveCachePath(env = process.env) {
  return join(resolveAkariHome(env), 'update-check.json');
}

export function resolveInstallRefPath(env = process.env) {
  return join(resolveAkariHome(env), 'app', '.akari-install-ref');
}

/** launcher 自身の package.json version（D3 裁定により現状はプロダクト版と一致）。 */
export function readOwnVersion() {
  const raw = readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8');
  return JSON.parse(raw).version;
}

/** install-ref を「有効・未記録・破損」の 3 状態で読む内部表現。 */
function readInstalledAppVersionInfo(env = process.env) {
  const path = resolveInstallRefPath(env);
  try {
    const raw = readFileSync(path, 'utf8').trim();
    const match = raw.match(/^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/);
    return match
      ? { status: 'valid', version: match[1], path }
      : { status: 'invalid', version: null, path };
  } catch (error) {
    return {
      status: error?.code === 'ENOENT' ? 'missing' : 'invalid',
      version: null,
      path
    };
  }
}

/**
 * 実際に render-cut / edit-lint を実行する本体の導入版。
 * install.sh / self-update.mjs が書く `vX.Y.Z` を読む。互換 API として版または null を返し、
 * 未記録と破損の区別は `resolveInstalledVersionInfo()` が保持する。
 */
export function readInstalledAppVersion(env = process.env) {
  return readInstalledAppVersionInfo(env).version;
}

/** 更新判定に使う版と、CLI / 本体のずれを一度に解決する。 */
export function resolveInstalledVersionInfo({ env = process.env, cliVersion = readOwnVersion() } = {}) {
  const installRef = readInstalledAppVersionInfo(env);
  const installedAppVersion = installRef.version;
  const currentVersion = installedAppVersion ?? cliVersion;
  return {
    cliVersion,
    appVersion: installedAppVersion,
    currentVersion,
    source: installRef.status === 'valid'
      ? 'install-ref'
      : installRef.status === 'invalid' ? 'invalid-install-ref' : 'cli-fallback',
    installRefStatus: installRef.status,
    installRefPath: installRef.path,
    installRefNeedsRepair: installRef.status === 'invalid',
    managedApp: installRef.status !== 'missing',
    mismatch: installedAppVersion !== null && compareVersions(cliVersion, installedAppVersion) !== 0
  };
}

/** "major.minor.patch" の先頭 3 要素だけを数値比較する（prerelease 考慮不要 — 契約 D4: stable のみ）。 */
export function compareVersions(a, b) {
  const pa = parseVersionTriplet(a);
  const pb = parseVersionTriplet(b);
  if (!pa || !pb) {
    return 0;
  }
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) {
      return pa[i] < pb[i] ? -1 : 1;
    }
  }
  return 0;
}

function parseVersionTriplet(value) {
  const match = typeof value === 'string' ? value.trim().match(/^(\d+)\.(\d+)\.(\d+)/) : null;
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** `cache.feed` が最低限の形をしているか（壊れたフィードを弾く）。 */
export function isValidFeedShape(feed) {
  return !!feed && typeof feed === 'object' && typeof feed.schema === 'number' && typeof feed.product === 'string';
}

/** キャッシュファイルを読む。無い・壊れている場合は何も投げずに null を返す（沈黙原則）。 */
export function readCacheSync(cachePath) {
  try {
    const parsed = JSON.parse(readFileSync(cachePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeCacheSync(cachePath, cache) {
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
}

/**
 * キャッシュと現在版から、新版通知を出すべきかを判定する（同期・純粋関数・I/O なし）。
 */
export function evaluateUpdateStatus({ currentVersion, cache, cliVersion = currentVersion, appVersion = null, source = 'cli-fallback', installRefStatus, installRefPath, installRefNeedsRepair, managedApp, mismatch = false }) {
  const versionDetails = {
    currentVersion,
    cliVersion,
    appVersion,
    source,
    installRefStatus,
    installRefPath,
    installRefNeedsRepair,
    managedApp,
    mismatch
  };
  const feed = cache?.feed;
  if (!isValidFeedShape(feed)) {
    return { available: false, ...versionDetails };
  }
  const latest = feed.product;
  if (compareVersions(latest, currentVersion) <= 0) {
    return { available: false, latestVersion: latest, ...versionDetails };
  }
  const dismissedAt = cache?.dismissed?.[latest];
  // CLI と本体の取り残しは release 通知の dismiss より強い。黙って古い本体を使わせない。
  if (dismissedAt && !mismatch) {
    return { available: false, dismissed: true, latestVersion: latest, ...versionDetails };
  }
  return {
    available: true,
    latestVersion: latest,
    ...versionDetails,
    channel: typeof feed.channel === 'string' ? feed.channel : undefined,
    notesUrl: typeof feed.notes_url === 'string' ? feed.notes_url : undefined,
    cli: feed.components?.cli
  };
}

/**
 * `akari` 起動時の同期チェック。ファイルの読み比較のみ（ネットワーク I/O 無し）。
 * fetch 関数への参照すら持たない — 「起動をブロックしない」を構造で保証する。
 */
export function checkForUpdateSync({ currentVersion, versionInfo, env = process.env } = {}) {
  const cache = readCacheSync(resolveCachePath(env));
  const versions = versionInfo
    ?? (currentVersion === undefined
      ? resolveInstalledVersionInfo({ env })
      : { cliVersion: currentVersion, appVersion: null, currentVersion, source: 'cli-fallback', mismatch: false });
  return evaluateUpdateStatus({ ...versions, currentVersion: currentVersion ?? versions.currentVersion, cache });
}

/** 「この版の通知を今後出さない」を記録する（同期・ローカル I/O のみ）。 */
export function recordDismissalSync({ version, env = process.env, now = new Date() }) {
  const cachePath = resolveCachePath(env);
  const existing = readCacheSync(cachePath) ?? { schema: CACHE_SCHEMA, fetched_at: null, feed: null, dismissed: {} };
  const next = {
    ...existing,
    dismissed: { ...(existing.dismissed ?? {}), [version]: now.toISOString() }
  };
  writeCacheSync(cachePath, next);
  return next;
}

/**
 * バックグラウンド staging（契約 §11）の適格性判定 + 実行。フィード取得直後に
 * `runBackgroundFetch` から呼ばれる。適格でなければ何もせず `null` を返す
 * （呼び出し側はこの結果でキャッシュへ `staged` を書くかどうかだけ決める）。
 * DL・sha256 検証・展開の実体は `self-update.mjs` の `stageSelfUpdate` そのもの
 * （ここで重複実装しない）。
 *
 * `launcherRoot` はテスト用の注入口（`isRunningFromAppDir` へそのまま渡す。
 * `runUpdateCommand` の `options.launcherRoot` と同じ流儀）。
 * app 外から動く npm CLI でも install-ref があれば管理本体を staging 対象にする。
 */
export async function maybeStageInBackground({ env = process.env, feed, fetchImpl = globalThis.fetch, timeoutMs, extract, launcherRoot } = {}) {
  if (env.AKARI_NO_AUTO_UPDATE === '1') {
    return null;
  }
  const appComponent = feed?.components?.app;
  if (!appComponent?.url || !appComponent?.sha256) {
    return null;
  }
  if (compareVersions(feed.product, resolveInstalledVersionInfo({ env }).currentVersion) <= 0) {
    return null;
  }
  // npm 側 CLI と本体が分離していても、install-ref があれば管理対象の本体を更新できる。
  if (!isRunningFromAppDir({ env, launcherRoot }) && !readInstalledAppVersion(env)) {
    return null;
  }
  // 沈黙原則（U2 を継承）: staging の失敗メッセージはどこにも表示しない（log は no-op）。
  return stageSelfUpdate({ env, feed, log: () => {}, fetchImpl, timeoutMs, extract });
}

/** フィードを 1 回取得し、正常なら既読状態を保ったままキャッシュへ反映する。 */
export async function refreshUpdateFeed({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const feedUrl = resolveFeedUrl(env);
  const cachePath = resolveCachePath(env);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response;
    try {
      response = await fetchImpl(feedUrl, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      return;
    }
    const feed = await response.json();
    if (!isValidFeedShape(feed)) {
      return null;
    }
    const existing = readCacheSync(cachePath);
    const next = {
      schema: CACHE_SCHEMA,
      fetched_at: new Date().toISOString(),
      feed,
      dismissed: existing?.dismissed ?? {}
    };
    writeCacheSync(cachePath, next);
    return next;
  } catch {
    return null;
  }
}

/**
 * バックグラウンド fetch 本体。フィード取得失敗は沈黙し、成功後は契約 §11 の staging を
 * 同じ沈黙原則で試す。成功したときだけキャッシュへ `staged` を追記する。
 */
export async function runBackgroundFetch({ env = process.env, fetchImpl = globalThis.fetch, launcherRoot } = {}) {
  const cachePath = resolveCachePath(env);
  try {
    const refreshed = await refreshUpdateFeed({ env, fetchImpl });
    const feed = refreshed?.feed;
    if (!feed) {
      return;
    }

    const staged = await maybeStageInBackground({ env, feed, fetchImpl, launcherRoot });
    if (staged?.ok) {
      const latest = readCacheSync(cachePath) ?? { schema: CACHE_SCHEMA, dismissed: {} };
      writeCacheSync(cachePath, {
        ...latest,
        staged: { version: staged.version, sha256: staged.sha256, staged_at: new Date().toISOString() }
      });
    }
  } catch {
    // オフライン・タイムアウト・DNS 失敗・JSON パース失敗・staging 失敗などをすべてここで沈黙する。
  }
}

/**
 * `akari` 起動の頭で呼ぶ、次回起動時自動適用の本体（契約 §11）。
 * 適用条件がすべて揃ったときだけ `self-update.mjs` の `swapStagedApp` を呼んで
 * アトミックにスワップする（DL はしない・スワップ自体は `stageSelfUpdate` が既に
 * 検証済みの `staging/<version>/` を使う）。
 *
 * - opt-out（`AKARI_NO_AUTO_UPDATE=1`）なら何もしない
 * - app 経由インストールでなければ何もしない（npm グローバル・git checkout）
 * - キャッシュに `staged` が無い、またはその版が最新フィード（`cache.feed.product`）と
 *   不一致なら何もしない（stale な staging を誤って適用しない）
 * - staging ディレクトリが既に消費済み（存在しない）なら何もしない — これが
 *   「1 起動につき適用 1 回」のループガードを兼ねる（成功した swap は
 *   staging ディレクトリを rename で消費するため、同一プロセス内で 2 回呼んでも
 *   2 回目は自然に no-op になる）
 * - ロック取得に失敗（他プロセスが適用中）したら静かに見送り、次回起動に回す
 *   （`swapStagedApp` に no-op の `log` を渡して沈黙させる）
 *
 * 適用に成功したときだけ、呼び出し側の `log` で「vX.Y.Z に更新しました」+
 * notes_url を明示的に出す（`swapStagedApp` 内部のログは常に沈黙させているため、
 * ここでの呼び出しが「唯一のユーザー可視の通知」になる）。あわせてキャッシュから
 * `staged` を消す（stale 表示を残さないため。既に staging ディレクトリが消費済みなので
 * 消さなくても再適用はされないが、`akari doctor` 等の表示整合のため掃除する）。
 *
 * `runNpmInstall` の既定は「何もしない（常に成功扱い）」— `akari update`（明示操作）の
 * 既定である実 `npm install` とは意図的に異なる。契約 §11 は「起動時にネットワークを
 * 待つことは今後もない」を明記しており、自動適用は起動の頭という最悪のタイミングで
 * npm レジストリへの同期ネットワーク呼び出しを増やすわけにいかない。node_modules は
 * `swapStagedApp` が旧版から複製して引き継ぐため、多くの場合はそのまま動く
 * （依存が変わるリリースでは次回 `akari update` 実行時に整合する）。
 */
export function maybeApplyPendingUpdateOnLaunch({ env = process.env, log = () => {}, runNpmInstall = () => ({ ok: true }), launcherRoot } = {}) {
  if (env.AKARI_NO_AUTO_UPDATE === '1') {
    return { applied: false, reason: 'opt-out' };
  }
  if (!isRunningFromAppDir({ env, launcherRoot })) {
    return { applied: false, reason: 'not-app-dir' };
  }

  const cachePath = resolveCachePath(env);
  const cache = readCacheSync(cachePath);
  const staged = cache?.staged;
  const feed = cache?.feed;
  if (!staged?.version || !isValidFeedShape(feed) || staged.version !== feed.product) {
    return { applied: false, reason: 'no-matching-staged-update' };
  }

  const stagingDir = resolveStagingDir(env, staged.version);
  if (!existsSync(stagingDir)) {
    return { applied: false, reason: 'staging-missing' };
  }

  // 自動適用のスワップ自体は沈黙で試みる（U2 の沈黙原則をこの区間にも継承。ロック競合や
  // rename 失敗はすべて「今回は見送り、次回起動に回す」）。成功時の通知だけは下で明示する。
  const result = swapStagedApp({ env, version: staged.version, stagingDir, log: () => {}, runNpmInstall, notesUrl: undefined });
  if (!result.applied) {
    return { applied: false, reason: result.lockContention ? 'lock-contention' : 'swap-failed' };
  }

  const latestCache = readCacheSync(cachePath) ?? cache ?? { schema: CACHE_SCHEMA, dismissed: {} };
  const { staged: _droppedStaged, ...cacheWithoutStaged } = latestCache;
  writeCacheSync(cachePath, cacheWithoutStaged);

  log(`v${staged.version} に更新しました`);
  if (feed.notes_url) {
    log(`リリースノート: ${feed.notes_url}`);
  }
  return { applied: true, version: staged.version, notesUrl: feed.notes_url };
}

/**
 * detached な子プロセスでこのファイル自身を `--background-fetch` 付きで再実行し、
 * 即座に unref して呼び出し元を待たせない。CLI プロセスは exec 後すぐ終了するため
 * （シェルの長寿命プロセスと違い）、fetch を生かし続けるには子プロセスの分離が要る。
 */
export function triggerBackgroundRefresh({ env = process.env, spawnImpl = spawn } = {}) {
  const child = spawnImpl(process.execPath, [THIS_FILE, '--background-fetch'], {
    detached: true,
    stdio: 'ignore',
    env
  });
  child.unref();
  return child;
}

// このファイルが `--background-fetch` 付きで直接実行された時だけ fetch する
// （cli.mjs からの import 時には何もしない）。triggerBackgroundRefresh が spawn する実体。
if (process.argv[2] === '--background-fetch' && process.argv[1] === THIS_FILE) {
  await runBackgroundFetch({ env: process.env });
}
