import assert from "node:assert/strict";
import test from "node:test";

import { summarizeGpuAdapters } from "../../osr-export/src/gpu-adapters.mjs";
import {
  describeHardwareEncoderFailure,
  extractGpuDiagnostics,
  firstLine,
  GPU_DIAGNOSTICS_MARKER,
  HARDWARE_ENCODER_UNSUPPORTED_MARKER,
  stripGpuDiagnosticsMarker,
} from "../src/gpu-diagnostics.mjs";

const CAUSE = "WebCodecs H.264 config is unsupported: prefer-hardware (avc1.640033 3840x2160@30fps 45000000bps) renderer=ANGLE (Intel, Intel(R) UHD Graphics (0x0000A7A8) Direct3D11 vs_5_0 ps_5_0, D3D11-32.0.101.5972)";
const RUN_ERROR = `Error: ${CAUSE}\n    at window.__akariGpuRun (http://127.0.0.1:1234/page-runtime.js:1700:15)`;
const RENDERER = { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) UHD Graphics (0x0000A7A8) Direct3D11 vs_5_0 ps_5_0, D3D11-32.0.101.5972)" };
const EXE = "D:\\AKARI\\Programs\\@akari-videoshell\\AKARI Video.exe";
const IGPU_ACTIVE = summarizeGpuAdapters([
  { active: true, deviceString: "Intel(R) UHD Graphics", gpuPreference: 2, vendorId: 32902, deviceId: 42920 },
  { active: false, deviceString: "NVIDIA GeForce RTX 5060 Laptop GPU", gpuPreference: 3, vendorId: 4318, deviceId: 11545 },
  { active: false, deviceString: "Microsoft Basic Render Driver", gpuPreference: 0, vendorId: 5140, deviceId: 140 },
]);
const DGPU_ACTIVE = summarizeGpuAdapters([
  { active: true, deviceString: "NVIDIA GeForce RTX 5060 Laptop GPU", gpuPreference: 2, vendorId: 4318, deviceId: 11545 },
  { active: false, deviceString: "Intel(R) UHD Graphics", gpuPreference: 0, vendorId: 32902, deviceId: 42920 },
]);
const SINGLE = summarizeGpuAdapters([
  { active: true, deviceString: "Intel(R) Iris(R) Xe Graphics", gpuPreference: 2, vendorId: 32902, deviceId: 1 },
  { active: false, deviceString: "Microsoft Basic Render Driver", gpuPreference: 0, vendorId: 5140, deviceId: 140 },
]);

function assertOneLine(message) {
  assert.equal(typeof message, "string");
  assert.doesNotMatch(message, /[\r\n]/u);
  assert.match(message, /（原因: WebCodecs H\.264 config is unsupported: prefer-hardware \(avc1\.640033 3840x2160@30fps 45000000bps\) renderer=ANGLE \(Intel, .*\)）$/u);
}

test("a. hybrid・iGPU・user-preference-respected: 省電力固定の説明と force の案内", () => {
  const message = describeHardwareEncoderFailure({
    adapters: IGPU_ACTIVE, renderer: RENDERER, cause: firstLine(RUN_ERROR),
    gpuPreference: { applied: false, reason: "user-preference-respected", previous: "GpuPreference=1;", executable: EXE },
  });
  assertOneLine(message);
  assert.equal(message, `ハードウェア H.264 エンコーダが使えません。書き出しプロセスは内蔵 GPU（Intel(R) UHD Graphics）で動作しています。Windows の「グラフィックスの設定」でこのアプリが省電力に固定されているため自動切り替えしませんでした。高パフォーマンスへ変更するか、AKARI_EXPORT_GPU_PREFERENCE=force（render-cut --gpu-preference force）で再実行してください（原因: ${CAUSE}）`);
});

test("b. hybrid・iGPU・policy-off: 高パフォーマンス GPU 名と auto の案内", () => {
  const message = describeHardwareEncoderFailure({
    adapters: IGPU_ACTIVE, renderer: RENDERER, cause: firstLine(RUN_ERROR),
    gpuPreference: { applied: false, reason: "policy-off", policy: "off" },
  });
  assertOneLine(message);
  assert.equal(message, `ハードウェア H.264 エンコーダが使えません。書き出しプロセスは内蔵 GPU（Intel(R) UHD Graphics）で動作しています。高パフォーマンス GPU（NVIDIA GeForce RTX 5060 Laptop GPU）への自動切り替えが off です。AKARI_EXPORT_GPU_PREFERENCE=auto で再実行してください（原因: ${CAUSE}）`);
});

test("c. hybrid・iGPU・applied: 書いた実行ファイルを示して設定アプリを案内", () => {
  const message = describeHardwareEncoderFailure({
    adapters: IGPU_ACTIVE, renderer: RENDERER, cause: firstLine(RUN_ERROR),
    gpuPreference: { applied: true, reason: "unset", executable: EXE, restored: true },
  });
  assertOneLine(message);
  assert.equal(message, `ハードウェア H.264 エンコーダが使えません。書き出しプロセスは内蔵 GPU（Intel(R) UHD Graphics）で動作しています。GPU 設定（${EXE}）を書き込みましたが反映されませんでした。Windows の「グラフィックスの設定」でこの実行ファイルを高パフォーマンスにしてください（原因: ${CAUSE}）`);
});

test("d. dGPU に載ったのに unsupported: ドライバ更新か --engine osr", () => {
  const message = describeHardwareEncoderFailure({
    adapters: DGPU_ACTIVE, renderer: { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 5060 Laptop GPU (0x00002D19) Direct3D11 vs_5_0 ps_5_0, D3D11-32.0.16.1656)" },
    gpuPreference: { applied: true, reason: "unset", executable: EXE, restored: true }, cause: firstLine(RUN_ERROR),
  });
  assertOneLine(message);
  assert.equal(message, `高パフォーマンス GPU（NVIDIA GeForce RTX 5060 Laptop GPU）で動作していますがハードウェア H.264 エンコーダが応答しません。GPU ドライバの更新、または --engine osr で再実行してください（原因: ${CAUSE}）`);
});

test("e. hybrid でない: この GPU にはエンコーダが無い", () => {
  const message = describeHardwareEncoderFailure({ adapters: SINGLE, renderer: RENDERER, gpuPreference: { reason: "unset", applied: true }, cause: firstLine(RUN_ERROR) });
  assertOneLine(message);
  assert.equal(message, `この GPU（Intel(R) Iris(R) Xe Graphics）にはハードウェア H.264 エンコーダがありません。--engine osr で再実行してください（原因: ${CAUSE}）`);
  // 他 OS（platform skip）でも同じ文面。active_device が無ければ renderer 文字列
  const noDeviceString = describeHardwareEncoderFailure({ adapters: { ...SINGLE, active_device: null }, renderer: RENDERER, gpuPreference: { reason: "platform" }, cause: CAUSE });
  assert.match(noDeviceString, /^この GPU（ANGLE \(Intel, /u);
});

test("f. devices が null: renderer 文字列だけで e 相当 + GPU 情報未取得の注記", () => {
  const message = describeHardwareEncoderFailure({ adapters: null, renderer: RENDERER, gpuPreference: { reason: "unset", applied: true }, cause: firstLine(RUN_ERROR) });
  assertOneLine(message);
  assert.equal(message, `この GPU（${RENDERER.renderer}）にはハードウェア H.264 エンコーダがありません。--engine osr で再実行してください（GPU 情報は取得できませんでした）（原因: ${CAUSE}）`);
  // renderer も無いときは「不明な GPU」。原因が無ければ末尾の括弧も付けない
  assert.equal(describeHardwareEncoderFailure({}), "この GPU（不明な GPU）にはハードウェア H.264 エンコーダがありません。--engine osr で再実行してください（GPU 情報は取得できませんでした）");
});

test("判定表に無い理由（already-high-performance 等）で iGPU のままなら設定アプリを案内する", () => {
  const message = describeHardwareEncoderFailure({
    adapters: IGPU_ACTIVE, renderer: RENDERER, cause: "boom\nsecond line",
    gpuPreference: { applied: false, reason: "already-high-performance", executable: EXE },
  });
  assert.doesNotMatch(message, /[\r\n]/u);
  assert.equal(message, `ハードウェア H.264 エンコーダが使えません。書き出しプロセスは内蔵 GPU（Intel(R) UHD Graphics）で動作しています。自動切り替えは行われませんでした（already-high-performance）。Windows の「グラフィックスの設定」でこの実行ファイル（${EXE}）を高パフォーマンスにしてください（原因: boom）`);
});

test("renderer 側の診断は error のプロパティ → message 末尾の marker の順で拾い、記録からは marker を外す", () => {
  const diagnostics = { renderer: RENDERER, encoder_support: { "prefer-hardware": false, "prefer-software": true } };
  const encoded = `${GPU_DIAGNOSTICS_MARKER}${encodeURIComponent(JSON.stringify(diagnostics))}`;
  const viaMarker = new Error(`${CAUSE} ${encoded}`);
  assert.deepEqual(extractGpuDiagnostics(viaMarker), diagnostics);
  const viaProperty = new Error("WebCodecs H.264 config is unsupported: prefer-hardware");
  viaProperty.gpuDiagnostics = { renderer: RENDERER, encoder_support: { "prefer-hardware": false, "prefer-software": true }, extra: 1 };
  assert.deepEqual(extractGpuDiagnostics(viaProperty), diagnostics);
  assert.equal(extractGpuDiagnostics(new Error("renderer process gone: crashed")), null);
  assert.equal(extractGpuDiagnostics(new Error(`x ${GPU_DIAGNOSTICS_MARKER}%7Bbroken`)), null);
  assert.equal(stripGpuDiagnosticsMarker(`Error: ${CAUSE} ${encoded}\n    at run (page-runtime.js:1)`), `Error: ${CAUSE}\n    at run (page-runtime.js:1)`);
  assert.equal(firstLine(`Error: ${CAUSE} ${encoded}\n    at run`), CAUSE);
  assert.equal(firstLine(null), null);
  assert.equal(HARDWARE_ENCODER_UNSUPPORTED_MARKER, "WebCodecs H.264 config is unsupported");
});
