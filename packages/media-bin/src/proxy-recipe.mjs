import { readFileSync } from "node:fs";

const recipe = JSON.parse(readFileSync(
  new URL("./proxy-recipe.json", import.meta.url),
  "utf8",
));

export const PROXY_RECIPE_VERSION = recipe.version;

export function proxyRecipeGopFrames(fps) {
  const resolvedFps = Number.isFinite(fps) && fps > 0 ? fps : recipe.defaultFps;
  return String(Math.max(1, Math.round(resolvedFps)));
}

export function previewProxyGopArgs({ fps } = {}) {
  const frames = proxyRecipeGopFrames(fps);
  return [
    recipe.keyintFlags[0], frames,
    recipe.keyintFlags[1], frames,
    ...recipe.constantGopArgs,
  ];
}

export function previewProxyVideoArgs({
  fps,
  pixFmt = recipe.defaultPixFmt,
  preset,
  crf,
} = {}) {
  return [
    ...recipe.codecArgs,
    "-preset", String(preset),
    "-crf", String(crf),
    "-pix_fmt", String(pixFmt),
    ...previewProxyGopArgs({ fps }),
  ];
}

export function parseFrameRate(rFrameRate) {
  if (typeof rFrameRate === "number") {
    return Number.isFinite(rFrameRate) && rFrameRate > 0 ? rFrameRate : undefined;
  }
  if (typeof rFrameRate !== "string" || rFrameRate.trim() === "") return undefined;
  const value = rFrameRate.trim();
  const fraction = value.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\/([+-]?(?:\d+(?:\.\d*)?|\.\d+))$/u);
  if (fraction) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    const parsed = numerator / denominator;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
