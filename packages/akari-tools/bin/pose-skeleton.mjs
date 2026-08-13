#!/usr/bin/env node

// body_pose_3d の 2D projection からアルファ付きスケルトンを事前ベイクし、
// render-cut 既存の kind:"baked" layers[] へ決定論的に変換する。

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { appendLayersAdditive, loadEditJson } from "../src/eye-bar/edit-apply.mjs";
import { resolveTargetSourceId } from "../src/eye-bar/resolve-source.mjs";
import { probeSourceDisplaySize } from "../src/eye-bar/source-probe.mjs";
import { resolveFfmpeg, resolveFfprobe } from "../../media-bin/src/index.mjs";
import { bakeSkeletonClip } from "./pose-skeleton/bake.mjs";
import { buildSkeletonPlan } from "./pose-skeleton/plan.mjs";
import { parseColor } from "./pose-skeleton/skeleton.mjs";

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function summary(value, fallback) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 1000) : fallback;
}

function checkAvailability() {
  for (const [name, resolver] of [["ffmpeg", resolveFfmpeg], ["ffprobe", resolveFfprobe]]) {
    try { resolver(); } catch (error) {
      return { available: false, reason: `${name}: ${summary(error.message, "not found")}` };
    }
  }
  return { available: true };
}

function parseArguments(argv) {
  const options = {
    check: false,
    apply: false,
    analysis: null,
    edit: null,
    sourceId: null,
    strokeWidth: 4,
    color: "#00e5ff",
    jointRadius: 6,
    smoothing: 5,
    minConfidence: 0.3,
    outDir: null,
    layerIdPrefix: "pose-skeleton",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") { options.check = true; continue; }
    if (argument === "--apply") { options.apply = true; continue; }
    const value = argv[++index];
    if (value === undefined || value.startsWith("--")) throw new Error(`${argument} の値がありません`);
    if (argument === "--analysis") options.analysis = resolve(value);
    else if (argument === "--edit") options.edit = resolve(value);
    else if (argument === "--source-id") options.sourceId = value;
    else if (argument === "--stroke-width") options.strokeWidth = Number(value);
    else if (argument === "--color") options.color = parseColor(value).css;
    else if (argument === "--joint-radius") options.jointRadius = Number(value);
    else if (argument === "--smoothing") options.smoothing = Number(value);
    else if (argument === "--min-confidence") options.minConfidence = Number(value);
    else if (argument === "--out-dir") options.outDir = resolve(value);
    else if (argument === "--layer-id-prefix") options.layerIdPrefix = value;
    else throw new Error(`不明な引数です: ${argument}`);
  }
  if (!(options.strokeWidth > 0)) throw new Error("--stroke-width は 0 より大きい px 値です");
  if (!(options.jointRadius > 0)) throw new Error("--joint-radius は 0 より大きい px 値です");
  if (!Number.isInteger(options.smoothing) || options.smoothing < 1) {
    throw new Error("--smoothing は 1 以上の整数（移動平均 window、1 は平滑化なし）です");
  }
  if (!(options.minConfidence >= 0 && options.minConfidence <= 1)) {
    throw new Error("--min-confidence は 0..1 です");
  }
  return options;
}

function loadTrack(analysisPath) {
  const analysis = JSON.parse(readFileSync(analysisPath, "utf8"));
  const pointer = analysis?.tracks?.body_pose_3d;
  if (!pointer?.path) throw new Error("analysis.json に tracks.body_pose_3d がありません");
  const trackPath = isAbsolute(pointer.path) ? pointer.path : resolve(dirname(analysisPath), pointer.path);
  if (!existsSync(trackPath)) throw new Error(`body-pose-3d トラックが見つかりません: ${trackPath}`);
  const track = JSON.parse(readFileSync(trackPath, "utf8"));
  if (track?.kind !== "body-pose-3d") throw new Error("track.kind が body-pose-3d ではありません");
  return { trackPath, track };
}

async function main() {
  let options;
  try { options = parseArguments(process.argv.slice(2)); }
  catch (error) {
    printJson({ ok: false, reason: summary(error.message, "引数が不正です") });
    process.exitCode = 2;
    return;
  }
  if (options.check) { printJson(checkAvailability()); return; }
  if (!options.analysis || !options.edit) {
    printJson({ ok: false, reason: "--analysis と --edit が必要です" });
    process.exitCode = 2;
    return;
  }
  if (!existsSync(options.analysis) || !existsSync(options.edit)) {
    printJson({ ok: false, reason: "analysis.json または edit.json が見つかりません" });
    process.exitCode = 1;
    return;
  }
  const available = checkAvailability();
  if (!available.available) { printJson({ ok: false, ...available }); process.exitCode = 1; return; }

  try {
    const { trackPath, track } = loadTrack(options.analysis);
    const edit = loadEditJson(options.edit);
    const sourceResolution = resolveTargetSourceId(
      trackPath, track, options.edit, edit, options.sourceId,
    );
    if (!sourceResolution.ok) throw new Error(sourceResolution.reason);
    const sourcePath = resolve(dirname(trackPath), track.source.path);
    const probed = probeSourceDisplaySize(sourcePath);
    if (!probed.ok) throw new Error(`source の寸法を取得できません: ${probed.reason}`);
    const canvasWidth = Number(edit?.output?.width);
    const canvasHeight = Number(edit?.output?.height);
    const fps = Number(edit?.output?.fps || 30);
    if (!(canvasWidth > 0 && canvasHeight > 0 && fps > 0)) {
      throw new Error("edit.json output の width/height/fps が不正です");
    }
    const projectRoot = dirname(options.edit);
    const outDir = options.outDir ?? join(projectRoot, ".akari", "cache", "pose-skeleton");
    mkdirSync(outDir, { recursive: true });
    const plan = buildSkeletonPlan({
      track,
      cuts: edit.cuts,
      sourceId: sourceResolution.sourceId,
      sourceWidth: probed.width,
      sourceHeight: probed.height,
      canvasWidth,
      canvasHeight,
      fps,
      strokeWidth: options.strokeWidth,
      color: options.color,
      jointRadius: options.jointRadius,
      smoothing: options.smoothing,
      minConfidence: options.minConfidence,
      layerIdPrefix: options.layerIdPrefix,
      outPathFor: (index) => join(outDir, `${options.layerIdPrefix}-${index}.mov`),
    });
    if (!plan.ok) { printJson(plan); process.exitCode = 1; return; }

    const assets = [];
    for (let index = 0; index < plan.jobs.length; index += 1) {
      const baked = bakeSkeletonClip(plan.jobs[index]);
      if (!baked.ok) throw new Error(`clip ${index} のベイクに失敗しました: ${baked.reason}`);
      plan.layers[index].src = relative(projectRoot, baked.outPath).split(sep).join("/");
      assets.push({
        path: baked.outPath,
        width: plan.jobs[index].cropWidth,
        height: plan.jobs[index].cropHeight,
        frames: baked.frameCount,
      });
    }
    const output = {
      ok: true,
      layers: plan.layers,
      warnings: [...(sourceResolution.warning ? [sourceResolution.warning] : []), ...plan.warnings],
      stats: { clips: assets.length, assets },
    };
    if (options.apply) {
      const applied = appendLayersAdditive(options.edit, plan.layers);
      if (!applied.ok) throw new Error(applied.reason);
      output.applied = { addedIds: applied.addedIds };
    }
    printJson(output);
  } catch (error) {
    printJson({ ok: false, reason: summary(error.message, "pose-skeleton 生成に失敗しました") });
    process.exitCode = 1;
  }
}

await main();
