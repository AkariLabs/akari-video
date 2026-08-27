import { spawn } from "node:child_process";

export function ffprobeTimeoutMs(frames) {
  return Math.max(120_000, Number(frames) * 100);
}

export async function verifyEncodedVideo({ command, path, frames, fps, width, height }) {
  const raw = await run(command, [
    "-v", "error", "-count_frames",
    "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,pix_fmt,r_frame_rate,nb_read_frames,duration",
    "-of", "json", path,
  ], ffprobeTimeoutMs(frames));
  const parsed = JSON.parse(raw);
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
