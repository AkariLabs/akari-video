import { closeSync, mkdirSync, openSync, unlinkSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";

import { resolveFfmpeg } from "../../../media-bin/src/index.mjs";
import { renderMaskFrame } from "./mask.mjs";
import { interpolateScalar, samplePointAt } from "./motion.mjs";

function even(value) {
  return Math.max(2, Math.ceil(value / 2) * 2);
}

function ff(value) {
  return Number(value.toFixed(8)).toString();
}

function escapedIf(condition, yes, no) {
  return `if(${condition}\\,${yes}\\,${no})`;
}

/** Piecewise-linear ffmpeg expression over source-local t. */
export function piecewiseExpression(points, field, sourceStart) {
  if (points.length === 0) return "0";
  if (points.length === 1) return ff(points[0][field]);
  let expression = ff(points[points.length - 1][field]);
  for (let index = points.length - 2; index >= 0; index -= 1) {
    const a = points[index];
    const b = points[index + 1];
    const aT = a.t - sourceStart;
    const bT = b.t - sourceStart;
    const ratio = bT === aT ? "0" : `(t-${ff(aT)})/${ff(bT - aT)}`;
    const interpolated = `${ff(a[field])}+(${ff(b[field] - a[field])})*${ratio}`;
    expression = escapedIf(`lt(t\\,${ff(bT)})`, interpolated, expression);
  }
  return expression;
}

export function resolveBlockPixels(spec, faceWidthPx) {
  const raw = String(spec ?? "0.08").trim().toLowerCase();
  if (raw.endsWith("px")) {
    const px = Number(raw.slice(0, -2));
    if (!(px >= 2)) throw new Error("--block-size の px 指定は 2px 以上です");
    return Math.round(px);
  }
  const ratio = Number(raw);
  if (!(ratio > 0 && ratio <= 1)) throw new Error("--block-size の顔幅比は 0 より大きく 1 以下です（または 12px の形式）");
  return Math.max(2, Math.round(faceWidthPx * ratio));
}

function writeMaskFile(path, job, fps) {
  const frameCount = Math.max(1, Math.ceil(job.duration * fps));
  const fd = openSync(path, "w");
  try {
    for (let frame = 0; frame < frameCount; frame += 1) {
      const localT = Math.min(job.duration, frame / fps);
      const sourceT = job.srcStart + localT * job.speed;
      const point = samplePointAt(job.points, sourceT);
      const centerX = interpolateScalar(job.anchors, sourceT, "centerXPx");
      const centerY = interpolateScalar(job.anchors, sourceT, "centerYPx");
      const left = centerX - job.cropWidth / 2;
      const top = centerY - job.cropHeight / 2;
      const polygon = point.polygon.map(([x, y]) => [
        x * job.sourceWidth - left,
        y * job.sourceHeight - top,
      ]);
      const mask = renderMaskFrame({
        width: job.cropWidth,
        height: job.cropHeight,
        polygon,
        strength: job.strength,
        // Feathering is applied once by ffmpeg below. Keeping the generated raw mask hard avoids
        // six full-frame JavaScript blur passes per output frame on real footage.
        feather: 0,
      });
      writeSync(fd, mask);
    }
  } finally {
    closeSync(fd);
  }
  return frameCount;
}

export function bakeMosaicClip(job, { ffmpegCommand } = {}) {
  const ffmpeg = ffmpegCommand ?? resolveFfmpeg();
  mkdirSync(dirname(job.outPath), { recursive: true });
  const maskPath = `${job.outPath}.mask.gray`;
  const frameCount = writeMaskFile(maskPath, job, job.fps);
  const centerX = piecewiseExpression(job.anchors, "centerXPx", job.srcStart);
  const centerY = piecewiseExpression(job.anchors, "centerYPx", job.srcStart);
  const cropX = `max(0\\,min(iw-${job.cropWidth}\\,${centerX}-${job.cropWidth / 2}))`;
  const cropY = `max(0\\,min(ih-${job.cropHeight}\\,${centerY}-${job.cropHeight / 2}))`;
  const downWidth = even(Math.max(2, job.cropWidth / job.blockPixels));
  const downHeight = even(Math.max(2, job.cropHeight / job.blockPixels));
  const filter = [
    `[0:v]trim=duration=${ff(job.sourceDuration)},setpts=PTS-STARTPTS,`
      + `crop=${job.cropWidth}:${job.cropHeight}:x='${cropX}':y='${cropY}',`
      + `setpts=PTS/${ff(job.speed)},fps=${ff(job.fps)}[small]`,
    `[small]scale=${downWidth}:${downHeight}:flags=area,`
      + `scale=${job.cropWidth}:${job.cropHeight}:flags=neighbor[pixelated]`,
    `[pixelated]format=yuva444p10le[color]`,
    `[1:v]trim=duration=${ff(job.duration)},setpts=PTS-STARTPTS,format=gray`
      + `${job.feather > 0 ? `,gblur=sigma=${ff(job.feather)}:steps=3` : ""}[alpha]`,
    `[color][alpha]alphamerge[out]`,
  ].join(";");
  const args = [
    "-y", "-v", "error",
    "-ss", ff(job.srcStart), "-i", job.sourcePath,
    "-f", "rawvideo", "-pixel_format", "gray", "-video_size", `${job.cropWidth}x${job.cropHeight}`,
    "-framerate", ff(job.fps), "-i", maskPath,
    "-filter_complex", filter, "-map", "[out]", "-frames:v", String(frameCount),
    "-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuva444p10le",
    "-alpha_bits", "16", "-vendor", "apl0", "-an", job.outPath,
  ];
  let result;
  try {
    result = spawnSync(ffmpeg, args, { encoding: "utf8" });
  } finally {
    try { unlinkSync(maskPath); } catch {}
  }
  if (result.error || result.status !== 0) {
    return {
      ok: false,
      reason: String(result.stderr ?? result.error?.message ?? `ffmpeg exited ${result.status}`).slice(0, 4000),
      args,
    };
  }
  return { ok: true, outPath: job.outPath, frameCount, blockPixels: job.blockPixels, args };
}

export { even };
