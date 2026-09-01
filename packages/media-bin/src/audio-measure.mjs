import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { resolveFfprobe } from "./index.mjs";

export const AUDIO_MEASURE_METRIC = "akari-audio-measure-v1";

const CAPTURE_LIMIT_BYTES = 16 * 1024 * 1024;

function finiteOrNull(text) {
  if (text === undefined || /^-?inf(?:inity)?$/iu.test(text.trim())) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function lastMatch(text, pattern) {
  const matches = [...text.matchAll(pattern)];
  return matches.length > 0 ? matches[matches.length - 1] : undefined;
}

export function parseAudioMeasureStderr(stderr) {
  const text = String(stderr ?? "");
  const summaryAt = text.lastIndexOf("Summary:");
  const summary = summaryAt >= 0 ? text.slice(summaryAt) : "";
  const overallMatches = [...text.matchAll(/\bOverall\s*\r?\n([\s\S]*?)(?=\r?\n(?:\[[^\]]+\]\s*)?(?:Overall|Summary:)|$)/gu)];
  const overall = overallMatches.length > 0 ? overallMatches[overallMatches.length - 1][1] : "";

  const integratedRaw = lastMatch(summary, /^\s*I:\s*(-?(?:\d+(?:\.\d+)?|inf(?:inity)?))\s+LUFS\s*$/gimu)?.[1];
  const lraRaw = lastMatch(summary, /^\s*LRA:\s*(-?(?:\d+(?:\.\d+)?|inf(?:inity)?))\s+LU\s*$/gimu)?.[1];
  const truePeakRaw = lastMatch(summary, /^\s*Peak:\s*(-?(?:\d+(?:\.\d+)?|inf(?:inity)?))\s+dBFS\s*$/gimu)?.[1];
  const samplePeakRaw = lastMatch(overall, /Peak level dB:\s*(-?(?:\d+(?:\.\d+)?|inf(?:inity)?))/giu)?.[1];
  const rmsRaw = lastMatch(overall, /RMS level dB:\s*(-?(?:\d+(?:\.\d+)?|inf(?:inity)?))/giu)?.[1];

  const integrated = finiteOrNull(integratedRaw);
  return {
    integrated_lufs: integrated !== null && integrated > -70 ? integrated : null,
    loudness_range_lu: integrated !== null && integrated > -70 ? finiteOrNull(lraRaw) : null,
    true_peak_dbtp: finiteOrNull(truePeakRaw),
    sample_peak_dbfs: finiteOrNull(samplePeakRaw),
    rms_dbfs: finiteOrNull(rmsRaw),
  };
}

function summarize(value, fallback) {
  const text = String(value ?? "").replace(/\s+/gu, " ").trim();
  return text ? text.slice(0, 1000) : fallback;
}

function probeAudio(filePath, ffprobePath = resolveFfprobe()) {
  const result = spawnSync(ffprobePath, [
    "-hide_banner", "-v", "error", "-select_streams", "a:0",
    "-show_entries", "stream=sample_rate,channels:format=duration", "-of", "json", filePath,
  ], { encoding: "utf8", maxBuffer: CAPTURE_LIMIT_BYTES });
  if (result.error || result.status !== 0) {
    throw new Error(summarize(result.stderr || result.error?.message, "ffprobe による音声情報の取得に失敗しました"));
  }
  const value = JSON.parse(result.stdout || "{}");
  const stream = Array.isArray(value.streams) ? value.streams[0] : undefined;
  const duration = Number(value.format?.duration);
  const sampleRate = Number(stream?.sample_rate);
  const channels = Number(stream?.channels);
  if (!Number.isFinite(duration) || duration < 0 || !Number.isFinite(sampleRate) || sampleRate <= 0
    || !Number.isInteger(channels) || channels <= 0) {
    throw new Error("ffprobe が有効な音声情報を返しませんでした");
  }
  return { duration_sec: duration, sample_rate: sampleRate, channels };
}

function cacheKey(realPath, stat) {
  return crypto.createHash("sha1")
    .update([realPath, stat.size, stat.mtimeMs, AUDIO_MEASURE_METRIC].join("|"))
    .digest("hex");
}

export function measureAudioLevels({ ffmpegPath, filePath, cacheDir, useCache = true }) {
  if (typeof ffmpegPath !== "string" || !ffmpegPath) throw new Error("ffmpegPath が必要です");
  if (typeof filePath !== "string" || !filePath) throw new Error("filePath が必要です");
  const realPath = fs.realpathSync(filePath);
  const stat = fs.statSync(realPath);
  if (!stat.isFile()) throw new Error("計測対象が通常ファイルではありません");
  const key = cacheKey(realPath, stat);
  const cachePath = cacheDir ? path.join(path.resolve(cacheDir), `${key}.json`) : null;
  if (useCache && cachePath) {
    try {
      return JSON.parse(fs.readFileSync(cachePath, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
  }

  const result = spawnSync(ffmpegPath, [
    "-hide_banner", "-nostdin", "-nostats", "-i", realPath,
    "-vn", "-sn", "-dn",
    "-af", "ebur128=peak=true:framelog=verbose,astats=measure_perchannel=none:measure_overall=Peak_level+RMS_level",
    "-f", "null", "-",
  ], { encoding: "utf8", maxBuffer: CAPTURE_LIMIT_BYTES });
  if (result.error || result.status !== 0) {
    throw new Error(summarize(result.stderr || result.error?.message, "ffmpeg による音声レベル計測に失敗しました"));
  }
  const measured = parseAudioMeasureStderr(result.stderr);
  if (measured.integrated_lufs === null && measured.sample_peak_dbfs === null
    && measured.true_peak_dbtp === null && !/\bSummary:/u.test(result.stderr)) {
    throw new Error("ffmpeg の音声レベル計測結果を解析できませんでした");
  }
  const metadata = probeAudio(realPath);
  const output = {
    metric: AUDIO_MEASURE_METRIC,
    ...measured,
    ...metadata,
    source: { size: stat.size, mtime_ms: stat.mtimeMs, sha1_key: key },
  };
  if (cachePath) {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  }
  return output;
}
