import { FaceLandmarker, FilesetResolver } from "./vendor/tasks-vision-0.10.17/vision_bundle.mjs";

import { BLENDSHAPE_NAMES } from "./artifacts.mjs";
import { matrixToEuler } from "./euler.mjs";

const expectedNames = new Set(BLENDSHAPE_NAMES);
let faceLandmarker = null;

function bytesFromBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function loadImage(base64) {
  const image = new Image();
  image.decoding = "sync";
  image.src = `data:image/png;base64,${base64}`;
  await image.decode();
  return image;
}

function detectionAt(result, index) {
  const categories = result.faceBlendshapes[index]?.categories ?? [];
  if (categories.length !== BLENDSHAPE_NAMES.length) {
    throw new Error(`MediaPipe blendshape count: expected 52, got ${categories.length}`);
  }
  const pairs = categories.map((category) => [category.categoryName, Number(category.score)]);
  if (new Set(pairs.map(([name]) => name)).size !== BLENDSHAPE_NAMES.length) {
    throw new Error("MediaPipe blendshape names are duplicated");
  }
  const unknown = pairs.map(([name]) => name).filter((name) => !expectedNames.has(name));
  if (unknown.length > 0) throw new Error(`MediaPipe unknown blendshape: ${unknown.join(", ")}`);
  pairs.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  const blendshapes = Object.fromEntries(pairs);
  // Web API は face-presence の内部 score を結果に公開しない。v0 の conf は捏造した 1.0 ではなく、
  // 返された 52 生 score の最大値を決定論的に要約した signal confidence として記録する。
  const conf = Math.max(...Object.values(blendshapes));
  return {
    head: matrixToEuler(result.facialTransformationMatrixes[index]),
    blendshapes,
    conf,
  };
}

window.faceExpressionRuntime = {
  async initialize(modelBase64) {
    const wasmRoot = new URL("./vendor/tasks-vision-0.10.17/wasm", import.meta.url).href;
    const vision = await FilesetResolver.forVisionTasks(wasmRoot);
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetBuffer: bytesFromBase64(modelBase64), delegate: "CPU" },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    });
  },

  async detect(imageBase64, timestampMs) {
    if (!faceLandmarker) throw new Error("face landmarker is not initialized");
    const image = await loadImage(imageBase64);
    const result = faceLandmarker.detectForVideo(image, timestampMs);
    const count = Math.min(result.faceBlendshapes.length, result.facialTransformationMatrixes.length);
    return Array.from({ length: count }, (_, index) => detectionAt(result, index));
  },

  close() {
    faceLandmarker?.close();
    faceLandmarker = null;
  },
};

document.body.dataset.ready = "true";
