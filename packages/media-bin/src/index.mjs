// media-bin — ffmpeg / ffprobe バイナリ解決の一元化。
//
// 探索順: 明示指定（AKARI_FFMPEG_BIN / AKARI_FFPROBE_BIN） → 既存互換（FFMPEG_PATH、ffmpeg のみ）
// → PATH → ffmpeg-static / ffprobe-static 同梱バイナリ。
// 見つからなければサイレントに "ffmpeg" へフォールバックせず、何を入れればよいかを含む Error を投げる。

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { platform } from "node:os";

const require = createRequire(import.meta.url);

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

function loadStaticBinary(packageName, pickPath) {
  let mod;
  try {
    mod = require(packageName);
  } catch {
    return null;
  }
  const resolved = pickPath(mod);
  return typeof resolved === "string" && resolved.length > 0 ? resolved : null;
}

function notFoundMessage({ label, envVar, legacyEnvVar, staticPackage }) {
  const legacyStep = legacyEnvVar ? ` → ${legacyEnvVar}（既存互換）` : "";
  return [
    `${label} が見つかりませんでした。`,
    "",
    `探索順: ${envVar}（明示指定）${legacyStep} → PATH → ${staticPackage} 同梱バイナリ`,
    "",
    `${staticPackage} が依存として入っているはずですが、対応バイナリが見つかりませんでした。`,
    "npm install をやり直すか、対応プラットフォームが無い場合は手動で導入してください:",
    "",
    INSTALL_HINT[platform()] ?? "  https://ffmpeg.org/download.html",
    "",
    `パスを直接指定することもできます:  ${envVar}=/path/to/${label}`,
  ].join("\n");
}

function resolveBinary({ label, envVar, legacyEnvVar, command, staticPackage, pickStaticPath, env }) {
  const explicit = env[envVar];
  if (explicit) return requireExisting(envVar, explicit);

  if (legacyEnvVar && env[legacyEnvVar]) {
    return requireExisting(legacyEnvVar, env[legacyEnvVar]);
  }

  if (canRun(command, env)) return command;

  const staticPath = loadStaticBinary(staticPackage, pickStaticPath);
  if (staticPath && existsSync(staticPath)) return staticPath;

  throw new Error(notFoundMessage({ label, envVar, legacyEnvVar, staticPackage }));
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
    staticPackage: "ffmpeg-static",
    pickStaticPath: (mod) => mod,
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
    staticPackage: "ffprobe-static",
    pickStaticPath: (mod) => mod?.path,
    env,
  });
}
