import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

export function ffprobeTimeoutMs(frames) {
  return Math.max(120_000, Number(frames) * 100);
}

export async function verifyEncodedVideo({ command, path, frames, fps, width, height, codec = "h264" }) {
  if (codec === "png") return verifyPngSequence({ command, directory: path, frames, width, height });
  const parsed = await probeEncodedMedia({ command, path, frames });
  const stream = parsed.streams?.find((entry) => entry.codec_type === "video") ?? {};
  const duration = Number(parsed.format?.duration ?? stream.duration);
  const measuredFrames = Number(stream.nb_read_frames);
  const expectedDuration = frames / fps;
  const expectedCodec = codec === "prores422" ? "prores" : codec;
  const checks = {
    frames: measuredFrames === frames,
    duration: Number.isFinite(duration) && Math.abs(duration - expectedDuration) <= Math.max(0.01, 1 / fps),
    dimensions: stream.width === width && stream.height === height,
    codec: stream.codec_name === expectedCodec,
    ...(codec === "prores422" ? {
      profile: stream.profile === 3 || String(stream.profile ?? "").toLowerCase() === "hq",
      pixelFormat: stream.pix_fmt === "yuv422p10le",
    } : {}),
  };
  return { matched: Object.values(checks).every(Boolean), checks, expected: { frames, fps, width, height, duration: expectedDuration }, measured: parsed };
}

export async function verifyPngSequence({ command, directory, frames, width, height }) {
  const names = (await readdir(directory).catch(() => []))
    .filter((name) => /^frame-\d{5}\.png$/u.test(name))
    .sort();
  const first = names[0] ? await probeEncodedMedia({ command, path: join(directory, names[0]), frames: 1 }) : null;
  const last = names.length > 1 ? await probeEncodedMedia({ command, path: join(directory, names.at(-1)), frames: 1 }) : first;
  const firstVideo = first?.streams?.find((entry) => entry.codec_type === "video") ?? null;
  const lastVideo = last?.streams?.find((entry) => entry.codec_type === "video") ?? null;
  const checks = {
    frames: names.length === frames,
    firstDimensions: firstVideo?.width === width && firstVideo?.height === height,
    lastDimensions: lastVideo?.width === width && lastVideo?.height === height,
  };
  return {
    matched: Object.values(checks).every(Boolean),
    checks,
    expected: { frames, width, height },
    measured: { frameFiles: names, first, last },
  };
}

export async function verifyFinalVideo({ command, path, frames, fps, width, height, codec = "h264", requireAudio = false }) {
  const parsed = await probeEncodedMedia({ command, path, frames });
  const video = parsed.streams?.find((entry) => entry.codec_type === "video") ?? {};
  const audio = parsed.streams?.find((entry) => entry.codec_type === "audio") ?? null;
  const expectedDuration = frames / fps;
  const videoDuration = Number(video.duration ?? parsed.format?.duration);
  const audioDuration = Number(audio?.duration);
  const tolerance = 1 / fps;
  const audioFrameSize = defaultAudioFrameSize(audio?.codec_name) ?? 1024;
  const probedSampleRate = Number(audio?.sample_rate);
  const audioSampleRate = Number.isFinite(probedSampleRate) && probedSampleRate > 0 ? probedSampleRate : 48000;
  const audioPacketSeconds = audioFrameSize / audioSampleRate;
  const audioMaxDuration = expectedDuration + Math.max(tolerance, audioPacketSeconds) + 0.002;
  const checks = {
    frames: Number(video.nb_read_frames) === frames,
    duration: Number.isFinite(videoDuration) && Math.abs(videoDuration - expectedDuration) <= tolerance,
    dimensions: video.width === width && video.height === height,
    codec: video.codec_name === codec,
    audioPresence: !requireAudio || audio !== null,
    audioDuration: audio === null
      ? !requireAudio
      : Number.isFinite(audioDuration) && audioDuration <= audioMaxDuration,
  };
  return {
    matched: Object.values(checks).every(Boolean),
    checks,
    expected: {
      frames,
      fps,
      width,
      height,
      duration: expectedDuration,
      requireAudio,
      audioPacketSeconds,
      audioMaxDuration,
    },
    measured: parsed,
  };
}

function defaultAudioFrameSize(codecName) {
  return codecName === "aac" ? 1024 : null;
}

async function probeEncodedMedia({ command, path, frames }) {
  const raw = await run(command, [
    "-v", "error", "-count_frames",
    "-show_entries", "format=duration:stream=codec_type,codec_name,profile,width,height,pix_fmt,r_frame_rate,nb_read_frames,duration,sample_rate",
    "-of", "json", path,
  ], ffprobeTimeoutMs(frames));
  return JSON.parse(raw);
}

function run(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`ffprobe timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`ffprobe exited ${code}: ${stderr.trim()}`));
    });
  });
}
