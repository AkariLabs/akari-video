import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { resolveFfmpeg, resolveFfprobe } from "../../../media-bin/src/index.mjs";

function probeDuration(path, ffprobeCommand) {
  const result = spawnSync(ffprobeCommand, [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path,
  ], { encoding: "utf8" });
  const duration = Number(result.stdout?.trim());
  if (result.error || result.status !== 0 || !(duration > 0)) {
    throw new Error(`source の長さを取得できません: ${path}: ${String(result.stderr || result.error?.message).trim()}`);
  }
  return duration;
}

function atempoSteps(speed) {
  const values = [];
  let remaining = speed;
  while (remaining > 100) { values.push(100); remaining /= 100; }
  while (remaining < 0.5) { values.push(0.5); remaining /= 0.5; }
  if (Math.abs(remaining - 1) > 1e-9) values.push(remaining);
  return values.map((value) => `atempo=${Number(value.toFixed(9))}`);
}

export function loadProjectTimeline(projectPath, { ffprobeCommand } = {}) {
  const projectRoot = resolve(projectPath);
  const editPath = join(projectRoot, "edit.json");
  const edit = JSON.parse(readFileSync(editPath, "utf8"));
  const fps = Number(edit?.output?.fps);
  const width = Number(edit?.output?.width);
  const height = Number(edit?.output?.height);
  if (!(fps > 0 && width > 0 && height > 0)) throw new Error("edit.json output の width/height/fps が不正です");
  const sources = new Map();
  if (Array.isArray(edit.sources)) {
    for (const source of edit.sources) {
      if (typeof source?.id !== "string" || typeof source?.path !== "string") throw new Error("sources[] が不正です");
      sources.set(source.id, resolve(dirname(editPath), source.path));
    }
  } else if (typeof edit?.source?.path === "string") {
    sources.set("__single__", resolve(dirname(editPath), edit.source.path));
  } else {
    throw new Error("edit.json に source / sources[] がありません");
  }
  if (sources.size === 0) throw new Error("edit.json の sources[] が空です");

  let cuts;
  if (Array.isArray(edit.cuts) && edit.cuts.length > 0) {
    cuts = edit.cuts.map((cut, index) => {
      const sourceId = Array.isArray(edit.sources) ? cut.src : "__single__";
      const path = sources.get(sourceId);
      const start = Number(cut.in);
      const end = Number(cut.out);
      const speed = Number(cut.speed ?? 1);
      if (!path) throw new Error(`cuts[${index}].src が sources[] にありません: ${sourceId}`);
      if (!(end > start && start >= 0 && speed > 0)) throw new Error(`cuts[${index}] の in/out/speed が不正です`);
      return { path, start, end, speed };
    });
  } else {
    if (sources.size !== 1) throw new Error("cuts[] が空の複数 source プロジェクトは音声 source を一意に決められません");
    const [path] = sources.values();
    cuts = [{ path, start: 0, end: probeDuration(path, ffprobeCommand ?? resolveFfprobe()), speed: 1 }];
  }
  const duration = cuts.reduce((sum, cut) => sum + (cut.end - cut.start) / cut.speed, 0);
  return { projectRoot, editPath, edit, fps, width, height, cuts, duration };
}

function buildAudioCommand(cuts, sampleRate) {
  const paths = [...new Set(cuts.map((cut) => cut.path))];
  const pathIndex = new Map(paths.map((path, index) => [path, index]));
  const uses = new Map(paths.map((path) => [path, []]));
  cuts.forEach((cut, cutIndex) => uses.get(cut.path).push(cutIndex));
  const filters = [];
  const sourceLabels = new Map();
  for (const path of paths) {
    const inputIndex = pathIndex.get(path);
    const cutIndexes = uses.get(path);
    if (cutIndexes.length === 1) {
      sourceLabels.set(cutIndexes[0], `[${inputIndex}:a:0]`);
    } else {
      const labels = cutIndexes.map((_, index) => `[src${inputIndex}_${index}]`);
      filters.push(`[${inputIndex}:a:0]asplit=${labels.length}${labels.join("")}`);
      cutIndexes.forEach((cutIndex, index) => sourceLabels.set(cutIndex, labels[index]));
    }
  }
  const segments = cuts.map((cut, index) => {
    const output = `[seg${index}]`;
    const chain = [
      `atrim=start=${cut.start}:end=${cut.end}`,
      "asetpts=PTS-STARTPTS",
      ...atempoSteps(cut.speed),
    ];
    filters.push(`${sourceLabels.get(index)}${chain.join(",")}${output}`);
    return output;
  });
  if (segments.length === 1) {
    filters.push(`${segments[0]}aresample=${sampleRate},aformat=sample_fmts=flt:channel_layouts=mono[env]`);
  } else {
    filters.push(`${segments.join("")}concat=n=${segments.length}:v=0:a=1,`
      + `aresample=${sampleRate},aformat=sample_fmts=flt:channel_layouts=mono[env]`);
  }
  return {
    inputArgs: paths.flatMap((path) => ["-i", path]),
    filter: filters.join(";"),
  };
}

export function pcmToRms(buffer, { frameCount, fps, sampleRate }) {
  const sampleCount = Math.floor(buffer.length / 4);
  const rms = [];
  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = Math.floor((frame * sampleRate) / fps);
    const end = Math.max(start + 1, Math.floor(((frame + 1) * sampleRate) / fps));
    let squares = 0;
    let count = 0;
    for (let sample = start; sample < end; sample += 1) {
      const value = sample < sampleCount ? buffer.readFloatLE(sample * 4) : 0;
      if (Number.isFinite(value)) { squares += value * value; count += 1; }
    }
    rms.push(count > 0 ? Math.sqrt(squares / count) : 0);
  }
  return rms;
}

export function extractRmsEnvelope(timeline, sampleRate, { ffmpegCommand } = {}) {
  const command = ffmpegCommand ?? resolveFfmpeg();
  const built = buildAudioCommand(timeline.cuts, sampleRate);
  const result = spawnSync(command, [
    "-v", "error", ...built.inputArgs, "-filter_complex", built.filter, "-map", "[env]",
    "-f", "f32le", "pipe:1",
  ], { encoding: null, maxBuffer: 256 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`音声エンベロープ抽出に失敗しました: ${String(result.stderr || result.error?.message).trim()}`);
  }
  const frameCount = Math.max(1, Math.round(timeline.duration * timeline.fps));
  return {
    frameCount,
    rms: pcmToRms(result.stdout, { frameCount, fps: timeline.fps, sampleRate }),
  };
}

