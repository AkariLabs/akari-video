import { existsSync } from "node:fs";
import path from "node:path";

import { MODEL_MANIFEST, VENDOR_ROOT, modelPath } from "./model-manifest.mjs";

export const DEFAULT_RVM_MODEL = "mobilenetv3";

/** Resolve a managed RVM model without making model absence exceptional. */
export function resolveRvmModel(model = DEFAULT_RVM_MODEL, { env = process.env } = {}) {
  const entry = MODEL_MANIFEST[model];
  if (!entry) throw new Error(`unknown RVM model: ${model}`);
  const configuredDir = env.AKARI_RVM_MODEL_DIR;
  const modelDir = configuredDir ? path.resolve(configuredDir) : VENDOR_ROOT;
  const resolvedPath = modelPath(model, modelDir);
  const fetchHint = model === "resnet50"
    ? "cd packages/matte-rvm && node scripts/fetch-models.mjs --model resnet50"
    : "cd packages/matte-rvm && node scripts/fetch-models.mjs";
  return {
    model,
    path: resolvedPath,
    missing: !existsSync(resolvedPath),
    fetchHint,
  };
}

export { MODEL_MANIFEST, VENDOR_ROOT, modelPath } from "./model-manifest.mjs";
