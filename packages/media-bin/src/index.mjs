// media-bin — ffmpeg / ffprobe バイナリ解決の一元化。
//
// 探索順: 明示指定（AKARI_FFMPEG_BIN / AKARI_FFPROBE_BIN） → 既存互換（FFMPEG_PATH、ffmpeg のみ）
// → PATH → 同梱バイナリ（vendor/ 配下。binary-manifest.mjs でピン留めした GPL-only・真ネイティブ
// ビルドを postinstall で取得済み — task/2026-08-01-gpl-only-ffmpeg-swap）。
// 見つからなければサイレントに "ffmpeg" へフォールバックせず、何を入れればよいかを含む Error を投げる。

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { platform } from "node:os";

import { vendorBinaryPath } from "./binary-manifest.mjs";

const INSTALL_HINT = {
  darwin: "  brew install ffmpeg",
  win32: "  winget install Gyan.FFmpeg    （または https://ffmpeg.org/download.html）",
  linux: "  sudo apt install ffmpeg       （Debian/Ubuntu 系）",
};

function canRun(command, env) {
  try {
    return spawnSync(command, ["-version"], { stdio: "ignore", env }).status === 0;
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

function notFoundMessage({ label, envVar, legacyEnvVar, vendorPath }) {
  const legacyStep = legacyEnvVar ? ` → ${legacyEnvVar}（既存互換）` : "";
  return [
    `${label} が見つかりませんでした。`,
    "",
    `探索順: ${envVar}（明示指定）${legacyStep} → PATH → 同梱バイナリ（${vendorPath}）`,
    "",
    "同梱バイナリは packages/media-bin の npm install（postinstall）で取得されるはずですが、",
    "見つかりませんでした。npm install をやり直すか、対応プラットフォームが無い場合は",
    "手動で導入してください:",
    "",
    INSTALL_HINT[platform()] ?? "  https://ffmpeg.org/download.html",
    "",
    `パスを直接指定することもできます:  ${envVar}=/path/to/${label}`,
  ].join("\n");
}

function resolveBinary({ label, envVar, legacyEnvVar, command, vendorName, env }) {
  const explicit = env[envVar];
  if (explicit) return requireExisting(envVar, explicit);

  if (legacyEnvVar && env[legacyEnvVar]) {
    return requireExisting(legacyEnvVar, env[legacyEnvVar]);
  }

  if (canRun(command, env)) return command;

  const vendorPath = vendorBinaryPath(vendorName);
  if (existsSync(vendorPath)) return vendorPath;

  throw new Error(notFoundMessage({ label, envVar, legacyEnvVar, vendorPath }));
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
