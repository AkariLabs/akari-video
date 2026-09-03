import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { generateCaptionOverlays } from "../../render-cut/src/captions.mjs";
import { renderOverlaySheet } from "../../render-cut/src/rasterize.mjs";
import { resolveLutPath } from "../../render-cut/src/render-inputs.mjs";
import { readRenderEdit } from "../../render-cut/src/internal-render.mjs";
import { prepareAlphaLayers } from "../../media-bin/src/alpha-intake.mjs";
import { resolveExportSourceMode } from "../../osr-export/src/export-source-mode.mjs";
import { classifyCaptionWordMode, evaluateGpuEligibility } from "./eligibility.mjs";
import { parseThreeEntrance } from "./three-entrance.mjs";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const {
  applyCaptionStylePresets,
  collectTrackZByItemId,
  collectExcludedCaptionIds,
  filterCaptionRootByExcludedIds,
  resolveCaptionTrackZ,
  resolveRecordTrackZ,
  toAnchorCaptions,
  TEXTSTYLE_CATALOG,
} = require("../../edit-store/lib/index.js");
const FRAME_ENGINE_BUNDLE = join(PACKAGE_ROOT, "generated", "frame-engine.js");
const PAGE_RUNTIME = join(PACKAGE_ROOT, "src", "page-runtime.js");
// data-akari-slot への文言注入。legacy（render-cut rasterize）・プレビュー（overlay-runtime）と同じ
// 1 実装をページへ読み込み、静的スプライトと DOM 層の両方で source.params を適用する（issue #32）。
const SLOT_PARAMS_RUNTIME = join(PACKAGE_ROOT, "..", "overlay-runtime", "src", "slot-params.js");
const ITEM_KEYFRAMES_RUNTIME = join(PACKAGE_ROOT, "..", "overlay-runtime", "src", "keyframes.mjs");

export function buildGpuPage({
  edit,
  captions = [],
  overlays = [],
  projectRoot,
  fps = edit?.output?.fps ?? 30,
  width = edit?.output?.width ?? 1920,
  height = edit?.output?.height ?? 1080,
  duration = 0,
  captionTrackZ = null,
  lutCubeText = null,
  layerLutCubeTexts = [],
  eligibility = null,
  // 出口が読む素材（既定 original / 切り戻しは AKARI_EXPORT_SOURCE）。ページ側 config へ渡す。
  sourceMode = resolveExportSourceMode(),
  frameEngineBundle = readFileSync(FRAME_ENGINE_BUNDLE, "utf8"),
  pageRuntime = readFileSync(PAGE_RUNTIME, "utf8"),
  slotParamsRuntime = readFileSync(SLOT_PARAMS_RUNTIME, "utf8"),
  itemKeyframesRuntime = readFileSync(ITEM_KEYFRAMES_RUNTIME, "utf8"),
} = {}) {
  // 直接呼びで段が分からない場合は、暗黙字幕トラックの既定どおり最前面へ置く。
  const captionZ = Number.isInteger(captionTrackZ) && captionTrackZ >= 0
    ? captionTrackZ
    : Number.MAX_SAFE_INTEGER;
  const enabledOverlays = overlays.filter((overlay) => overlay?.enabled !== false);
  const textSlotOverlayCount = enabledOverlays.filter((overlay) => overlayTextSlotParams(overlay) !== null).length;
  const projectedEdit = {
    ...edit,
    layers: (edit.layers ?? []).map((layer, index) => layer?.kind === "filter" && layer?.filter?.type === "lut"
      ? { ...layer, filter: { ...layer.filter, cubeText: layerLutCubeTexts[index] } }
      : layer),
    overlays: enabledOverlays,
    output: { ...edit.output, width, height, fps },
  };
  const captionRoot = Array.isArray(captions) ? captions : captions?.captions ?? [];
  const defaultTextStyle = Array.isArray(captions) ? null : captions?.default_text_style ?? null;
  const captionOverlays = generateCaptionOverlays(captionRoot, edit.cuts ?? [], {
    output: { width, height },
    sourceCount: Array.isArray(edit.sources) ? edit.sources.length : 1,
    defaultTextStyle: defaultTextStyle ?? undefined,
    emphasisWords: Array.isArray(captions) ? edit.emphasis_words : captions?.emphasis_words ?? edit.emphasis_words,
  });
  const resultEligibility = eligibility ?? evaluateGpuEligibility({
    edit: projectedEdit,
    captions: captionRoot,
    defaultTextStyle,
    emphasisWords: Array.isArray(captions) ? edit.emphasis_words ?? [] : captions?.emphasis_words ?? edit.emphasis_words ?? [],
  });
  const classifications = new Map(resultEligibility.entries
    .filter((entry) => entry.kind === "overlay")
    .map((entry) => [entry.id, entry.classification]));
  const indexedOverlays = enabledOverlays.map((overlay, index) => ({ overlay, index }));
  const statics = indexedOverlays.filter(({ overlay }) => classifications.get(String(overlay.id)) === "same");
  const three = indexedOverlays.filter(({ overlay }) => classifications.get(String(overlay.id)) === "three");
  const dom = buildDomRuns(indexedOverlays, classifications, duration);
  const hasItemKeyframes = enabledOverlays.some((overlay) => Array.isArray(overlay.keyframes));
  const cueById = new Map(captionRoot.map((cue) => [String(cue.id), cue]));
  const portrait = height > width;
  const resolvedEmphasisWords = Array.isArray(captions)
    ? edit.emphasis_words ?? []
    : captions?.emphasis_words ?? edit.emphasis_words ?? [];
  const spriteManifest = {
    captions: captionOverlays.map((overlay, index) => {
      const cue = cueById.get(String(overlay.generatedFrom)) ?? {};
      const textStyle = mergeTextStyle(defaultTextStyle, cue.text_style);
      const word = classifyCaptionWordMode({
        cue,
        output: { width, height },
        inheritedTextStyle: defaultTextStyle,
        emphasisWords: resolvedEmphasisWords,
      });
      return {
        id: String(overlay.id),
        z: captionZ,
        index,
        start: Number(overlay.start),
        duration: Number(overlay.duration),
        html: overlay.html.replace(/file:[^"')]+NotoSansJP-Variable\.ttf/gu, "/caption-font.ttf"),
        vars: overlay.vars ?? {},
        // 実効フォント px は render-cut の vars（--caption-font-size = size_px × reference_height_px
        // の scale）から取る。size_px 未宣言なら vars に無いので従来の既定（縦長 = 幅 6% / 横長 = 38）。
        // page-runtime の caption 計測（emPx）と CSS の font-size が同じ実効 px を指すための単一経路。
        emPx: captionFontSizePx(overlay.vars) ?? Number(textStyle?.size_px ?? (portrait ? Math.round(width * 0.06) : 38)),
        motion: textStyle?.animation ?? null,
        wordMode: word.wordMode,
        styleId: word.effectiveStyle,
        emphasisStyles: word.emphasisStyles,
        sourceWordCount: word.wordCount,
      };
    }),
    statics: statics.map(({ overlay, index }) => ({
      id: String(overlay.id), start: Number(overlay.start ?? 0), duration: Number(overlay.duration ?? duration),
      html: overlay.html, vars: resolveOverlayVars(overlay), index,
      z: Number.isInteger(overlay.z) && overlay.z >= 0 ? overlay.z : 0,
      params: overlayTextSlotParams(overlay),
    })),
    three: three.map(({ overlay, index }) => {
      const parsed = parseThreeEntrance(overlay.html, {
        vars: overlay.vars,
        transform: overlay.transform,
        role: overlay.role,
      });
      return {
        id: String(overlay.id), start: Number(overlay.start ?? 0), duration: Number(overlay.duration ?? duration), index,
        z: Number.isInteger(overlay.z) && overlay.z >= 0 ? overlay.z : 0,
        ...(parsed.ok ? { entrance: parsed.entrance } : {}),
      };
    }),
    dom,
  };
  const overlaySheetHtml = three.length > 0
    ? renderOverlaySheet({ overlays: three.map(({ overlay }) => overlay), edit: projectedEdit, projectRoot, duration })
    : null;
  const lookDeclaration = lutCubeText === null ? null : {
    cubeText: lutCubeText,
    intensity: Number(edit?.output?.look?.intensity ?? 1),
  };
  const config = {
    edit: projectedEdit,
    fps,
    width,
    height,
    duration,
    frames: Math.round(duration * fps),
    look: lookDeclaration,
    spriteManifest,
    eligibility: resultEligibility,
    sourceMode,
  };
  const iframe = three.length > 0
    ? '<iframe id="akari-overlays" src="/overlay-sheet.html" title="AKARI 3D overlays"></iframe>'
    : "";
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=${width},height=${height}">
  <style>
    html, body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; background: #000; }
    #akari-stage { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; background: #000; }
    #akari-engine, #akari-final, #akari-overlays { position: absolute; inset: 0; width: ${width}px; height: ${height}px; border: 0; }
    #akari-engine { z-index: 0; } #akari-final { z-index: 1; } #akari-overlays { z-index: -1; visibility: hidden; }
    #akari-dom-stage { position: absolute; inset: 0; width: ${width}px; height: ${height}px; overflow: hidden; z-index: -2; background: transparent; }
    .akari-dom-host { position: absolute; inset: 0; width: ${width}px; height: ${height}px; }
    .akari-dom-root { position: absolute; inset: 0; width: ${width}px; height: ${height}px; background: transparent; }
    .akari-dom-container { position: absolute; inset: 0; visibility: hidden; pointer-events: none; transform: translate(var(--x, 0px), var(--y, 0px)) scale(var(--scale, 1)) rotate(var(--rotate, 0deg)); transform-origin: center; }
    .akari-dom-container > .scene-content { position: absolute; inset: 0; }
    .akari-dom-sentinel { position: absolute; left: 0; top: 0; width: 8px; height: 8px; z-index: 2147483647; pointer-events: none; }
  </style>
</head>
<body>
  <div id="akari-stage">
    <canvas id="akari-engine" width="${width}" height="${height}"></canvas>
    <canvas id="akari-final" width="${width}" height="${height}"></canvas>
    <div id="akari-dom-stage"></div>
    ${iframe}
  </div>
  <script>window.__AKARI_GPU_CONFIG__=${safeJson(config)};</script>
  <script>${inlineScript(frameEngineBundle)}</script>${textSlotOverlayCount > 0 ? `
  <script>${inlineScript(slotParamsRuntime)}</script>` : ""}
  ${hasItemKeyframes ? `<script>${inlineScript(itemKeyframesRuntime.replace(/\nexport \{ interpolateKeyframes \};\s*$/u, "\n"))}</script>\n  ` : ""}<script>${inlineScript(pageRuntime)}</script>
</body>
</html>
`;
  return {
    html,
    overlaySheetHtml,
    spriteManifest,
    edit: projectedEdit,
    eligibility: resultEligibility,
    manifest: {
      version: 1,
      dimensions: { width, height },
      fps,
      duration,
      layers: ["engine-canvas", "static-html-sprites", "three-canvas", "dom-layer", "caption-sprites", "caption-word-tiles"],
      captionSpriteCount: spriteManifest.captions.length,
      staticSpriteCount: spriteManifest.statics.length,
      threeSpriteCount: spriteManifest.three.length,
      domRunCount: spriteManifest.dom.length,
      domOverlayCount: spriteManifest.dom.reduce((sum, run) => sum + run.entries.length, 0),
      textSlotOverlayCount,
      lutApplication: lookDeclaration ? "engine-canvas" : "none",
      stampRow: false,
    },
    warnings: [],
  };
}

function buildDomRuns(indexedOverlays, classifications, duration) {
  const runs = [];
  let current = null;
  for (const { overlay, index } of indexedOverlays) {
    const z = Number.isInteger(overlay.z) && overlay.z >= 0 ? overlay.z : 0;
    if (classifications.get(String(overlay.id)) !== "dom") {
      current = null;
      continue;
    }
    if (current === null || current.z !== z) {
      current = { runId: `dom-${runs.length}`, index, z, entries: [] };
      runs.push(current);
    }
    current.entries.push({
      id: String(overlay.id),
      start: Number(overlay.start ?? 0),
      duration: Number(overlay.duration ?? duration),
      html: String(overlay.html ?? "").replace(/file:[^"')]+NotoSansJP-Variable\.ttf/gu, "/caption-font.ttf"),
      vars: resolveOverlayVars(overlay),
      transform: overlay.transform ?? {},
      role: overlay.role ?? null,
      params: overlayTextSlotParams(overlay),
    });
  }
  return runs;
}

/** rasterize.mjs の hasTextSlotParams と同じ判定: 空でないプレーンオブジェクトだけを params とみなす。 */
function overlayTextSlotParams(overlay) {
  const params = overlay?.params;
  return params && typeof params === "object" && !Array.isArray(params) && Object.keys(params).length > 0
    ? params
    : null;
}

function resolveOverlayVars(overlay) {
  const transform = overlay.transform ?? {};
  const background = overlay.role === "background";
  const vars = {
    "--x": background ? "0px" : `${transform.x ?? 0}px`,
    "--y": background ? "0px" : `${transform.y ?? 0}px`,
    "--scale": background ? "1" : String(transform.scale ?? 1),
    "--rotate": background ? "0deg" : `${transform.rotate ?? 0}deg`,
    ...(overlay.vars ?? {}),
  };
  if (background) Object.assign(vars, { "--x": "0px", "--y": "0px", "--scale": "1", "--rotate": "0deg" });
  return vars;
}

export async function loadAndBuildGpuPage({
  projectRoot,
  editPath = join(projectRoot, "edit.json"),
  fps,
  width,
  height,
  duration,
}) {
  const resolvedEditPath = editPath ?? join(projectRoot, "edit.json");
  const editText = await readFile(resolvedEditPath, "utf8");
  const captionsRoot = await readJsonIfPresent(join(projectRoot, "captions.json"), undefined);
  const renderEdit = readRenderEdit(editText, join(projectRoot, ".akari", "render-tmp", "gpu-page"), {
    captions: captionsRoot === undefined ? undefined : toAnchorCaptions(captionsRoot),
  });
  const projectedEdit = renderEdit.edit;
  const prepared = await prepareAlphaLayers(projectedEdit, { projectRoot });
  const trackZByItemId = collectTrackZByItemId(renderEdit.internal.tracks);
  const captions = filterCaptionRootByExcludedIds(
    applyCaptionStylePresets(captionsRoot ?? [], TEXTSTYLE_CATALOG).root,
    collectExcludedCaptionIds(prepared.edit),
  );
  const overlays = await Promise.all((prepared.edit.overlays ?? []).filter((overlay) => overlay?.enabled !== false).map(async (overlay) => ({
    ...overlay,
    z: resolveRecordTrackZ(trackZByItemId, overlay),
    html: typeof overlay.html === "string" && overlay.html.trimStart().startsWith("<")
      ? overlay.html
      : await readFile(resolve(projectRoot, overlay.html), "utf8"),
  })));
  const edit = { ...prepared.edit, overlays };
  let lutCubeText = null;
  if (typeof edit?.output?.look?.lut === "string" && edit.output.look.lut !== "") {
    lutCubeText = await readFile(resolveLutPath(projectRoot, edit.output.look.lut), "utf8");
  }
  const layerLutCubeTexts = await Promise.all((edit.layers ?? []).map(async (layer) => {
    if (layer?.kind !== "filter" || layer?.filter?.type !== "lut") return null;
    const id = layer.filter.id;
    try {
      return await readFile(resolveLutPath(projectRoot, id), "utf8");
    } catch (error) {
      throw new Error(`filter layer LUT ${id} could not be resolved: ${error instanceof Error ? error.message : String(error)}`);
    }
  }));
  const eligibility = evaluateGpuEligibility({
    edit,
    captions,
    defaultTextStyle: Array.isArray(captions) ? null : captions?.default_text_style ?? null,
    emphasisWords: Array.isArray(captions) ? edit.emphasis_words ?? [] : captions?.emphasis_words ?? edit.emphasis_words ?? [],
  });
  const page = buildGpuPage({
    edit,
    captions,
    overlays,
    projectRoot,
    fps: fps ?? edit.output.fps,
    width: width ?? edit.output.width,
    height: height ?? edit.output.height,
    duration: duration ?? inferDuration(edit),
    captionTrackZ: resolveCaptionTrackZ(renderEdit.internal.tracks),
    lutCubeText,
    layerLutCubeTexts,
    eligibility,
  });
  return { ...page, warnings: [...prepared.warnings, ...page.warnings] };
}

// render-cut captionTextStyleVars が書いた `<number>px` の --caption-font-size を数値へ戻す。
// 変数が無い / px 以外なら null（呼び出し側が従来の既定へ落とす）。
function captionFontSizePx(vars) {
  const value = vars?.["--caption-font-size"];
  if (typeof value !== "string") return null;
  const match = /^(\d+(?:\.\d+)?)px$/u.exec(value.trim());
  if (match === null) return null;
  const px = Number(match[1]);
  return Number.isFinite(px) && px > 0 ? px : null;
}

function mergeTextStyle(base, override) {
  if (!base && !override) return null;
  const animation = base?.animation || override?.animation
    ? { ...(base?.animation ?? {}), ...(override?.animation ?? {}) }
    : undefined;
  return { ...(base ?? {}), ...(override ?? {}), ...(animation ? { animation } : {}) };
}

function inferDuration(edit) {
  return (edit.cuts ?? []).reduce((total, cut) => {
    const speed = Number(cut.speed ?? 1) || 1;
    const freeze = Number(cut.freeze?.duration_sec ?? 0) || 0;
    const transition = Number(cut.transition_out?.duration ?? 0) || 0;
    return total + Math.max(0, (Number(cut.out ?? 0) - Number(cut.in ?? 0)) / speed + freeze - transition);
  }, 0);
}

async function readJsonIfPresent(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return fallback; throw error; }
}

function safeJson(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
}

function inlineScript(value) {
  return value.replace(/<\/script/giu, "<\\/script");
}
