import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { generateCaptionOverlays } from "../../render-cut/src/captions.mjs";
import { renderOverlaySheet } from "../../render-cut/src/rasterize.mjs";
import { resolveLutPath } from "../../render-cut/src/render-inputs.mjs";
import { readRenderEdit } from "../../render-cut/src/internal-render.mjs";
import { prepareAlphaLayers } from "../../media-bin/src/alpha-intake.mjs";
import { classifyCaptionWordMode, evaluateGpuEligibility } from "./eligibility.mjs";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FRAME_ENGINE_BUNDLE = join(PACKAGE_ROOT, "generated", "frame-engine.js");
const PAGE_RUNTIME = join(PACKAGE_ROOT, "src", "page-runtime.js");

export function buildGpuPage({
  edit,
  captions = [],
  overlays = [],
  projectRoot,
  fps = edit?.output?.fps ?? 30,
  width = edit?.output?.width ?? 1920,
  height = edit?.output?.height ?? 1080,
  duration = 0,
  lutCubeText = null,
  eligibility = null,
  frameEngineBundle = readFileSync(FRAME_ENGINE_BUNDLE, "utf8"),
  pageRuntime = readFileSync(PAGE_RUNTIME, "utf8"),
} = {}) {
  const enabledOverlays = overlays.filter((overlay) => overlay?.enabled !== false);
  const projectedEdit = { ...edit, overlays: enabledOverlays, output: { ...edit.output, width, height, fps } };
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
  const cueById = new Map(captionRoot.map((cue) => [String(cue.id), cue]));
  const portrait = height > width;
  const resolvedEmphasisWords = Array.isArray(captions)
    ? edit.emphasis_words ?? []
    : captions?.emphasis_words ?? edit.emphasis_words ?? [];
  const spriteManifest = {
    captions: captionOverlays.map((overlay) => {
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
        start: Number(overlay.start),
        duration: Number(overlay.duration),
        html: overlay.html.replace(/file:[^"')]+NotoSansJP-Variable\.ttf/gu, "/caption-font.ttf"),
        vars: overlay.vars ?? {},
        emPx: Number(textStyle?.size_px ?? (portrait ? Math.round(width * 0.06) : 38)),
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
    })),
    three: three.map(({ overlay, index }) => ({
      id: String(overlay.id), start: Number(overlay.start ?? 0), duration: Number(overlay.duration ?? duration), index,
    })),
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
  <script>${inlineScript(frameEngineBundle)}</script>
  <script>${inlineScript(pageRuntime)}</script>
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
    if (classifications.get(String(overlay.id)) !== "dom") {
      current = null;
      continue;
    }
    if (current === null) {
      current = { runId: `dom-${runs.length}`, index, entries: [] };
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
      params: overlay.params ?? null,
    });
  }
  return runs;
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

export async function loadAndBuildGpuPage({ projectRoot, fps, width, height, duration }) {
  const editText = await readFile(join(projectRoot, "edit.json"), "utf8");
  const projectedEdit = readRenderEdit(editText, join(projectRoot, ".akari", "render-tmp", "gpu-page")).edit;
  const prepared = await prepareAlphaLayers(projectedEdit, { projectRoot });
  const captions = await readJsonIfPresent(join(projectRoot, "captions.json"), []);
  const overlays = await Promise.all((prepared.edit.overlays ?? []).filter((overlay) => overlay?.enabled !== false).map(async (overlay) => ({
    ...overlay,
    html: typeof overlay.html === "string" && overlay.html.trimStart().startsWith("<")
      ? overlay.html
      : await readFile(resolve(projectRoot, overlay.html), "utf8"),
  })));
  const edit = { ...prepared.edit, overlays };
  let lutCubeText = null;
  if (typeof edit?.output?.look?.lut === "string" && edit.output.look.lut !== "") {
    lutCubeText = await readFile(resolveLutPath(projectRoot, edit.output.look.lut), "utf8");
  }
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
    lutCubeText,
    eligibility,
  });
  return { ...page, warnings: [...prepared.warnings, ...page.warnings] };
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
