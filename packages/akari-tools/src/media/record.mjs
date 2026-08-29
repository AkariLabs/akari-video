import { existsSync, readFileSync } from "node:fs";
import { mkdir, open, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { MEDIA_VERSION, relativeFrom, toPosix } from "./common.mjs";

export function analysisPathForTarget(target) {
  if (!target.projectRoot || !target.projectRelative) return null;
  return path.join(target.projectRoot, ".akari", "sidecars", `${target.projectRelative}.analysis`, "analysis.json");
}

export async function recordObservation({ target, kind, result, args = {}, outputs = [], range, noRecord = false }) {
  const analysisPath = analysisPathForTarget(target);
  if (noRecord || !analysisPath) return null;
  const analysisDirectory = path.dirname(analysisPath);
  await mkdir(analysisDirectory, { recursive: true });
  const lockPath = `${analysisPath}.lock`;
  const lock = await acquireLock(lockPath);
  try {
    const analysis = existsSync(analysisPath)
      ? JSON.parse(readFileSync(analysisPath, "utf8"))
      : minimalAnalysis(target, analysisDirectory);

    if (kind === "probe") {
      const { path: ignoredPath, generated_at: ignoredGeneratedAt, ...probe } = result;
      analysis.probe = probe;
    } else if (kind === "waveform") {
      const waveformJson = outputs.find((output) => output.endsWith(".json"));
      analysis.tracks ??= { speakers: [], faces: [], person_matte: null };
      analysis.tracks.waveform = {
        path: relativeFrom(analysisDirectory, waveformJson),
        tool: `akari media ${MEDIA_VERSION}`,
        generated_at: result.generated_at,
      };
    } else if (kind === "transcribe") {
      analysis.transcript = replaceTranscriptRange(analysis.transcript, result.segments, range);
    }

    analysis.observations = Array.isArray(analysis.observations) ? analysis.observations : [];
    const observation = {
      kind,
      at: result.generated_at ?? new Date().toISOString(),
      args,
      outputs: outputs.map((output) => relativeFrom(analysisDirectory, output)),
      tool: `akari media ${MEDIA_VERSION}`,
    };
    if (range) observation.range = range;
    analysis.observations.push(observation);

    const temporaryPath = `${analysisPath}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
    await writeFile(temporaryPath, `${JSON.stringify(analysis, null, 2)}\n`, "utf8");
    await rename(temporaryPath, analysisPath);
    return analysisPath;
  } finally {
    await lock.close();
    await unlink(lockPath).catch(() => {});
  }
}

async function acquireLock(lockPath) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return await open(lockPath, "wx");
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      await delay(50);
    }
  }
  throw new Error(`analysis.json の書き込みロックを取得できません: ${lockPath}`);
}

function minimalAnalysis(target, analysisDirectory) {
  return {
    version: 0,
    source: relativeFrom(analysisDirectory, target.inputPath),
    transcript: [],
    keyframes: [],
    events: [],
    tracks: { speakers: [], faces: [], person_matte: null },
  };
}

export function replaceTranscriptRange(existing, replacement, range) {
  const before = Array.isArray(existing) ? existing : [];
  if (!range) return [...replacement].sort((left, right) => left.start - right.start);
  return [
    ...before.filter((segment) => segment.end <= range.in || segment.start >= range.out),
    ...replacement,
  ].sort((left, right) => left.start - right.start);
}
