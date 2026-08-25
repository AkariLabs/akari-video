// Robust Video Matting の公式リリース v1.0.0 を URL と SHA-256 でピン留めする表。
// 既定配布は mobilenetv3、約 100 MB の resnet50 は明示取得時だけ配る。
// 較正でアクセラレーション EP の出力破綻を確認したため、製品版は CPU 専用とする。

import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const VENDOR_ROOT = path.join(packageRoot, "vendor");

const RELEASE_ROOT =
  "https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/";

export const MODEL_MANIFEST = {
  mobilenetv3: {
    filename: "rvm_mobilenetv3_fp32.onnx",
    url: `${RELEASE_ROOT}rvm_mobilenetv3_fp32.onnx`,
    sha256: "88d4531297118f595bf2fd60f6f566aec2e559393802d1f436c380f0cbbd2828",
  },
  resnet50: {
    filename: "rvm_resnet50_fp32.onnx",
    url: `${RELEASE_ROOT}rvm_resnet50_fp32.onnx`,
    sha256: "25db300fcb6ee27f941a1b52c97856e8d1f13c7f35817f81a612f89af0e8a85c",
  },
};

export function modelPath(model, modelDir = VENDOR_ROOT) {
  const entry = MODEL_MANIFEST[model];
  if (!entry) throw new Error(`unknown RVM model: ${model}`);
  return path.join(modelDir, entry.filename);
}
