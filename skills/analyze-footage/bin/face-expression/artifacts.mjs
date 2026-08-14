// Runtime/model pins for face-expression v0.
//
// Runtime choice: use the browser-only @mediapipe/tasks-vision package inside the same
// headless Chrome shape already proven by avatar-vrm. This avoids introducing Python or a
// second native sidecar, keeps the inference environment explicit (Chrome + vendored WASM),
// and lets the CLI use CPU delegation for repeatability. The tarball and every committed
// runtime file were hashed from the npm package before extraction.

export const TASKS_VISION_VERSION = "0.10.17";
export const TASKS_VISION_TARBALL = {
  url: "https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-0.10.17.tgz",
  sha256: "d3dd0759295f1adcf5455f22aa652c58b8c1d537c0d14c8db7df78646011d523",
};

export const VENDORED_RUNTIME_FILES = {
  "vendor/tasks-vision-0.10.17/LICENSE.txt": "b070d77bfb2c52a1dd6996de0ce5f64c49a0ca55c889b163a963ddf5cb001ee2",
  "vendor/tasks-vision-0.10.17/vision_bundle.mjs": "1ada13431ea2a8ed7ea449e6c3595122d43fea2a8a4788056ed7da271469b402",
  "vendor/tasks-vision-0.10.17/wasm/vision_wasm_internal.js": "33a4125f825b343d2d9773951a73692f40bee368c9b591af8ff652fd501af90b",
  "vendor/tasks-vision-0.10.17/wasm/vision_wasm_internal.wasm": "c88cf472dd5cab0a3954b071e5f442102ded3701dcccc987a7a02ee8f54aae85",
  "vendor/tasks-vision-0.10.17/wasm/vision_wasm_nosimd_internal.js": "4e8d07dcf8cbb55b343cd76b7fc30d4303220f049d5529d6412f6f93296726a8",
  "vendor/tasks-vision-0.10.17/wasm/vision_wasm_nosimd_internal.wasm": "f840f69d7229f89dedaed39c7ac7a52f0964a7cec02d6cb1ac9eff891db86dc2",
};

export const FACE_LANDMARKER_MODEL = {
  url: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  sha256: "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff",
  relativePath: "mediapipe/face-landmarker/float16-1/face_landmarker.task",
};

export const BLENDSHAPE_NAMES = [
  "_neutral",
  "browDownLeft",
  "browDownRight",
  "browInnerUp",
  "browOuterUpLeft",
  "browOuterUpRight",
  "cheekPuff",
  "cheekSquintLeft",
  "cheekSquintRight",
  "eyeBlinkLeft",
  "eyeBlinkRight",
  "eyeLookDownLeft",
  "eyeLookDownRight",
  "eyeLookInLeft",
  "eyeLookInRight",
  "eyeLookOutLeft",
  "eyeLookOutRight",
  "eyeLookUpLeft",
  "eyeLookUpRight",
  "eyeSquintLeft",
  "eyeSquintRight",
  "eyeWideLeft",
  "eyeWideRight",
  "jawForward",
  "jawLeft",
  "jawOpen",
  "jawRight",
  "mouthClose",
  "mouthDimpleLeft",
  "mouthDimpleRight",
  "mouthFrownLeft",
  "mouthFrownRight",
  "mouthFunnel",
  "mouthLeft",
  "mouthLowerDownLeft",
  "mouthLowerDownRight",
  "mouthPressLeft",
  "mouthPressRight",
  "mouthPucker",
  "mouthRight",
  "mouthRollLower",
  "mouthRollUpper",
  "mouthShrugLower",
  "mouthShrugUpper",
  "mouthSmileLeft",
  "mouthSmileRight",
  "mouthStretchLeft",
  "mouthStretchRight",
  "mouthUpperUpLeft",
  "mouthUpperUpRight",
  "noseSneerLeft",
  "noseSneerRight",
];
