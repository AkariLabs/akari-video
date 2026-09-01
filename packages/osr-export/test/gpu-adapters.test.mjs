import assert from "node:assert/strict";
import test from "node:test";

import { collectGpuDevices, gpuVendorName, normalizeGpuDevices, summarizeGpuAdapters } from "../src/gpu-adapters.mjs";

// 司令塔の実測（probe-2026-09-01.md）の gpuDevice[] 生データ。RTX 5060 Laptop + Intel UHD のハイブリッド機。
const IGPU_DEFAULT = [
  { active: true, deviceId: 42920, deviceString: "Intel(R) UHD Graphics", driverVendor: "Intel", driverVersion: "32.0.101.5972", gpuPreference: 2, revision: 4, subSysId: 348132450, vendorId: 32902 },
  { active: false, deviceId: 11545, deviceString: "NVIDIA GeForce RTX 5060 Laptop GPU", driverVersion: "32.0.16.1656", gpuPreference: 3, revision: 161, subSysId: 348460130, vendorId: 4318 },
  { active: false, deviceId: 140, deviceString: "Microsoft Basic Render Driver", driverVersion: "10.0.26100.8972", gpuPreference: 0, revision: 0, subSysId: 0, vendorId: 5140 },
];
// --force_high_performance_gpu: ANGLE だけ RTX（encoder は不可のまま）。Intel active: false・NVIDIA active: true。
const ANGLE_ONLY_RTX = IGPU_DEFAULT.map((device) => ({ ...device, active: device.vendorId === 4318 }));
// HKCU GpuPreference=2; あり（encoder 可）: RTX が 2・Intel が 0 になる。
const HKCU_RTX = [
  { active: true, deviceString: "NVIDIA GeForce RTX 5060 Laptop GPU", gpuPreference: 2, vendorId: 4318, deviceId: 11545 },
  { active: false, deviceString: "Intel(R) UHD Graphics", gpuPreference: 0, vendorId: 32902, deviceId: 42920 },
  { active: false, deviceString: "Microsoft Basic Render Driver", gpuPreference: 0, vendorId: 5140, deviceId: 140 },
];

test("vendorId は intel / nvidia / amd / microsoft / unknown に写す", () => {
  assert.equal(gpuVendorName(0x8086), "intel");
  assert.equal(gpuVendorName(32902), "intel");
  assert.equal(gpuVendorName(0x10de), "nvidia");
  assert.equal(gpuVendorName(0x1002), "amd");
  assert.equal(gpuVendorName(0x1414), "microsoft");
  assert.equal(gpuVendorName(0x1234), "unknown");
  assert.equal(gpuVendorName(undefined), "unknown");
});

test("gpuDevice[] は run.json の gpu.devices（snake_case 5 項目）に正規化する", () => {
  assert.deepEqual(normalizeGpuDevices(IGPU_DEFAULT)[0], {
    vendor_id: 32902, device_id: 42920, device_string: "Intel(R) UHD Graphics", active: true, gpu_preference: 2,
  });
  assert.equal(normalizeGpuDevices(IGPU_DEFAULT).length, 3);
  assert.equal(normalizeGpuDevices(undefined), null);
  assert.equal(normalizeGpuDevices({}), null);
  assert.deepEqual(normalizeGpuDevices([{}]), [{ vendor_id: null, device_id: null, device_string: null, active: false, gpu_preference: null }]);
});

test("iGPU 既定（HKCU 値なし）: hybrid・active は intel・高パフォーマンス側は RTX", () => {
  assert.deepEqual(summarizeGpuAdapters(IGPU_DEFAULT), {
    hybrid: true,
    active_vendor: "intel",
    active_device: "Intel(R) UHD Graphics",
    active_is_high_performance: false,
    high_performance_device: "NVIDIA GeForce RTX 5060 Laptop GPU",
  });
  // 正規化後（snake_case）の配列でも同じ要約になる
  assert.deepEqual(summarizeGpuAdapters(normalizeGpuDevices(IGPU_DEFAULT)), summarizeGpuAdapters(IGPU_DEFAULT));
});

test("--force_high_performance_gpu（ANGLE だけ RTX）: hybrid・active は nvidia（高パフォーマンス側）", () => {
  assert.deepEqual(summarizeGpuAdapters(ANGLE_ONLY_RTX), {
    hybrid: true,
    active_vendor: "nvidia",
    active_device: "NVIDIA GeForce RTX 5060 Laptop GPU",
    active_is_high_performance: true,
    high_performance_device: "NVIDIA GeForce RTX 5060 Laptop GPU",
  });
});

test("HKCU GpuPreference=2; 後: gpuPreference 3 の device が無くても vendor 差で hybrid・active は nvidia", () => {
  assert.deepEqual(summarizeGpuAdapters(HKCU_RTX), {
    hybrid: true,
    active_vendor: "nvidia",
    active_device: "NVIDIA GeForce RTX 5060 Laptop GPU",
    active_is_high_performance: true,
    high_performance_device: "NVIDIA GeForce RTX 5060 Laptop GPU",
  });
});

test("単一 GPU（Microsoft Basic を除いて 1 つ）は hybrid でない", () => {
  const single = [
    { active: true, deviceString: "NVIDIA GeForce RTX 4070", gpuPreference: 2, vendorId: 4318, deviceId: 1 },
    { active: false, deviceString: "Microsoft Basic Render Driver", gpuPreference: 0, vendorId: 5140, deviceId: 140 },
  ];
  assert.deepEqual(summarizeGpuAdapters(single), {
    hybrid: false,
    active_vendor: "nvidia",
    active_device: "NVIDIA GeForce RTX 4070",
    active_is_high_performance: false,
    high_performance_device: null,
  });
  // 同一 vendor が 2 つ（例: Intel Arc + Intel UHD）も gpuPreference 3 が無ければ hybrid ではない
  const sameVendor = [
    { active: true, deviceString: "Intel(R) UHD Graphics", gpuPreference: 2, vendorId: 32902, deviceId: 1 },
    { active: false, deviceString: "Intel(R) Arc(TM) Graphics", gpuPreference: 2, vendorId: 32902, deviceId: 2 },
  ];
  assert.equal(summarizeGpuAdapters(sameVendor).hybrid, false);
});

test("devices が null / 空なら要約も null", () => {
  assert.equal(summarizeGpuAdapters(null), null);
  assert.equal(summarizeGpuAdapters(undefined), null);
  assert.equal(summarizeGpuAdapters([]), null);
  assert.equal(summarizeGpuAdapters("Intel"), null);
});

test("collectGpuDevices は app.getGPUInfo(\"complete\") を 3 秒で打ち切り、例外・タイムアウトは null", async () => {
  const quick = { getGPUInfo: async (kind) => { assert.equal(kind, "complete"); return { gpuDevice: HKCU_RTX }; } };
  assert.deepEqual(await collectGpuDevices(quick), normalizeGpuDevices(HKCU_RTX));
  const slow = { getGPUInfo: () => new Promise(() => {}) };
  assert.equal(await collectGpuDevices(slow, { timeoutMs: 20 }), null);
  const throwing = { getGPUInfo: () => { throw new Error("GPU process is not ready"); } };
  assert.equal(await collectGpuDevices(throwing, { timeoutMs: 20 }), null);
  const rejecting = { getGPUInfo: async () => { throw new Error("GPU process is not ready"); } };
  assert.equal(await collectGpuDevices(rejecting, { timeoutMs: 20 }), null);
});
