import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { resolveLauncherAssets } from './repo-assets.mjs';
import {
  assetIntroNotice,
  soundsCompleteNotice,
  soundsFailedNotice,
  soundsUnavailableError
} from './messages.mjs';

/**
 * 公式音源ライブラリ（AKARI Sounds）まわりの launcher 動線。
 *
 * 2026-08-04 オーナー方針（正本: `planning/notes-2026-08-04-asset-reference-distribution.md`
 * §8）により、2026-08-03 裁定の初回起動 [Y/n] 一括ダウンロード質問（既定 Yes・約 400MB）は
 * 廃止した。素材（B-roll・背景・音源 188 曲）は使うときに必要な分だけ resolver
 * （`packages/asset-resolver` の `akari-assets`）がオンデマンド取得する設計に一本化されたため、
 * launcher 起動のたびに「入れるか入れないか」を聞く必要が無くなった。
 *
 * 代わりに `maybeShowAssetIntroNotice` が「取得方式が変わったこと」と「アカウントを接続すると
 * 購入済み素材も同じ一覧に出ること」（`akari store connect`）を**生涯 1 回だけ**案内する。
 * 質問ではないので TTY 判定も対話ブロックも無い — 単なる 1 行ログ + マーカーファイル。
 * 「生涯 1 回」判定の仕組み自体は旧 declined マーカー方式を踏襲している（存在チェックで
 * 二度と出さない、という枠組みだけ流用し、中身は「declined/n」ではなく「shown」に変えた）。
 *
 * 一括で欲しい人向けの逃げ道として `akari sounds`（`runSoundsCommand`）は残す・変更しない。
 * ダウンロード実体は `packages/audio-library-setup/bin/fetch-akari-sounds.mjs`（自社 GitHub
 * Release のみが取得先）で、この逃げ道からのみ呼ばれる。
 */

const ASSET_INTRO_MARKER = '.akari-asset-intro-shown.json';

/** `~/.akari`（既定）または `AKARI_HOME`（update-check.mjs と同じ差し替え規約）。 */
function resolveAkariHome(env = process.env) {
  return env.AKARI_HOME || path.join(homedir(), '.akari');
}

function assetIntroMarkerPath(env) {
  return path.join(resolveAkariHome(env), ASSET_INTRO_MARKER);
}

/** 素材案内（アカウント接続 + オンデマンド取得）を生涯 1 回だけ表示したかどうか。 */
export function detectAssetIntroState(env = process.env) {
  return { shown: existsSync(assetIntroMarkerPath(env)) };
}

function writeAssetIntroShownMarker(env) {
  const markerPath = assetIntroMarkerPath(env);
  mkdirSync(path.dirname(markerPath), { recursive: true });
  writeFileSync(markerPath, `${JSON.stringify({ shown_at: new Date().toISOString() }, null, 2)}\n`);
}

/**
 * `akari` 起動時の 1 ステップ（2026-08-04〜）。質問はしない・対話をブロックしない —
 * 素材の取得方式案内を生涯 1 回だけ表示するだけ。返り値の action は
 * 'shown' | 'already-shown'。同期関数だが、呼び出し側は他ステップと同じ流儀で await する。
 */
export function maybeShowAssetIntroNotice({ env = process.env, log = console.log } = {}) {
  if (detectAssetIntroState(env).shown) {
    return { action: 'already-shown' };
  }
  writeAssetIntroShownMarker(env);
  log(assetIntroNotice());
  return { action: 'shown' };
}

function defaultSpawnFetch(fetchScriptPath, args, env) {
  // 進捗表示は fetch スクリプト自身が出す（stdio: inherit）。env を明示的に渡すのは必須 —
  // 注入された AKARI_HOME（テスト・隔離実行）が子プロセスの取得先解決にも効くようにする
  // （渡さないと親の実環境を継承し、実 ~/.akari へ書いてしまう）。
  return spawnSync(process.execPath, [fetchScriptPath, ...args], { stdio: 'inherit', env });
}

function runFetch({ fetchScriptPath, fetchArgs = [], env, log, spawnFetch }) {
  const result = spawnFetch(fetchScriptPath, fetchArgs, env);
  if (result.status === 0) {
    log(soundsCompleteNotice());
    return { action: 'downloaded' };
  }
  log(soundsFailedNotice());
  return { action: 'failed' };
}

/**
 * `akari sounds [--variant wav] [--force] …` — 一括ダウンロードの明示的な再入口
 * （初回起動の一括 DL 撤去後も、まとめて欲しい人向けの逃げ道として残す・変更しない）。
 * プロンプトは持たない（引数はそのまま fetch-akari-sounds.mjs へ渡す）。headless 可。
 */
export async function runSoundsCommand(args, options = {}) {
  const log = options.log ?? ((line) => console.log(line));
  const logError = options.logError ?? ((line) => console.error(line));
  const env = options.env ?? process.env;
  const assets = options.assets ?? resolveLauncherAssets();

  const fetchScriptPath = assets?.audioFetchScriptPath;
  if (!fetchScriptPath) {
    logError(soundsUnavailableError());
    return { exitCode: 1 };
  }

  const spawnFetch = options.spawnFetch ?? defaultSpawnFetch;
  const result = runFetch({ fetchScriptPath, fetchArgs: args, env, log, spawnFetch });
  return { exitCode: result.action === 'downloaded' ? 0 : 1 };
}
