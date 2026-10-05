import { spawnSync } from "node:child_process";
import { resolveFfprobe } from "../../../media-bin/src/index.mjs";
import { ExecutionError, isFiniteNumber, isPositiveNumber, messageOf } from "./shared.mjs";

export function probeMediaAudio(sourcePath, configuredCommand) {
  let command;
  try {
    command = configuredCommand ?? process.env.FFPROBE ?? resolveFfprobe();
  } catch (error) {
    return {
      hasAudio: null,
      containerDuration: null,
      reason: `audio stream detection unavailable: ${messageOf(error)}`,
    };
  }
  const result = spawnSync(
    command,
    [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "format=duration:stream=index,duration",
      "-of",
      "json",
      sourcePath,
    ],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.error) {
    return {
      hasAudio: null,
      containerDuration: null,
      reason: `audio stream detection unavailable: ${messageOf(result.error)}`,
    };
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim().split("\n").at(-1);
    return {
      hasAudio: null,
      containerDuration: null,
      reason: `audio stream detection unavailable: ${detail || `ffprobe exited with status ${result.status}`}`,
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(String(result.stdout ?? ""));
  } catch (error) {
    return {
      hasAudio: null,
      duration: null,
      containerDuration: null,
      reason: `audio stream detection unavailable: invalid ffprobe JSON (${messageOf(error)})`,
    };
  }
  // コンテナ実尺は音声ストリームの有無に関わらず取れる（音声なし映像でも format.duration は出る）。
  // media.source-range はこちらを基準にする。
  const containerDurationValue = Number(parsed?.format?.duration);
  const container = isPositiveNumber(containerDurationValue)
    ? { containerDuration: containerDurationValue }
    : { containerDuration: null };
  const stream = Array.isArray(parsed?.streams) ? parsed.streams[0] : undefined;
  if (!stream) {
    return { hasAudio: false, reason: "source has no audio stream", ...container };
  }
  const duration = Number(stream.duration);
  return {
    hasAudio: true,
    duration: isPositiveNumber(duration) ? duration : null,
    reason: isPositiveNumber(duration) ? null : "audio stream duration is unavailable",
    ...container,
  };
}

export function probeVideoDimensions(filePath, command) {
  const result = spawnSync(command, [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-of", "json",
    filePath,
  ], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) return null;
  let parsed;
  try {
    parsed = JSON.parse(String(result.stdout ?? ""));
  } catch {
    return null;
  }
  const stream = Array.isArray(parsed?.streams) ? parsed.streams[0] : undefined;
  const width = Number(stream?.width);
  const height = Number(stream?.height);
  if (!isPositiveNumber(width) || !isPositiveNumber(height)) return null;
  return { width, height };
}

export function probeProxyGop(filePath, command) {
  const result = spawnSync(command, [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "packet=pts_time,flags:format=duration",
    "-of", "csv=p=0",
    filePath,
  ], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) return undefined;
  const keyframes = [];
  let duration;
  for (const line of String(result.stdout ?? "").split(/\r?\n/u)) {
    if (line.includes(",")) {
      const [ptsTime, flags] = line.split(",", 2);
      const pts = Number.parseFloat(ptsTime);
      if (flags.includes("K") && Number.isFinite(pts)) keyframes.push(pts);
    } else if (line.length > 0) {
      duration = Number.parseFloat(line);
    }
  }
  if (keyframes.length < 1 || !isFiniteNumber(duration)) return undefined;
  keyframes.sort((left, right) => left - right);
  let maximum = Math.max(0, duration - keyframes.at(-1));
  for (let index = 1; index < keyframes.length; index += 1) {
    maximum = Math.max(maximum, keyframes[index] - keyframes[index - 1]);
  }
  return Number.isFinite(maximum) ? maximum : undefined;
}

function probeDuration(sourcePath, configuredCommand) {
  const command = configuredCommand ?? process.env.FFPROBE ?? resolveFfprobe();
  const result = runCommand(command, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    sourcePath,
  ]);
  const duration = Number(result.stdout.trim());
  if (!isPositiveNumber(duration)) {
    throw new ExecutionError("ffprobe did not return a positive source duration");
  }
  return duration;
}

export async function probeAudioDuration(filePath, configuredCommand) {
  let command;
  try {
    command = configuredCommand ?? process.env.FFPROBE ?? resolveFfprobe();
  } catch (error) {
    return { duration: null, reason: messageOf(error) };
  }
  const result = spawnSync(
    command,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.error) return { duration: null, reason: messageOf(result.error) };
  if (result.status !== 0) {
    const detail = String(result.stderr ?? result.stdout ?? "").trim().split("\n").at(-1);
    return {
      duration: null,
      reason: detail || `ffprobe exited with status ${result.status}`,
    };
  }
  const duration = Number(String(result.stdout ?? "").trim());
  if (!isPositiveNumber(duration)) {
    return { duration: null, reason: "ffprobe did not return a positive duration" };
  }
  return { duration, reason: null };
}

export function runCommand(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) {
    throw new ExecutionError(`${command} failed to start: ${messageOf(result.error)}`);
  }
  if (result.status !== 0) {
    const detail = String(result.stderr ?? result.stdout ?? "").trim().split("\n").at(-1);
    throw new ExecutionError(
      `${command} exited with status ${result.status}${detail ? `: ${detail}` : ""}`,
    );
  }
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export function parseSilenceIntervals(stderr) {
  const intervals = [];
  let pendingStart = null;
  for (const line of stderr.split(/\r?\n/)) {
    const startMatch = line.match(/silence_start:\s*(-?\d+(?:\.\d+)?)/);
    if (startMatch) pendingStart = Number(startMatch[1]);
    const endMatch = line.match(
      /silence_end:\s*(-?\d+(?:\.\d+)?)\s*\|\s*silence_duration:\s*(\d+(?:\.\d+)?)/,
    );
    if (endMatch) {
      const end = Number(endMatch[1]);
      const duration = Number(endMatch[2]);
      intervals.push({ start: pendingStart ?? Math.max(0, end - duration), end, duration });
      pendingStart = null;
    }
  }
  return intervals;
}

export function parseVolumeLevels(stderr) {
  const mean = stderr.match(/mean_volume:\s*(-?(?:inf|\d+(?:\.\d+)?))\s*dB/i);
  const max = stderr.match(/max_volume:\s*(-?(?:inf|\d+(?:\.\d+)?))\s*dB/i);
  return {
    mean: parseDb(mean?.[1]),
    max: parseDb(max?.[1]),
  };
}

function parseDb(value) {
  if (value === undefined) return null;
  if (value.toLowerCase() === "-inf") return -Infinity;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
