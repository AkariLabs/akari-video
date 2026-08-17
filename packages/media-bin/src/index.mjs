// media-bin — ffmpeg / ffprobe / whisper-cli バイナリ解決の一元化。
//
// ffmpeg/ffprobe の探索順: 明示指定（AKARI_FFMPEG_BIN / AKARI_FFPROBE_BIN。パス区切りのない
// 値は PATH で解決） → 既存互換（FFMPEG_PATH、ffmpeg のみ。同じ規則） → PATH → 同梱バイナリ
// （vendor/ 配下。binary-manifest.mjs でピン留めした GPL-only・真ネイティブビルドを
// postinstall で取得済み — task/2026-08-01-gpl-only-ffmpeg-swap）。
//
// whisper-cli の探索順は意図的に異なる（task/2026-08-17-media-bin-whisper 契約どおり）:
// 明示指定（AKARI_WHISPER_BIN） → 同梱バイナリ → PATH。ffmpeg は「PATH 優先」が既存
// システムインストールとの互換性のための既定だが、whisper-cli は事前の既存インストール
// 慣行が無く、PATH 上に無関係な古い whisper.cpp（CLI 引数の互換性が保証されない）が
// 入っている可能性の方がリスクなので、アプリが版固定でピン留めした同梱バイナリを優先する。
//
// 見つからなければサイレントに既定コマンド名へフォールバックせず、何を入れればよいかを
// 含む Error を投げる。

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { platform } from "node:os";

import { vendorBinaryPath } from "./binary-manifest.mjs";

const FFMPEG_INSTALL_HINT = {
  darwin: "  brew install ffmpeg",
  win32: "  winget install Gyan.FFmpeg    （または https://ffmpeg.org/download.html）",
  linux: "  sudo apt install ffmpeg       （Debian/Ubuntu 系）",
  fallback: "  https://ffmpeg.org/download.html",
};

const WHISPER_INSTALL_HINT = {
  darwin: "  brew install whisper-cpp    （whisper-cli コマンドが入る）",
  win32: "  https://github.com/ggml-org/whisper.cpp/releases    （whisper-bin-x64.zip を展開して PATH に追加）",
  linux: "  https://github.com/ggml-org/whisper.cpp#quick-start    （ソースビルド）",
  fallback: "  https://github.com/ggml-org/whisper.cpp",
};

function canRun(command, env, probeArgs) {
  try {
    return spawnSync(command, probeArgs, { stdio: "ignore", env }).status === 0;
  } catch {
    return false;
  }
}

function canResolveCommand(command, env) {
  try {
    return spawnSync(command, ["-version"], { stdio: "ignore", env }).error === undefined;
  } catch {
    return false;
  }
}

function requireExisting(envVar, value) {
  if (!existsSync(value)) {
    throw new Error(`${envVar} で指定されたファイルがありません: ${value}`);
  }
  return value;
}

function resolveExplicit(envVar, value, env) {
  if (/[\\/]/.test(value)) return requireExisting(envVar, value);
  if (canResolveCommand(value, env)) return value;
  throw new Error(
    `${envVar} で明示指定されたコマンド ${value} が PATH に見つかりません。` +
      "絶対パスを指定するか PATH を確認してください。",
  );
}

function notFoundMessage({ label, envVar, legacyEnvVar, vendorPath, installHint, preferVendorOverPath }) {
  const legacyStep = legacyEnvVar ? ` → ${legacyEnvVar}（既存互換・同じ規則）` : "";
  const searchOrder = preferVendorOverPath
    ? `${envVar}（明示指定: 絶対パス / PATH 上のコマンド名）${legacyStep} → 同梱バイナリ（${vendorPath}） → PATH`
    : `${envVar}（明示指定: 絶対パス / PATH 上のコマンド名）${legacyStep} → PATH → 同梱バイナリ（${vendorPath}）`;
  return [
    `${label} が見つかりませんでした。`,
    "",
    `探索順: ${searchOrder}`,
    "",
    "同梱バイナリは packages/media-bin の npm install（postinstall）で取得されるはずですが、",
    "見つかりませんでした。npm install をやり直すか、対応プラットフォームが無い場合は",
    "手動で導入してください:",
    "",
    installHint[platform()] ?? installHint.fallback,
    "",
    `${envVar} には PATH 上のコマンド名または絶対パスを指定できます:`,
    `  ${envVar}=${label}  または  ${envVar}=/path/to/${label}`,
  ].join("\n");
}

function resolveBinary({
  label,
  envVar,
  legacyEnvVar,
  command,
  vendorName,
  env,
  installHint = FFMPEG_INSTALL_HINT,
  preferVendorOverPath = false,
  probeArgs = ["-version"],
}) {
  const explicit = env[envVar];
  if (explicit) return resolveExplicit(envVar, explicit, env);

  if (legacyEnvVar && env[legacyEnvVar]) {
    return resolveExplicit(legacyEnvVar, env[legacyEnvVar], env);
  }

  const vendorPath = vendorBinaryPath(vendorName);
  const vendorExists = existsSync(vendorPath);

  if (preferVendorOverPath && vendorExists) return vendorPath;

  if (canRun(command, env, probeArgs)) return command;

  if (vendorExists) return vendorPath;

  throw new Error(notFoundMessage({ label, envVar, legacyEnvVar, vendorPath, installHint, preferVendorOverPath }));
}

/**
 * ffmpeg バイナリの絶対パス（または PATH 解決に委ねるコマンド名）を返す。
 * @param {{ env?: NodeJS.ProcessEnv }} [opts]
 */
export function resolveFfmpeg({ env = process.env } = {}) {
  return resolveBinary({
    label: "ffmpeg",
    envVar: "AKARI_FFMPEG_BIN",
    legacyEnvVar: "FFMPEG_PATH",
    command: "ffmpeg",
    vendorName: "ffmpeg",
    env,
  });
}

/**
 * ffprobe バイナリの絶対パス（または PATH 解決に委ねるコマンド名）を返す。
 * @param {{ env?: NodeJS.ProcessEnv }} [opts]
 */
export function resolveFfprobe({ env = process.env } = {}) {
  return resolveBinary({
    label: "ffprobe",
    envVar: "AKARI_FFPROBE_BIN",
    legacyEnvVar: null,
    command: "ffprobe",
    vendorName: "ffprobe",
    env,
  });
}

/**
 * whisper-cli バイナリの絶対パス（または PATH 解決に委ねるコマンド名）を返す。
 * 探索順は env → 同梱バイナリ → PATH（ffmpeg とは順序が異なる — ファイル冒頭コメント参照）。
 * @param {{ env?: NodeJS.ProcessEnv }} [opts]
 */
export function resolveWhisperCli({ env = process.env } = {}) {
  return resolveBinary({
    label: "whisper-cli",
    envVar: "AKARI_WHISPER_BIN",
    legacyEnvVar: null,
    command: "whisper-cli",
    vendorName: "whisper-cli",
    env,
    installHint: WHISPER_INSTALL_HINT,
    preferVendorOverPath: true,
    // whisper-cli には ffmpeg 流の "-version" が無い（"-h"/"--help" のみ。未知の引数でも
    // exit 0 する実装だが、それに依存せず本来の --help を使う）。
    probeArgs: ["--help"],
  });
}
