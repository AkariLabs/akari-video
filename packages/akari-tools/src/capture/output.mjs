import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { renderLabeledContactSheet } from "../../../render-cut/src/contact-sheet.mjs";
import { runChecked } from "../../../render-cut/src/rasterize.mjs";

export function timecodeFor(seconds, fps) {
  const wholeSeconds = Math.floor(seconds);
  let frame = Math.round((seconds - wholeSeconds) * fps);
  let normalizedSeconds = wholeSeconds;
  if (frame >= fps) {
    normalizedSeconds += Math.floor(frame / fps);
    frame %= fps;
  }
  if (normalizedSeconds === 0) return `${frame}f`;
  if (frame === 0) return `${normalizedSeconds}s`;
  return `${String(normalizedSeconds).padStart(2, "0")}s${String(frame).padStart(2, "0")}f`;
}

export async function renderSeparateFrame({ ffmpegCommand, source, output, width, height, cwd }) {
  const outputWidth = Math.max(2, Math.round((width * 720) / height / 2) * 2);
  runChecked(ffmpegCommand, [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", source,
    "-vf", `scale=${outputWidth}:720:flags=lanczos`,
    "-frames:v", "1", "-c:v", "png", "-pix_fmt", "rgb24", output,
  ], { cwd });
  return { width: outputWidth, height: 720 };
}

export async function renderLabeledContactSheetFromPngs({
  ffmpegCommand,
  frames,
  labels,
  output,
  directory,
  width,
  height,
  cwd,
}) {
  await mkdir(directory, { recursive: true });
  for (let index = 0; index < frames.length; index += 1) {
    const staged = resolve(directory, `frame-${String(index + 1).padStart(3, "0")}.png`);
    await copyFile(frames[index], staged);
  }
  const sequencePath = resolve(directory, "capture-frames.mkv");
  runChecked(ffmpegCommand, [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-framerate", "1", "-start_number", "1", "-i", resolve(directory, "frame-%03d.png"),
    "-frames:v", String(frames.length), "-c:v", "ffv1", "-pix_fmt", "rgb24", sequencePath,
  ], { cwd });
  const labeledPath = resolve(directory, "labeled-contact-sheet.png");
  await renderLabeledContactSheet({
    ffmpegCommand,
    videoPath: sequencePath,
    timestamps: frames.map((_frame, index) => index),
    labels,
    sourceWidth: width,
    sourceHeight: height,
    temporaryDirectory: resolve(directory, "shared-contact-sheet"),
    outputPath: labeledPath,
  });
  runChecked(ffmpegCommand, [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", labeledPath,
    "-frames:v", "1", "-c:v", "png", "-pix_fmt", "rgb24", output,
  ], { cwd });
  return output;
}

export async function copyFullFrame(source, output) {
  await copyFile(source, output);
}

export function reportPath(projectRoot, filePath) {
  const absolute = resolve(filePath);
  const rel = relative(resolve(projectRoot), absolute);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
    ? rel
    : absolute;
}

export async function sha256File(path) {
  if (!existsSync(path)) return null;
  const hash = createHash("sha256");
  await new Promise((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", rejectPromise);
    stream.on("end", resolvePromise);
  });
  return hash.digest("hex");
}
