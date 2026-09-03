import assert from "node:assert/strict";
import test from "node:test";

import { resolveRvmRuntime } from "../src/index.mjs";
import { MODEL_MANIFEST } from "../src/model-manifest.mjs";

const releaseRoot =
  "https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/";

test("model manifest pins the official v1.0.0 URLs and measured sha256 values", () => {
  assert.deepEqual(MODEL_MANIFEST, {
    mobilenetv3: {
      filename: "rvm_mobilenetv3_fp32.onnx",
      url: `${releaseRoot}rvm_mobilenetv3_fp32.onnx`,
      sha256: "88d4531297118f595bf2fd60f6f566aec2e559393802d1f436c380f0cbbd2828",
    },
    resnet50: {
      filename: "rvm_resnet50_fp32.onnx",
      url: `${releaseRoot}rvm_resnet50_fp32.onnx`,
      sha256: "25db300fcb6ee27f941a1b52c97856e8d1f13c7f35817f81a612f89af0e8a85c",
    },
  });
});

test("RVM runtime resolution is non-exceptional and does not load the native module", () => {
  const calls = [];
  assert.deepEqual(resolveRvmRuntime({
    resolveRuntime: (specifier) => {
      calls.push(specifier);
      return "/mock/runtime.js";
    },
  }), {
    available: true,
    reason: null,
    installHint: "cd packages/matte-rvm && npm install",
  });
  assert.deepEqual(calls, ["onnxruntime-node"]);

  const missing = resolveRvmRuntime({
    resolveRuntime: () => { throw new Error("not found"); },
  });
  assert.equal(missing.available, false);
  assert.match(missing.reason, /RVM の実行環境が入っていない/u);
  assert.equal(missing.installHint, "cd packages/matte-rvm && npm install");
});
