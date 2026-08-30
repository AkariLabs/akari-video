import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { generateCaptionOverlays } from "../../render-cut/src/captions.mjs";
import { renderOverlaySheet } from "../../render-cut/src/rasterize.mjs";
import { resolveLutPath } from "../../render-cut/src/render-inputs.mjs";
import { readRenderEdit } from "../../render-cut/src/internal-render.mjs";
import { prepareAlphaLayers } from "../../media-bin/src/alpha-intake.mjs";
import { stampFunctionSource } from "./stamp.mjs";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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
  stampRow = true,
  frameEngineBundle = readFileSync(FRAME_ENGINE_BUNDLE, "utf8"),
  pageRuntime = readFileSync(PAGE_RUNTIME, "utf8"),
  lutCubeText = null,
} = {}) {
  const enabledOverlays = overlays.filter((overlay) => overlay?.enabled !== false);
  const captionRoot = Array.isArray(captions) ? captions : captions?.captions ?? [];
  const captionOverlays = generateCaptionOverlays(captionRoot, edit.cuts ?? [], {
    output: { width, height },
    sourceCount: Array.isArray(edit.sources) ? edit.sources.length : 1,
    defaultTextStyle: Array.isArray(captions) ? undefined : captions?.default_text_style,
    emphasisWords: Array.isArray(captions) ? edit.emphasis_words : captions?.emphasis_words ?? edit.emphasis_words,
  });
  const allOverlays = [...enabledOverlays, ...captionOverlays];
  const projectedEdit = { ...edit, output: { ...edit.output, width, height, fps } };
  const overlaySheetHtml = renderOverlaySheet({ overlays: allOverlays, edit: projectedEdit, projectRoot, duration })
    .replace(/file:[^"')]+NotoSansJP-Variable\.ttf/gu, "/caption-font.ttf");
  const lookDeclaration = lutCubeText === null ? null : {
    cubeText: lutCubeText,
    intensity: Number(edit?.output?.look?.intensity ?? 1),
  };
  const config = { edit: projectedEdit, fps, width, height, duration, look: lookDeclaration };
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
  const projectedEdit = readRenderEdit(editText, join(projectRoot, ".akari", "render-tmp", "osr-page")).edit;
  const prepared = await prepareAlphaLayers(projectedEdit, { projectRoot });
  const edit = prepared.edit;
  const captions = await readJsonIfPresent(join(projectRoot, "captions.json"), []);
  const overlays = await Promise.all((edit.overlays ?? []).filter((overlay) => overlay?.enabled !== false).map(async (overlay) => ({
    ...overlay,
    html: typeof overlay.html === "string" && overlay.html.trimStart().startsWith("<")
      ? overlay.html
      : await readFile(resolve(projectRoot, overlay.html), "utf8"),
  })));
  let lutCubeText = null;
  const lutRef = edit?.output?.look?.lut;
  if (typeof lutRef === "string" && lutRef !== "") {
    lutCubeText = await readFile(resolveLutPath(projectRoot, lutRef), "utf8");
  }
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
    stampRow,
    lutCubeText,
  });
  return { ...page, warnings: prepared.warnings };
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
