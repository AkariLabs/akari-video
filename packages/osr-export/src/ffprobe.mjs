import { spawn } from "node:child_process";

export function ffprobeTimeoutMs(frames) {
  return Math.max(120_000, Number(frames) * 100);
}

export async function verifyEncodedVideo({ command, path, frames, fps, width, height }) {
  const parsed = await probeEncodedMedia({ command, path, frames });
  const stream = parsed.streams?.find((entry) => entry.codec_type === "video") ?? {};
  const duration = Number(parsed.format?.duration ?? stream.duration);
  const measuredFrames = Number(stream.nb_read_frames);
  const expectedDuration = frames / fps;
  const checks = {
    frames: measuredFrames === frames,
    duration: Number.isFinite(duration) && Math.abs(duration - expectedDuration) <= Math.max(0.01, 1 / fps),
    dimensions: stream.width === width && stream.height === height,
    codec: stream.codec_name === "h264",
  };
  return { matched: Object.values(checks).every(Boolean), checks, expected: { frames, fps, width, height, duration: expectedDuration }, measured: parsed };
}

export async function verifyFinalVideo({ command, path, frames, fps, width, height, requireAudio = false }) {
  const parsed = await probeEncodedMedia({ command, path, frames });
  const video = parsed.streams?.find((entry) => entry.codec_type === "video") ?? {};
  const audio = parsed.streams?.find((entry) => entry.codec_type === "audio") ?? null;
  const expectedDuration = frames / fps;
  const videoDuration = Number(video.duration ?? parsed.format?.duration);
  const audioDuration = Number(audio?.duration);
  const tolerance = 1 / fps;
  const checks = {
    frames: Number(video.nb_read_frames) === frames,
    duration: Number.isFinite(videoDuration) && Math.abs(videoDuration - expectedDuration) <= tolerance,
    dimensions: video.width === width && video.height === height,
    codec: video.codec_name === "h264",
    audioPresence: !requireAudio || audio !== null,
    audioDuration: audio === null
      ? !requireAudio
      : Number.isFinite(audioDuration) && audioDuration <= expectedDuration + tolerance,
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
      audioMaxDuration: expectedDuration + tolerance,
    },
    measured: parsed,
  };
}

async function probeEncodedMedia({ command, path, frames }) {
  const raw = await run(command, [
    "-v", "error", "-count_frames",
    "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,pix_fmt,r_frame_rate,nb_read_frames,duration",
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
