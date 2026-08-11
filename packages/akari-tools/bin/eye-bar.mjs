#!/usr/bin/env node
// eye-bar.mjs — face_landmarks トラック（両瞳）から「犯罪者風の目線黒帯」を
// layers[].keyframes（transform: x/y/rotate/scale）として決定論生成する CLI。
//
// 契約: docs/contract-2026-08-11-analysis-vision-tracks-v0.md §4（消費者第 1 号）。
// 宣言された入力（analysis.json の tracks.face_landmarks + edit.json の cuts）だけで走る
// 決定論変換器（同一入力 → 同一出力）。新しいレンダー機構は作らない — 出力は既存の
// layers[].keyframes だけであり、帯素材（アルファ mov）も既存の layers[kind=baked] が
// そのまま扱える形で ffmpeg 生成する。
//
// 使い方:
//   node eye-bar.mjs --check
//   node eye-bar.mjs --analysis <analysis.json> --edit <edit.json> [options]
//   node eye-bar.mjs --track <face-landmarks.json> --edit <edit.json> [options] [--apply]
//
// 出力は stdout の 1 行 JSON（layers[] エントリ + 統計 + warnings）。--apply を渡すと
// edit.json.layers へ原子的に追記する（additive のみ・version は据え置き）。
//
// options（すべて既定値あり — 省略時は既定のまま）:
//   --face <n>                    対象の顔 index（既定 0。v0 は 1 人）
//   --source-id <id>              v1（複数 source）で対象 source を明示（省略時は自動一致）
//   --smoothing moving-average|one-euro|none （既定 moving-average）
//   --smooth-window <n>           moving-average の窓（サンプル数、既定 5）
//   --one-euro-mincutoff <n>      one-euro の min cutoff（既定 1.0）
//   --one-euro-beta <n>           one-euro の beta（既定 0.02）
//   --decimate interval|threshold （既定 interval）
//   --decimate-interval <sec>     interval モードの間引き間隔（既定 0.2）
//   --decimate-pos-px <n>         threshold モードの位置閾値 px（既定 4）
//   --decimate-angle-deg <n>      threshold モードの角度閾値 度（既定 2）
//   --decimate-scale-ratio <n>    threshold モードの scale 閾値 比率（既定 0.03）
//   --margin <n>                  瞳間距離に対する帯の長さ倍率（既定 1.6）
//   --thickness <n>               帯の太さ（長さに対する比率、既定 0.22）
//   --bar-width <px>              帯素材のネイティブ幅（既定 800）
//   --on-gap hold|shrink          非検出区間の扱い（既定 hold）
//   --gap-shrink-after <sec>      shrink を発動する非検出継続秒数（既定 0.5）
//   --gap-shrink-ramp <sec>       shrink の遷移秒数（既定 0.15）
//   --gap-shrink-scale <n>        shrink 時の scale（既定 0.001 — ほぼ不可視。契約上
//                                 layers[].keyframes に opacity は無いため、透明フェードの
//                                 代替として scale を使う v0 の割り切り）
//   --outlier-max-angle-jump <deg> 直前採用値からの瞬時角度ジャンプ上限（既定 45。超えた検出は
//                                 瞳の取り違え等の誤検出とみなし棄却してホールドへ委ねる。
//                                 0 で無効化）
//   --out-dir <dir>               帯素材（.mov）の出力先（既定 <project>/.akari/cache/eye-bar/）
//   --layer-id-prefix <s>         レイヤー id の接頭辞（既定 eye-bar）
//   --apply                       edit.json へ追記する（省略時は stdout の JSON のみ）
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { buildEyeBarGroups } from "../src/eye-bar/build-layer.mjs";
import { generateBarAsset } from "../src/eye-bar/bar-asset.mjs";
import { appendLayersAdditive, loadEditJson } from "../src/eye-bar/edit-apply.mjs";
import { resolveTargetSourceId } from "../src/eye-bar/resolve-source.mjs";
import { probeSourceDisplaySize } from "../src/eye-bar/source-probe.mjs";
import { resolveFfmpeg, resolveFfprobe } from "../../media-bin/src/index.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const validateEditScript = resolve(scriptDir, "..", "..", "schemas", "bin", "validate-edit.mjs");

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function summarize(value, fallback) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 500) : fallback;
}

function checkAvailability() {
  for (const [label, resolver] of [["ffmpeg", resolveFfmpeg], ["ffprobe", resolveFfprobe]]) {
    try {
      resolver();
    } catch (error) {
      return { available: false, reason: `${label}: ${summarize(error?.message, "解決できません")}` };
    }
  }
  return { available: true };
}

function parseArguments(argv) {
  const result = {
    check: false,
    analysis: null,
    track: null,
    edit: null,
    face: 0,
    sourceId: null,
    smoothing: "moving-average",
    smoothWindow: 5,
    oneEuroMinCutoff: 1.0,
    oneEuroBeta: 0.02,
    decimateMode: "interval",
    decimateInterval: 0.2,
    decimatePosPx: 4,
    decimateAngleDeg: 2,
    decimateScaleRatio: 0.03,
    margin: 1.6,
    thickness: 0.22,
    barWidth: 800,
    onGap: "hold",
    gapShrinkAfter: 0.5,
    gapShrinkRamp: 0.15,
    gapShrinkScale: 0.001,
    outlierMaxAngleJump: 45,
    outDir: null,
    layerIdPrefix: "eye-bar",
    apply: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--check") {
      result.check = true;
      continue;
    }
    if (arg === "--apply") {
      result.apply = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${arg} の値がありません`);
    i += 1;
    switch (arg) {
      case "--analysis": result.analysis = resolve(value); break;
      case "--track": result.track = resolve(value); break;
      case "--edit": result.edit = resolve(value); break;
      case "--face": result.face = Number(value); break;
      case "--source-id": result.sourceId = value; break;
      case "--smoothing": result.smoothing = value; break;
      case "--smooth-window": result.smoothWindow = Number(value); break;
      case "--one-euro-mincutoff": result.oneEuroMinCutoff = Number(value); break;
      case "--one-euro-beta": result.oneEuroBeta = Number(value); break;
      case "--decimate": result.decimateMode = value; break;
      case "--decimate-interval": result.decimateInterval = Number(value); break;
      case "--decimate-pos-px": result.decimatePosPx = Number(value); break;
      case "--decimate-angle-deg": result.decimateAngleDeg = Number(value); break;
      case "--decimate-scale-ratio": result.decimateScaleRatio = Number(value); break;
      case "--margin": result.margin = Number(value); break;
      case "--thickness": result.thickness = Number(value); break;
      case "--bar-width": result.barWidth = Number(value); break;
      case "--on-gap": result.onGap = value; break;
      case "--gap-shrink-after": result.gapShrinkAfter = Number(value); break;
      case "--gap-shrink-ramp": result.gapShrinkRamp = Number(value); break;
      case "--gap-shrink-scale": result.gapShrinkScale = Number(value); break;
      case "--outlier-max-angle-jump": result.outlierMaxAngleJump = Number(value); break;
      case "--out-dir": result.outDir = resolve(value); break;
      case "--layer-id-prefix": result.layerIdPrefix = value; break;
      default: throw new Error(`不明な引数です: ${arg}`);
    }
  }
  return result;
}

function readAnalysisTrack(options) {
  if (options.track) {
    return { trackPath: options.track, analysisPath: null };
  }
  if (!options.analysis) {
    throw new Error("--analysis または --track のいずれかが必要です");
  }
  if (!existsSync(options.analysis)) throw new Error(`analysis.json が見つかりません: ${options.analysis}`);
  const analysis = JSON.parse(readFileSync(options.analysis, "utf8"));
  const pointer = analysis?.tracks?.face_landmarks;
  if (!pointer?.path) {
    throw new Error("analysis.json の tracks.face_landmarks が未生成です（vision-tracks.mjs --kinds face を先に実行してください）");
  }
  const trackPath = isAbsolute(pointer.path) ? pointer.path : resolve(dirname(options.analysis), pointer.path);
  return { trackPath, analysisPath: options.analysis };
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

  const availability = checkAvailability();
  if (options.check) {
    printJson(availability);
    return;
  }
  if (!availability.available) {
    printJson({ ok: false, ...availability });
    process.exitCode = 1;
    return;
  }
  if (!options.edit) {
    printJson({ ok: false, reason: "--edit が必要です" });
    process.exitCode = 2;
    return;
  }
  if (!existsSync(options.edit)) {
    printJson({ ok: false, reason: `edit.json が見つかりません: ${options.edit}` });
    process.exitCode = 1;
    return;
  }

  try {
    const { trackPath } = readAnalysisTrack(options);
    if (!existsSync(trackPath)) throw new Error(`face-landmarks トラックが見つかりません: ${trackPath}`);
    const track = JSON.parse(readFileSync(trackPath, "utf8"));
    const edit = loadEditJson(options.edit);

    const sourceResolution = resolveTargetSourceId(trackPath, track, options.edit, edit, options.sourceId);
    if (!sourceResolution.ok) {
      printJson({ ok: false, reason: sourceResolution.reason });
      process.exitCode = 1;
      return;
    }
    if (sourceResolution.warning) process.stderr.write(`${sourceResolution.warning}\n`);

    const projectRoot = dirname(options.edit);
    const trackSourceAbs = resolve(dirname(trackPath), track?.source?.path ?? "");
    const sizeProbe = probeSourceDisplaySize(trackSourceAbs);
    if (!sizeProbe.ok) {
      printJson({ ok: false, reason: `ソース動画の寸法を取得できません（${trackSourceAbs}）: ${sizeProbe.reason}` });
      process.exitCode = 1;
      return;
    }

    const canvasWidth = Number(edit?.output?.width);
    const canvasHeight = Number(edit?.output?.height);
    const fps = Number(edit?.output?.fps) || 30;
    if (!(canvasWidth > 0) || !(canvasHeight > 0)) {
      printJson({ ok: false, reason: "edit.json の output.width/height が不正です" });
      process.exitCode = 1;
      return;
    }

    const built = buildEyeBarGroups({
      track,
      cuts: edit.cuts,
      canvasWidth,
      canvasHeight,
      sourceDisplayWidth: sizeProbe.width,
      sourceDisplayHeight: sizeProbe.height,
      sourceId: sourceResolution.sourceId,
      faceIndex: options.face,
      smoothing: options.smoothing === "one-euro"
        ? { method: "one-euro", oneEuro: { minCutoff: options.oneEuroMinCutoff, beta: options.oneEuroBeta, dCutoff: 1.0 } }
        : { method: options.smoothing, window: options.smoothWindow },
      decimate: options.decimateMode === "threshold"
        ? { mode: "threshold", threshold: { posPx: options.decimatePosPx, angleDeg: options.decimateAngleDeg, scaleRatio: options.decimateScaleRatio } }
        : { mode: "interval", intervalSeconds: options.decimateInterval },
      marginMultiplier: options.margin,
      thicknessRatio: options.thickness,
      nativeBarWidthPx: options.barWidth,
      onGap: options.onGap,
      gapShrinkAfterSeconds: options.gapShrinkAfter,
      gapShrinkRampSeconds: options.gapShrinkRamp,
      gapShrinkScale: options.gapShrinkScale,
      outlierMaxAngleJumpDeg: options.outlierMaxAngleJump,
      layerIdPrefix: options.layerIdPrefix,
    });

    if (!built.ok) {
      printJson(built);
      process.exitCode = 1;
      return;
    }

    const outDir = options.outDir ?? join(projectRoot, ".akari", "cache", "eye-bar");
    mkdirSync(outDir, { recursive: true });
    const assetPath = join(outDir, `${options.layerIdPrefix}-face${options.face}.mov`);
    const assetDuration = built.maxLayerDuration + 1; // 安全マージン（trim= は入力を伸ばさないため）
    const assetResult = generateBarAsset({
      outPath: assetPath,
      widthPx: built.nativeBarWidthPx,
      heightPx: built.nativeBarHeightPx,
      durationSeconds: assetDuration,
      fps,
    });
    if (!assetResult.ok) {
      printJson({ ok: false, reason: `帯素材の生成に失敗しました: ${assetResult.reason}`, args: assetResult.args });
      process.exitCode = 1;
      return;
    }

    const relSrc = relative(projectRoot, assetPath).split(sep).join("/");
    const layers = built.layers.map(({ _sourceRunCount, ...layer }) => ({
      ...layer,
      src: relSrc,
      preset: "eye-bar-v0",
      params: { face: options.face, margin: options.margin, thickness: options.thickness },
    }));

    const output = {
      ok: true,
      layers,
      warnings: built.warnings,
      stats: {
        detectedFrameCount: built.detectedFrameCount,
        totalFrameCount: built.totalFrameCount,
        rejectedOutlierCount: built.rejectedOutlierCount,
        groupCount: layers.length,
        asset: { path: assetPath, width: assetResult.width, height: assetResult.height, duration: assetResult.duration },
      },
    };

    if (options.apply) {
      const applied = appendLayersAdditive(options.edit, layers);
      if (!applied.ok) {
        printJson({ ok: false, reason: applied.reason });
        process.exitCode = 1;
        return;
      }
      const validation = spawnSync(process.execPath, [validateEditScript, options.edit], { encoding: "utf8" });
      output.applied = { addedIds: applied.addedIds };
      output.validate = {
        ok: validation.status === 0,
        output: summarize(validation.stdout || validation.stderr, ""),
      };
      if (validation.status !== 0) {
        printJson(output);
        process.exitCode = 1;
        return;
      }
    }

    printJson(output);
  } catch (error) {
    printJson({ ok: false, reason: summarize(error?.message, "eye-bar 生成に失敗しました") });
    process.exitCode = 1;
  }
}

await main();
