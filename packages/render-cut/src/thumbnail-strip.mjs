import { spawn } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { computeVideoRuns, resolveCutSegments } from "./cut-timeline.mjs";
import { deriveContactSheetTimestamps } from "./contact-sheet.mjs";
import { resolveDeclaredProjectInput } from "./render-inputs.mjs";

export function planThumbnailStrip({ edit, durationSeconds, fps, count }) {
  if (!(durationSeconds > 0) || !(fps > 0) || !Number.isInteger(count) || count <= 0) return [];
  const totalFrames = Math.max(1, Math.round(durationSeconds * fps));
  const base = deriveContactSheetTimestamps({
    cuts: edit?.cuts ?? [],
    overlays: [],
    durationSeconds,
    fps,
  });
  const frameIndexes = new Set();
  for (const seconds of base) {
    frameIndexes.add(toFrameIndex(seconds, fps, totalFrames));
  }
  for (let index = 0; index < count; index += 1) {
    frameIndexes.add(toFrameIndex(index / count * durationSeconds, fps, totalFrames));
  }
  const selectedFrames = thinEvenly([...frameIndexes].sort((left, right) => left - right), count);
  const runs = computeVideoRuns(resolveCutSegments(edit?.cuts ?? []), durationSeconds);
  const sources = Array.isArray(edit?.sources) ? edit.sources : [];

  return selectedFrames.map((frameIndex, index) => {
    const outputSeconds = frameIndex / fps;
    const run = runs.find((candidate) => candidate.outStart <= outputSeconds && outputSeconds < candidate.outEnd);
    if (!run || run.kind === "gap") {
      return { index, outputSeconds, source: null, sourceSeconds: null };
    }
    const declaredSource = sources.find((source) => source.id === run.cut.src);
    if (!declaredSource || typeof declaredSource.path !== "string" || declaredSource.path.length === 0) {
      return { index, outputSeconds, source: null, sourceSeconds: null };
    }
    const sourceSeconds = run.srcIn
      + (outputSeconds - run.outStart) * (run.srcOut - run.srcIn) / (run.outEnd - run.outStart);
    return {
      index,
      outputSeconds,
      source: { id: declaredSource.id, path: declaredSource.path },
      sourceSeconds,
    };
  });
}

export async function extractThumbnailStrip({
  plan,
  projectRoot,
  outDir,
  width,
  ffmpegCommand,
  concurrency = 4,
  deadlineMs = 2000,
}) {
  const entries = Array.isArray(plan) ? plan : [];
  const results = entries.map(({ index, outputSeconds }) => ({ index, outputSeconds, path: null }));
  try {
    await mkdir(outDir, { recursive: true });
  } catch {
    return results;
  }

  const deadlineAt = Date.now() + Math.max(0, deadlineMs);
  const active = new Map();
  let cursor = 0;
  const timer = setTimeout(() => {
    for (const [child, settle] of active) {
      child.kill();
      settle(null);
    }
  }, Math.max(0, deadlineMs));

  const worker = async () => {
    while (cursor < entries.length && Date.now() < deadlineAt) {
      const position = cursor;
      cursor += 1;
      const item = entries[position];
      if (!item?.source || !Number.isFinite(item.sourceSeconds)) continue;
      let inputPath;
      try {
        inputPath = resolveDeclaredProjectInput(projectRoot, item.source.path, "thumbnail source");
      } catch {
        continue;
      }
      if (Date.now() >= deadlineAt) continue;
      const outputPath = join(outDir, `${String(item.index + 1).padStart(2, "0")}.jpg`);
      const extracted = await extractFrame({
        active,
        ffmpegCommand,
        inputPath,
        outputPath,
        sourceSeconds: item.sourceSeconds,
        width,
      });
      if (extracted) results[position] = { index: item.index, outputSeconds: item.outputSeconds, path: outputPath };
    }
  };

  const workerCount = Math.min(entries.length, Math.max(1, Math.floor(concurrency) || 1));
  try {
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  } finally {
    clearTimeout(timer);
    for (const [child, settle] of active) {
      child.kill();
      settle(null);
    }
  }
  return results;
}

function toFrameIndex(seconds, fps, totalFrames) {
  return Math.min(totalFrames - 1, Math.max(0, Math.round(seconds * fps)));
}

function thinEvenly(sortedValues, max) {
  if (max <= 0 || sortedValues.length === 0) return [];
  if (sortedValues.length <= max) return sortedValues;
  if (max === 1) return [sortedValues[0]];
  const picked = new Set();
  for (let index = 0; index < max; index += 1) {
    const position = Math.round(index * (sortedValues.length - 1) / (max - 1));
    picked.add(sortedValues[position]);
  }
  return [...picked].sort((left, right) => left - right);
}

function extractFrame({ active, ffmpegCommand, inputPath, outputPath, sourceSeconds, width }) {
  return new Promise((resolvePromise) => {
    let settled = false;
    let child;
    const settle = async (exitCode) => {
      if (settled) return;
      settled = true;
      if (child) active.delete(child);
      if (exitCode !== 0) {
        resolvePromise(false);
        return;
      }
      try {
        resolvePromise((await stat(outputPath)).isFile());
      } catch {
        resolvePromise(false);
      }
    };
    try {
      child = spawn(ffmpegCommand, [
        "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
        "-ss", String(sourceSeconds), "-i", inputPath,
        "-frames:v", "1", "-vf", `scale=${width}:-2`, "-q:v", "4", outputPath,
      ], { stdio: "ignore" });
    } catch {
      resolvePromise(false);
      return;
    }
    active.set(child, settle);
    child.on("error", () => void settle(null));
    child.on("close", (code) => void settle(code));
  });
}
