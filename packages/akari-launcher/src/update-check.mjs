import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/** launcher 自身の package.json version（D3 裁定により現状はプロダクト版と一致）。 */
export function readOwnVersion() {
  const raw = readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8');
  return JSON.parse(raw).version;
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
export function evaluateUpdateStatus({ currentVersion, cache }) {
  const feed = cache?.feed;
  if (!isValidFeedShape(feed)) {
    return { available: false };
  }
  const latest = feed.product;
  if (compareVersions(latest, currentVersion) <= 0) {
    return { available: false };
  }
  const dismissedAt = cache?.dismissed?.[latest];
  if (dismissedAt) {
    return { available: false, dismissed: true, latestVersion: latest };
  }
  return {
    available: true,
    latestVersion: latest,
    currentVersion,
    channel: typeof feed.channel === 'string' ? feed.channel : undefined,
    notesUrl: typeof feed.notes_url === 'string' ? feed.notes_url : undefined,
    cli: feed.components?.cli
  };
}

/**
 * `akari` 起動時の同期チェック。ファイルの読み比較のみ（ネットワーク I/O 無し）。
 * fetch 関数への参照すら持たない — 「起動をブロックしない」を構造で保証する。
 */
export function checkForUpdateSync({ currentVersion, env = process.env } = {}) {
  const cache = readCacheSync(resolveCachePath(env));
  return evaluateUpdateStatus({ currentVersion, cache });
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
 * バックグラウンド fetch 本体。fetch 失敗・非 200・JSON パース失敗・スキーマ不明は
 * すべて沈黙して return する（何も throw しない）。`dismissed` は既存キャッシュから
 * 引き継ぐ（fetch のたびに既読状態が消えないように）。
 */
export async function runBackgroundFetch({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
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
      return;
    }
    const existing = readCacheSync(cachePath);
    writeCacheSync(cachePath, {
      schema: CACHE_SCHEMA,
      fetched_at: new Date().toISOString(),
      feed,
      dismissed: existing?.dismissed ?? {}
    });
  } catch {
    // オフライン・タイムアウト・DNS 失敗・JSON パース失敗などをすべてここで沈黙する。
  }
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
