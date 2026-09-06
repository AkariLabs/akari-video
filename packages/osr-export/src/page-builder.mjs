import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { generateCaptionOverlays } from "../../render-cut/src/captions.mjs";
import { renderOverlaySheet } from "../../render-cut/src/rasterize.mjs";
import { embedFragmentAssets } from "../../render-cut/src/fragment-assets.mjs";
import { resolveLutPath } from "../../render-cut/src/render-inputs.mjs";
import { readRenderEdit } from "../../render-cut/src/internal-render.mjs";
import { prepareAlphaLayers } from "../../media-bin/src/alpha-intake.mjs";
import { stampFunctionSource } from "./stamp.mjs";

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

export function buildOsrPage({
  edit,
  captions = [],
  overlays = [],
  projectRoot,
  plan = null,
  fps = edit?.output?.fps ?? 30,
  width = edit?.output?.width ?? 1920,
  height = edit?.output?.height ?? 1080,
  duration = plan?.predicted_duration_seconds ?? 0,
  captionTrackZ = null,
  stampRow = true,
  frameEngineBundle = readFileSync(FRAME_ENGINE_BUNDLE, "utf8"),
  pageRuntime = readFileSync(PAGE_RUNTIME, "utf8"),
  lutCubeText = null,
  layerLutCubeTexts = [],
  adjustLutCubeTexts = {},
} = {}) {
  // 直接呼びで段が分からない場合は、暗黙字幕トラックの既定どおり最前面へ置く。
  const captionZ = Number.isInteger(captionTrackZ) && captionTrackZ >= 0
    ? captionTrackZ
    : Number.MAX_SAFE_INTEGER;
  const enabledOverlays = overlays.filter((overlay) => overlay?.enabled !== false);
  const captionRoot = Array.isArray(captions) ? captions : captions?.captions ?? [];
  const captionOverlays = generateCaptionOverlays(captionRoot, edit.cuts ?? [], {
    output: { width, height },
    sourceCount: Array.isArray(edit.sources) ? edit.sources.length : 1,
    defaultTextStyle: Array.isArray(captions) ? undefined : captions?.default_text_style,
    emphasisWords: Array.isArray(captions) ? edit.emphasis_words : captions?.emphasis_words ?? edit.emphasis_words,
  }).map((overlay) => ({ ...overlay, z: captionZ }));
  const allOverlays = [...enabledOverlays, ...captionOverlays];
  const projectedEdit = {
    ...edit,
    layers: (edit.layers ?? []).map((layer, index) => layer?.kind === "filter" && layer?.filter?.type === "lut"
      ? { ...layer, filter: { ...layer.filter, cubeText: layerLutCubeTexts[index] } }
      : layer),
    output: { ...edit.output, width, height, fps },
  };
  const overlaySheetHtml = renderOverlaySheet({ overlays: allOverlays, edit: projectedEdit, projectRoot, duration })
    .replace(/file:[^"')]+NotoSansJP-Variable\.ttf/gu, "/caption-font.ttf");
  const lookDeclaration = lutCubeText === null ? null : {
    cubeText: lutCubeText,
    intensity: Number(edit?.output?.look?.intensity ?? 1),
  };
  const config = { edit: projectedEdit, fps, width, height, duration, look: lookDeclaration, adjustLutCubeTexts };
  const pageHeight = height + (stampRow ? 1 : 0);
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=${width},height=${pageHeight}">
  <style>
    html, body { margin: 0; width: ${width}px; height: ${pageHeight}px; overflow: hidden; background: #000; }
    #akari-stage { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; background: #000; }
    #akari-engine, #akari-overlays { position: absolute; inset: 0; width: ${width}px; height: ${height}px; border: 0; display: block; }
    #akari-engine { z-index: 0; }
    #akari-overlays { z-index: 1; background: transparent; }
    #akari-stamp { position: fixed; z-index: 2147483647; left: 0; bottom: 0; width: 100%; height: 1px; background: rgb(0, 0, 85); }
  </style>
</head>
<body>
  <div id="akari-stage">
    <canvas id="akari-engine" width="${width}" height="${height}"></canvas>
    <iframe id="akari-overlays" src="/overlay-sheet.html" scrolling="no" title="AKARI overlays"></iframe>
  </div>
  ${stampRow ? '<div id="akari-stamp" aria-hidden="true"></div>' : ""}
  <script>window.__akariEncodeStamp=${stampFunctionSource()};window.__AKARI_OSR_CONFIG__=${safeJson(config)};</script>
  <script>${inlineScript(frameEngineBundle)}</script>
  <script>${inlineScript(pageRuntime)}</script>
</body>
</html>
`;
  return {
    html,
    overlaySheetHtml,
    edit: projectedEdit,
    manifest: {
      version: 1,
      dimensions: { width, height, pageHeight },
      fps,
      duration,
      layers: ["engine-canvas", "dom-captions", "html-overlays", "three-canvas"],
      captionOverlayCount: captionOverlays.length,
      overlayCount: enabledOverlays.length,
      lutApplication: lookDeclaration ? "engine-canvas" : "none",
      adjustApplication: hasEffectiveItemAdjust(projectedEdit) ? "engine-item-source" : "none",
      stampRow,
    },
  };
}

export async function loadAndBuildOsrPage({
  projectRoot,
  editPath = join(projectRoot, "edit.json"),
  plan = null,
  fps,
  width,
  height,
  duration,
  stampRow = true,
}) {
  const resolvedEditPath = editPath ?? join(projectRoot, "edit.json");
  const editText = await readFile(resolvedEditPath, "utf8");
  const captionsRoot = await readJsonIfPresent(join(projectRoot, "captions.json"), undefined);
  const renderEdit = readRenderEdit(editText, join(projectRoot, ".akari", "render-tmp", "osr-page"), {
    captions: captionsRoot === undefined ? undefined : toAnchorCaptions(captionsRoot),
  });
  const projectedEdit = renderEdit.edit;
  const prepared = await prepareAlphaLayers(projectedEdit, { projectRoot });
  const edit = prepared.edit;
  const trackZByItemId = collectTrackZByItemId(renderEdit.internal.tracks);
  const captions = filterCaptionRootByExcludedIds(
    applyCaptionStylePresets(captionsRoot ?? [], TEXTSTYLE_CATALOG).root,
    collectExcludedCaptionIds(edit),
  );
  const overlays = await Promise.all((edit.overlays ?? []).filter((overlay) => overlay?.enabled !== false).map(async (overlay) => {
    const expanded = { ...overlay, z: resolveRecordTrackZ(trackZByItemId, overlay) };
    if (typeof overlay.html === "string" && overlay.html.trimStart().startsWith("<")) return expanded;
    const htmlPath = overlay.html;
    const html = await readFile(resolve(projectRoot, htmlPath), "utf8");
    return { ...expanded, htmlPath, html: embedFragmentAssets(html, { projectRoot, htmlPath, overlayId: overlay.id }) };
  }));
  let lutCubeText = null;
  const lutRef = edit?.output?.look?.lut;
  if (typeof lutRef === "string" && lutRef !== "") {
    lutCubeText = await readFile(resolveLutPath(projectRoot, lutRef), "utf8");
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
  const adjustLutCubeTexts = await resolveItemAdjustLutCubeTexts(edit, projectRoot);
  const page = buildOsrPage({
    edit,
    captions,
    overlays,
    projectRoot,
    plan,
    fps: fps ?? edit.output.fps,
    width: width ?? edit.output.width,
    height: height ?? edit.output.height,
    duration: duration ?? plan?.predicted_duration_seconds ?? inferDuration(edit),
    captionTrackZ: resolveCaptionTrackZ(renderEdit.internal.tracks),
    stampRow,
    lutCubeText,
    layerLutCubeTexts,
    adjustLutCubeTexts,
  });
  return { ...page, warnings: prepared.warnings };
}

function effectiveAdjustLutRef(item) {
  if (item?.adjust?.sections?.lut === false) return null;
  const ref = item?.adjust?.lut?.lut;
  return typeof ref === "string" && ref !== "" ? ref : null;
}

function hasEffectiveItemAdjust(edit) {
  return [...(edit?.cuts ?? []), ...(edit?.layers ?? [])].some((item) => {
    const adjust = item?.adjust;
    const basic = item?.adjust?.sections?.basic === false ? null : item?.adjust?.basic;
    const hasBasic = basic && Object.values(basic).some((value) => Number.isFinite(value) && Math.abs(value) > 1e-6);
    const intensity = Number(item?.adjust?.lut?.intensity ?? 1);
    // Match kernel normalization and identity tolerances without a runtime dependency.
    const clamp01 = value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    const hasWheels = adjust?.sections?.wheels !== false
      && ['lift', 'gamma', 'gain', 'offset'].some(wheel =>
        ['r', 'g', 'b'].some(channel => {
          const value = adjust?.wheels?.[wheel]?.[channel];
          return Number.isFinite(value) && value !== 0;
        }));
    const hasCurves = adjust?.sections?.curves !== false
      && ['master', 'r', 'g', 'b'].some(channel => {
        const raw = adjust?.curves?.[channel];
        if (raw == null) return false;
        const points = raw.map(point => ({ in: clamp01(point.in), out: clamp01(point.out) }))
          .sort((a, b) => a.in - b.in);
        return !(points.length === 2
          && Math.abs(points[0].in) < 1e-5 && Math.abs(points[0].out) < 1e-5
          && Math.abs(points[1].in - 1) < 1e-5 && Math.abs(points[1].out - 1) < 1e-5);
      });
    const hasHue = adjust?.sections?.hue !== false
      && ['hue', 'sat', 'luma'].some(channel =>
        (adjust?.hue?.[channel] ?? []).some(point =>
          Math.abs((Number.isFinite(point.value) ? clamp01(point.value) : 0.5) - 0.5) > 1e-4));
    return Boolean(hasBasic || hasWheels || hasCurves || hasHue || (effectiveAdjustLutRef(item) && (!Number.isFinite(intensity) || intensity > 0)));
  });
}

async function resolveItemAdjustLutCubeTexts(edit, projectRoot) {
  const table = {};
  const items = [
    ...(edit?.cuts ?? []).map((item, index) => ({ item, id: String(item?.id ?? `cut-${index}`) })),
    ...(edit?.layers ?? []).map((item, index) => ({ item, id: String(item?.id ?? `layer-${index}`) })),
  ];
  await Promise.all(items.map(async ({ item, id }) => {
    const ref = effectiveAdjustLutRef(item);
    if (!ref) return;
    try {
      table[id] = await readFile(resolveLutPath(projectRoot, ref), "utf8");
    } catch (error) {
      throw new Error(`item adjust LUT ${ref} for ${id} could not be resolved: ${error instanceof Error ? error.message : String(error)}`);
    }
  }));
  return table;
}

function inferDuration(edit) {
  let duration = 0;
  for (const cut of edit.cuts ?? []) {
    const speed = Number(cut.speed ?? 1) || 1;
    const freeze = Number(cut.freeze?.duration_sec ?? 0) || 0;
    const transition = Number(cut.transition_out?.duration ?? 0) || 0;
    duration += Math.max(0, (Number(cut.out ?? 0) - Number(cut.in ?? 0)) / speed + freeze - transition);
  }
  return duration;
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
