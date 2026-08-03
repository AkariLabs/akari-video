import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { resolveLauncherAssets } from './repo-assets.mjs';
import { defaultPrompt } from './first-run.mjs';
import {
  soundsPromptText,
  soundsCompleteNotice,
  soundsDeclinedNotice,
  soundsFailedNotice,
  soundsUnavailableError
} from './messages.mjs';

/**
 * 公式音源ライブラリ（AKARI Sounds）の初回セットアップ動線（2026-08-03 オーナー裁定）:
 *   - 既定 = 一括ダウンロード。質問は初回 1 回だけ（[Y/n]・空 Enter = Yes）。
 *     曲ごと・配布元ごとの選択は一切させない
 *   - n を選んだら marker を書いて以後は聞かない（再入口は `akari sounds`）
 *   - 追加カタログ（外部補完 = 拍手・失敗音・和風打撃など）は完了時に 1 行案内するだけ。
 *     取得はセッション内でエージェントに頼む（setup-audio-library の assisted-fetch）
 *
 * ダウンロード実体は packages/audio-library-setup/bin/fetch-akari-sounds.mjs（自社 GitHub
 * Release のみが取得先）。本モジュールは「いつ聞くか・聞いた結果をどう覚えるか」の配線だけを
 * 持ち、失敗しても `akari` の「最後に claude を exec」の不変条件を壊さない。
 */

const DECLINED_MARKER = '.akari-sounds-declined.json';
const PACK_IDS = ['akari-sounds-bgm', 'akari-sounds-sfx', 'akari-sounds-jingle'];

/** `~/.akari`（既定）または `AKARI_HOME`（update-check.mjs と同じ差し替え規約）。 */
function resolveAkariHome(env = process.env) {
  return env.AKARI_HOME || path.join(homedir(), '.akari');
}

export function resolveAudioLibraryRoot(env = process.env) {
  return path.join(resolveAkariHome(env), 'assets', 'audio');
}

function declinedMarkerPath(env) {
  return path.join(resolveAudioLibraryRoot(env), DECLINED_MARKER);
}

/**
 * 導入状態の判定。installed は 3 パックすべての meta.json が揃っていること
 * （fetch-akari-sounds.mjs が最後に書くファイルなので「完走した」ことの近似として十分）。
 */
export function detectSoundsState(env = process.env) {
  const root = resolveAudioLibraryRoot(env);
  const installed = PACK_IDS.every((id) => existsSync(path.join(root, id, 'meta.json')));
  const declined = existsSync(declinedMarkerPath(env));
  return { installed, declined };
}

function writeDeclinedMarker(env) {
  const markerPath = declinedMarkerPath(env);
  mkdirSync(path.dirname(markerPath), { recursive: true });
  writeFileSync(markerPath, `${JSON.stringify({ declined_at: new Date().toISOString() }, null, 2)}\n`);
}

function defaultSpawnFetch(fetchScriptPath, args, env) {
  // 進捗表示は fetch スクリプト自身が出す（stdio: inherit）。env を明示的に渡すのは必須 —
  // 注入された AKARI_HOME（テスト・隔離実行）が子プロセスの取得先解決にも効くようにする
  // （渡さないと親の実環境を継承し、実 ~/.akari へ書いてしまう）。
  return spawnSync(process.execPath, [fetchScriptPath, ...args], { stdio: 'inherit', env });
}

function runFetch({ fetchScriptPath, fetchArgs = [], env, log, spawnFetch }) {
  const result = spawnFetch(fetchScriptPath, fetchArgs, env);
  const ok = result.status === 0;
  if (ok) {
    // 過去に n を選んでいても、明示的に入れ直したら marker は役目を終える。
    rmSync(declinedMarkerPath(env), { force: true });
    log(soundsCompleteNotice());
    return { action: 'downloaded' };
  }
  log(soundsFailedNotice());
  return { action: 'failed' };
}

/**
 * `akari` 起動時の 1 ステップ。返り値の action は
 * 'unavailable' | 'installed' | 'declined' | 'skipped-non-tty' | 'downloaded' | 'declined-now' | 'failed'。
 * unavailable / installed / declined / 非 TTY では何も表示しない（毎回の起動を汚さない）。
 */
export async function maybeSetupSounds({ env = process.env, log = console.log, assets, autoConfirm = false, options = {} } = {}) {
  const fetchScriptPath = assets?.audioFetchScriptPath;
  if (!fetchScriptPath) {
    return { action: 'unavailable' };
  }

  const state = detectSoundsState(env);
  if (state.installed) {
    return { action: 'installed' };
  }
  if (state.declined) {
    return { action: 'declined' };
  }

  const spawnFetch = options.spawnFetch ?? defaultSpawnFetch;

  if (!autoConfirm) {
    const isTTY = options.isTTY ?? Boolean(process.stdin.isTTY);
    if (!isTTY) {
      // 非 TTY（自動化・CI）では聞かずに何もしない（現行動作互換。creator-root と同じ扱い）。
      return { action: 'skipped-non-tty' };
    }
    const promptFn = options.prompt ?? defaultPrompt;
    const answerRaw = await promptFn(soundsPromptText());
    const answer = typeof answerRaw === 'string' ? answerRaw.trim().toLowerCase() : '';
    if (answer === 'n' || answer === 'no') {
      writeDeclinedMarker(env);
      log(soundsDeclinedNotice());
      return { action: 'declined-now' };
    }
  }

  return runFetch({ fetchScriptPath, env, log, spawnFetch });
}

/**
 * `akari sounds [--variant wav] [--force] …` — 一括ダウンロードの明示的な再入口。
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
