import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { MODEL_MANIFEST, VENDOR_ROOT, modelPath } from "./model-manifest.mjs";

export const DEFAULT_RVM_MODEL = "mobilenetv3";
export const RVM_RUNTIME_UNAVAILABLE_REASON =
  "RVM の実行環境が入っていないため、この品質では人物マットを生成できません";
export const RVM_RUNTIME_INSTALL_HINT = "cd packages/matte-rvm && npm install";

const require = createRequire(import.meta.url);

/** Resolve the optional RVM runtime without loading its native module. */
export function resolveRvmRuntime({ resolveRuntime = require.resolve.bind(require) } = {}) {
  try {
    resolveRuntime("onnxruntime-node");
    return {
      available: true,
      reason: null,
      installHint: RVM_RUNTIME_INSTALL_HINT,
    };
  } catch {
    return {
      available: false,
      reason: RVM_RUNTIME_UNAVAILABLE_REASON,
      installHint: RVM_RUNTIME_INSTALL_HINT,
    };
  }
}

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
