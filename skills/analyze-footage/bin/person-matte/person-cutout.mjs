#!/usr/bin/env node

// person-cutout.mjs — v2 edit.json の cut から人物マットと最前面 track を一括生成する。
//
// stdout は常に 1 行 JSON。重い判断を持たない決定論的 CLI とし、外部 npm 依存は使わない。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { resolveFfmpeg } from "../../../../packages/media-bin/src/index.mjs";

const require = createRequire(import.meta.url);
const { readEditV2 } = require("../../../../packages/edit-store/lib/index.js");

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const personMatteScript = path.join(scriptDir, "person-matte.mjs");
const validateEditScript = path.resolve(scriptDir, "../../../../packages/schemas/bin/validate-edit.mjs");

const QUALITIES = ["fast", "balanced", "accurate", "best"];
const MODELS = ["mobilenetv3", "resnet50"];
const DEFAULT_QUALITY = "balanced";
const PERSON_TRACK_ID = "person-cutout";
const MATTE_PATH_PATTERN = /^assets\/matte\/person-\d+\.webm$/u;

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function summarize(value, fallback) {
  const text = String(value ?? "").replace(/\s+/gu, " ").trim();
  return text ? text.slice(0, 1000) : fallback;
}

function parseCutIndices(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("--cut には 0 始まりの index が必要です");
  }
  const parts = value.split(",");
  if (parts.some((part) => !/^(0|[1-9]\d*)$/u.test(part))) {
    throw new Error("--cut は 0 以上の整数（複数はカンマ区切り）です");
  }
  return [...new Set(parts.map(Number))];
}

function parseArguments(argv) {
  const options = {
    project: null,
    cuts: null,
    quality: DEFAULT_QUALITY,
    model: "mobilenetv3",
    modelExplicit: false,
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} の値がありません`);
    index += 1;
    switch (argument) {
      case "--project":
        options.project = path.resolve(value);
        break;
      case "--cut":
        options.cuts = parseCutIndices(value);
        break;
      case "--quality":
        options.quality = value;
        break;
      case "--model":
        options.model = value;
        options.modelExplicit = true;
        break;
      default:
        throw new Error(`不明な引数です: ${argument}`);
    }
  }
  if (!options.project) throw new Error("--project <dir> が必要です");
  if (!options.cuts) throw new Error("--cut <index> が必要です");
  if (!QUALITIES.includes(options.quality)) {
    throw new Error(`--quality は ${QUALITIES.join(" / ")} のいずれかです`);
  }
  if (!MODELS.includes(options.model)) {
    throw new Error(`--model は ${MODELS.join(" / ")} のいずれかです`);
  }
  if (options.modelExplicit && options.quality !== "best") {
    throw new Error("--model は --quality best のときだけ指定できます");
  }
  return options;
}

function readProjectEdit(project) {
  const editPath = path.join(project, "edit.json");
  let source;
  try {
    source = fs.readFileSync(editPath, "utf8");
  } catch (error) {
    throw new Error(`edit.json を読めません: ${summarize(error?.message, editPath)}`);
  }
  let edit;
  try {
    edit = JSON.parse(source);
  } catch (error) {
    throw new Error(`edit.json が JSON ではありません: ${summarize(error?.message, "parse error")}`);
  }
  if (edit?.version !== 2) {
    throw new Error(`edit.json v${String(edit?.version ?? "不明")} は未対応です。v2 へ migrate してから実行してください`);
  }
  try {
    readEditV2(edit);
  } catch (error) {
    throw new Error(summarize(error?.message, "edit.json v2 が不正です"));
  }
  return { edit, editPath };
}

function normalizedRelative(value) {
  return value.replaceAll(path.sep, "/");
}

function isGeneratedPersonItem(item, sourcePaths) {
  if (/^person-\d+$/u.test(String(item?.id ?? ""))) return true;
  if (item?.source?.kind !== "media") return false;
  return MATTE_PATH_PATTERN.test(sourcePaths.get(item.source.src) ?? "");
}

/** v2 の visual media item を、tracks/items の宣言順で cut index へ射影する。 */
function collectCuts(edit) {
  const sourcePaths = new Map(edit.sources.map((source) => [source.id, normalizedRelative(source.path)]));
  const cuts = [];
  for (const [trackIndex, track] of edit.tracks.entries()) {
    if (track?.lane !== "visual" || !Array.isArray(track.items)) continue;
    for (const [itemIndex, item] of track.items.entries()) {
      if (item?.source?.kind !== "media" || isGeneratedPersonItem(item, sourcePaths)) continue;
      cuts.push({ trackIndex, itemIndex, track, item });
    }
  }
  return cuts;
}

function effectiveSpeed(item, fps) {
  if (item.source.speed !== undefined) return item.source.speed;
  const span = item.source.out - item.source.in;
  const normalFrames = Math.round(span * fps);
  if (Math.abs(normalFrames - item.duration) <= 1) return 1;
  return span / (item.duration / fps);
}

function resolveCutPlans(edit, indices, project) {
  const fps = edit.output.fps;
  const candidates = collectCuts(edit);
  return indices.map((cutIndex) => {
    const resolved = candidates[cutIndex];
    if (!resolved) {
      throw new Error(`cut index ${cutIndex} は範囲外です（対象 cut 数: ${candidates.length}）`);
    }
    const sourceEntry = edit.sources.find((source) => source.id === resolved.item.source.src);
    if (!sourceEntry) throw new Error(`cut ${cutIndex} の source が sources[] にありません`);
    if (resolved.item.duration <= 0) {
      throw new Error(`cut ${cutIndex} の duration は 1 フレーム以上である必要があります`);
    }
    const relativeMattePath = `assets/matte/person-${cutIndex}.webm`;
    const durationSeconds = resolved.item.duration / fps;
    return {
      cut: cutIndex,
      input: path.isAbsolute(sourceEntry.path) ? sourceEntry.path : path.resolve(project, sourceEntry.path),
      source: sourceEntry.path,
      in: resolved.item.source.in,
      out: resolved.item.source.out,
      speed: effectiveSpeed(resolved.item, fps),
      atFrames: resolved.item.at,
      durationFrames: resolved.item.duration,
      t: resolved.item.at / fps,
      duration: durationSeconds,
      fps,
      mattePath: relativeMattePath,
      matteAbsolutePath: path.resolve(project, relativeMattePath),
      sourceId: `person-cutout-${cutIndex}`,
      itemId: `person-${cutIndex}`,
      layer: {
        id: `person-${cutIndex}`,
        t: resolved.item.at / fps,
        duration: durationSeconds,
        kind: "video",
        src: relativeMattePath,
      },
      item: {
        id: `person-${cutIndex}`,
        at: resolved.item.at,
        duration: resolved.item.duration,
        source: {
          kind: "media",
          src: `person-cutout-${cutIndex}`,
          in: 0,
          out: durationSeconds,
        },
      },
    };
  });
}

function buildPatchedEdit(edit, plans) {
  const next = structuredClone(edit);
  const beforeTracks = JSON.stringify(next.tracks);
  const actions = [];

  for (const plan of plans) {
    const sourceIndex = next.sources.findIndex((source) => source.id === plan.sourceId
      || normalizedRelative(source.path) === plan.mattePath);
    const source = { id: plan.sourceId, path: plan.mattePath };
    if (sourceIndex >= 0) next.sources[sourceIndex] = source;
    else next.sources.push(source);

    let existed = false;
    for (const track of next.tracks) {
      if (!Array.isArray(track.items)) continue;
      const retained = [];
      for (const item of track.items) {
        if (item.id === plan.itemId) existed = true;
        else retained.push(item);
      }
      track.items = retained;
    }
    actions.push({ cut: plan.cut, action: existed ? "updated" : "added", ...plan.layer });
  }

  const personIndex = next.tracks.findIndex((track) => track.id === PERSON_TRACK_ID);
  const personTrack = personIndex >= 0
    ? next.tracks.splice(personIndex, 1)[0]
    : { id: PERSON_TRACK_ID, lane: "visual", name: "人物切り抜き", items: [] };
  if (personTrack.lane !== "visual" || !Array.isArray(personTrack.items)) {
    throw new Error(`track id ${PERSON_TRACK_ID} は人物 visual track として使用できません`);
  }
  const planIds = new Set(plans.map((plan) => plan.itemId));
  personTrack.items = personTrack.items.filter((item) => !planIds.has(item.id));
  personTrack.items.push(...plans.map((plan) => plan.item));
  personTrack.items.sort((left, right) => left.at - right.at || left.id.localeCompare(right.id));
  // v2 は tracks 配列順が下→上の唯一の z 順。既存相互順を保ち、人物 track だけ最前面へ置く。
  next.tracks.push(personTrack);

  return {
    edit: next,
    actions,
    tracksChanged: beforeTracks !== JSON.stringify(next.tracks),
    trackOrder: next.tracks.map((track) => track.id),
    tracks: next.tracks.map((track) => ({
      id: track.id,
      lane: track.lane,
      ...(track.name !== undefined ? { name: track.name } : {}),
    })),
  };
}

function runChecked(command, args, label, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) {
    throw new Error(`${label} に失敗しました: ${summarize(result.stderr || result.stdout || result.error?.message, `exit ${result.status}`)}`);
  }
  return result;
}

function buildExtractionArgs(plan, temporaryPath) {
  const sourceDuration = plan.out - plan.in;
  const filter = [
    `setpts=(PTS-STARTPTS)/${plan.speed}`,
    `fps=${plan.fps}`,
    `trim=duration=${plan.duration}`,
    "setpts=PTS-STARTPTS",
  ].join(",");
  return [
    "-hide_banner", "-nostdin", "-loglevel", "error",
    "-ss", String(plan.in), "-t", String(sourceDuration), "-i", plan.input,
    "-map", "0:v:0", "-vf", filter, "-frames:v", String(plan.durationFrames),
    "-an", "-c:v", "ffv1", "-level", "3", "-pix_fmt", "bgra", "-y", temporaryPath,
  ];
}

function extractCut(plan, temporaryPath, ffmpegCommand = resolveFfmpeg()) {
  if (!fs.statSync(plan.input).isFile()) throw new Error(`素材が通常ファイルではありません: ${plan.input}`);
  runChecked(
    ffmpegCommand,
    buildExtractionArgs(plan, temporaryPath),
    `cut ${plan.cut} の速度適用済み切り出し`,
  );
}

function generateMatte(plan, options, temporaryPath) {
  extractCut(plan, temporaryPath);
  fs.mkdirSync(path.dirname(plan.matteAbsolutePath), { recursive: true });
  const args = [
    personMatteScript,
    "--input", temporaryPath,
    "--out", plan.matteAbsolutePath,
    "--quality", options.quality,
    "--fps", String(plan.fps),
  ];
  if (options.modelExplicit) args.push("--model", options.model);
  const result = runChecked(process.execPath, args, `cut ${plan.cut} の人物マット生成`);
  let measured;
  try {
    measured = JSON.parse(result.stdout);
  } catch {
    throw new Error(`person-matte の stdout が JSON ではありません: ${summarize(result.stdout, "empty")}`);
  }
  if (measured.ok !== true) throw new Error(measured.reason ?? "person-matte が ok:true を返しませんでした");
  return {
    cut: plan.cut,
    path: plan.mattePath,
    ...(measured.mask_path
      ? { mask_path: normalizedRelative(path.relative(options.project, measured.mask_path)) }
      : {}),
    frames: measured.frames,
    bytes: measured.bytes,
    width: measured.width,
    height: measured.height,
    elapsed_seconds: measured.elapsed_seconds,
    realtime_ratio: measured.realtime_ratio,
    ...(measured.vision_ms_per_frame !== undefined
      ? { vision_ms_per_frame: measured.vision_ms_per_frame }
      : {}),
    ...(measured.rvm_ms_per_frame !== undefined ? { rvm_ms_per_frame: measured.rvm_ms_per_frame } : {}),
    engine: measured.engine,
    ...(measured.model !== undefined ? { model: measured.model } : {}),
    quality: measured.person_matte?.quality ?? options.quality,
    mask_size: measured.mask_size,
    alpha_transparent_ratio: measured.alpha_transparent_ratio,
    alpha_partial_ratio: measured.alpha_partial_ratio,
    probe: measured.probe,
  };
}

function validateAndWrite(editPath, edit) {
  try {
    readEditV2(edit);
  } catch (error) {
    return { ok: false, reason: summarize(error?.message, "v2 reader validation failed") };
  }
  const temporaryPath = path.join(path.dirname(editPath), `.edit.json.person-cutout-${process.pid}-${Date.now()}.tmp`);
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(edit, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    const result = spawnSync(process.execPath, [validateEditScript, temporaryPath], {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) {
      return {
        ok: false,
        exit_code: result.status,
        reason: summarize(result.stderr || result.stdout || result.error?.message, "validate-edit failed"),
      };
    }
    fs.renameSync(temporaryPath, editPath);
    return { ok: true, exit_code: 0, output: summarize(result.stdout, "OK") };
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

async function execute(options) {
  const { edit, editPath } = readProjectEdit(options.project);
  const plans = resolveCutPlans(edit, options.cuts, options.project);
  const patched = buildPatchedEdit(edit, plans);
  if (options.dryRun) {
    return {
      ok: true,
      dry_run: true,
      mattes: plans.map((plan) => ({
        cut: plan.cut,
        path: plan.mattePath,
        source: plan.source,
        in: plan.in,
        out: plan.out,
        speed: plan.speed,
        fps: plan.fps,
      })),
      layers: patched.actions,
      tracks_changed: patched.tracksChanged,
      tracks: patched.tracks,
      track_order: patched.trackOrder,
      validate: { ok: true, skipped: true },
    };
  }

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "akari-person-cutout-"));
  const mattes = [];
  try {
    for (const plan of plans) {
      const temporaryPath = path.join(temporaryDirectory, `cut-${plan.cut}.mkv`);
      mattes.push(generateMatte(plan, options, temporaryPath));
    }
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }

  const validate = validateAndWrite(editPath, patched.edit);
  if (!validate.ok) throw new Error(`パッチ後の edit.json が不合格です（元ファイルは未変更）: ${validate.reason}`);
  return {
    ok: true,
    dry_run: false,
    mattes,
    layers: patched.actions,
    tracks_changed: patched.tracksChanged,
    tracks: patched.tracks,
    track_order: patched.trackOrder,
    validate,
  };
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    printJson({ ok: false, reason: summarize(error?.message, "引数が不正です") });
    process.exitCode = 2;
    return;
  }
  try {
    printJson(await execute(options));
  } catch (error) {
    printJson({ ok: false, reason: summarize(error?.message, "人物切り抜きの自動配線に失敗しました") });
    process.exitCode = 1;
  }
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(scriptPath) === fs.realpathSync(path.resolve(process.argv[1]));
  } catch {
    return false;
  }
}

if (isMainModule()) await main();

export {
  DEFAULT_QUALITY,
  PERSON_TRACK_ID,
  buildExtractionArgs,
  buildPatchedEdit,
  collectCuts,
  execute,
  parseArguments,
  parseCutIndices,
  resolveCutPlans,
  validateAndWrite,
};
