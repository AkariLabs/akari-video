import { closeSync, mkdirSync, openSync, unlinkSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";

import { resolveFfmpeg } from "../../../media-bin/src/index.mjs";
import { samplePoseAt } from "./motion.mjs";
import { parseColor, renderSkeletonFrame } from "./skeleton.mjs";

function numeric(value) {
  return Number(Number(value).toFixed(8)).toString();
}

function writeRawFrames(rawPath, job) {
  const frameCount = Math.max(1, Math.ceil(job.duration * job.fps));
  const color = parseColor(job.color);
  const fd = openSync(rawPath, "w");
  try {
    for (let frame = 0; frame < frameCount; frame += 1) {
      const localT = Math.min(job.duration, frame / job.fps);
      const sourceT = Math.min(job.srcEnd, job.srcStart + localT * job.speed);
      const pose = samplePoseAt(job.points, sourceT);
      const pixels = renderSkeletonFrame({
        width: job.cropWidth,
        height: job.cropHeight,
        joints: pose.joints,
        sourceWidth: job.sourceWidth,
        sourceHeight: job.sourceHeight,
        cropLeft: job.cropLeft,
        cropTop: job.cropTop,
        strokeWidth: job.strokeWidth,
        jointRadius: job.jointRadius,
        minConfidence: job.minConfidence,
        color,
      });
      writeSync(fd, pixels);
    }
  } finally {
    closeSync(fd);
  }
  return frameCount;
}

export function bakeSkeletonClip(job, { ffmpegCommand } = {}) {
  const ffmpeg = ffmpegCommand ?? resolveFfmpeg();
  mkdirSync(dirname(job.outPath), { recursive: true });
  const rawPath = `${job.outPath}.rgba`;
  const frameCount = writeRawFrames(rawPath, job);
  const args = [
    "-y", "-v", "error",
    "-f", "rawvideo", "-pixel_format", "rgba",
    "-video_size", `${job.cropWidth}x${job.cropHeight}`,
    "-framerate", numeric(job.fps), "-i", rawPath,
    "-frames:v", String(frameCount),
    "-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuva444p10le",
    "-alpha_bits", "16", "-vendor", "apl0", "-an", job.outPath,
  ];
  let result;
  try {
    result = spawnSync(ffmpeg, args, { encoding: "utf8" });
  } finally {
    try { unlinkSync(rawPath); } catch {}
  }
  if (result.error || result.status !== 0) {
    return {
      ok: false,
      reason: String(result.stderr ?? result.error?.message ?? `ffmpeg exited ${result.status}`).slice(0, 4000),
      args,
    };
  }
  return { ok: true, outPath: job.outPath, frameCount, args };
}
