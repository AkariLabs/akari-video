// 参照メディアの収集と ffprobe による実尺取得（任意）。
// ffprobe の解決は media-bin（AKARI_FFPROBE_BIN → FFMPEG_PATH → PATH → static）へ委譲。

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "aac", "m4a", "flac", "ogg", "aiff", "aif"]);

export function absoluteMediaPath(projectRoot, mediaPath) {
  return isAbsolute(mediaPath) ? mediaPath : resolve(projectRoot, mediaPath);
}

export function mediaFileUrl(projectRoot, mediaPath) {
  return pathToFileURL(absoluteMediaPath(projectRoot, mediaPath)).href;
}

export function isAudioOnlyPath(mediaPath) {
  const extension = mediaPath.split(".").pop()?.toLowerCase() ?? "";
  return AUDIO_EXTENSIONS.has(extension);
}

// モデルが参照する全メディアパス（project 相対の生値）を役割付きで列挙する。
export function collectMediaRefs(model) {
  const refs = new Map();
  const add = (path, role) => {
    if (typeof path !== "string" || path.trim() === "") return;
    if (!refs.has(path)) refs.set(path, { path, roles: new Set() });
    refs.get(path).roles.add(role);
  };
  for (const source of model.sources) add(source.path, "source");
  for (const layer of model.layers) add(layer.src, "layer");
  for (const item of model.narration) add(item.path, "narration");
  for (const item of model.sfx ?? []) add(item.path, "sfx");
  if (model.bgm) add(model.bgm.path, "bgm");
  return [...refs.values()];
}

export function probeDurations(model, { ffprobePath, onWarning }) {
  const durations = new Map();
  if (!ffprobePath) return durations;
  for (const ref of collectMediaRefs(model)) {
    const absolute = absoluteMediaPath(model.projectRoot, ref.path);
    if (!existsSync(absolute)) {
      onWarning?.(`メディアが見つからない: ${ref.path} — 実尺不明のまま書き出す`);
      continue;
    }
    const result = spawnSync(
      ffprobePath,
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", absolute],
      { encoding: "utf8" },
    );
    const parsed = Number.parseFloat(result.stdout?.trim());
    if (result.status === 0 && Number.isFinite(parsed) && parsed > 0) {
      durations.set(ref.path, parsed);
    } else {
      onWarning?.(`ffprobe が実尺を取得できない: ${ref.path}`);
    }
  }
  return durations;
}

// probe 結果を含めた合成尺。narration は t + 実尺まで伸ばす（不明なら含めない）。
export function timelineDurationWithMedia(model, baseDuration, durations) {
  let end = baseDuration;
  for (const item of model.narration) {
    const duration = durations.get(item.path);
    if (typeof item.t === "number" && typeof duration === "number") {
      end = Math.max(end, item.t + duration);
    }
  }
  for (const item of model.sfx ?? []) {
    if (typeof item.t !== "number" || typeof item.out === "number") continue;
    const duration = durations.get(item.path);
    const inPoint = typeof item.in === "number" ? item.in : 0;
    if (typeof duration === "number" && duration > inPoint) {
      end = Math.max(end, item.t + (duration - inPoint));
    }
  }
  return end;
}
