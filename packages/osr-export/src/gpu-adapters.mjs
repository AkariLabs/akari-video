// 子プロセス（gpu / osr の electron-main）側の診断: app.getGPUInfo("complete") の gpuDevice[] から
// 「どの GPU に載ったか」を run.json に残し、summarizeGpuAdapters で失敗文の判定材料（hybrid / active）にする。
// Electron には依存しない（app は引数で受ける）ので node --test で検証できる。

export const GPU_INFO_TIMEOUT_MS = 3_000;
export const GPU_VENDOR_NAMES = Object.freeze({
  0x8086: "intel",
  0x10de: "nvidia",
  0x1002: "amd",
  0x1414: "microsoft",
});
const MICROSOFT_VENDOR_ID = 0x1414;
const HIGH_PERFORMANCE_GPU_PREFERENCE = 3;
const DISCRETE_VENDORS = Object.freeze(["nvidia", "amd"]);

export function gpuVendorName(vendorId) {
  const id = Number(vendorId);
  return Number.isInteger(id) && Object.hasOwn(GPU_VENDOR_NAMES, id) ? GPU_VENDOR_NAMES[id] : "unknown";
}

// gpuDevice[] → run.json の gpu.devices（snake_case・5 項目）。配列でなければ null。
export function normalizeGpuDevices(gpuDevice) {
  if (!Array.isArray(gpuDevice)) return null;
  return gpuDevice.map((device) => ({
    vendor_id: finiteInteger(device?.vendorId),
    device_id: finiteInteger(device?.deviceId),
    device_string: typeof device?.deviceString === "string" ? device.deviceString : null,
    active: device?.active === true,
    gpu_preference: finiteInteger(device?.gpuPreference),
  }));
}

// app.whenReady() 後に呼ぶ。3 秒で打ち切り（打ち切り・例外は null）。
export async function collectGpuDevices(app, { timeoutMs = GPU_INFO_TIMEOUT_MS } = {}) {
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
    timer.unref?.();
  });
  try {
    const info = await Promise.race([
      Promise.resolve().then(() => app.getGPUInfo("complete")).catch(() => null),
      timeout,
    ]);
    return normalizeGpuDevices(info?.gpuDevice);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// devices（normalizeGpuDevices の出力、または gpuDevice[] の生データ）→ 要約。null / 空なら null。
// hybrid = active でない gpu_preference === 3 の device がある、または vendor の異なる実 GPU（Microsoft Basic を除く）が 2 つ以上。
// high_performance_device = gpu_preference === 3 の device、無ければ実 GPU が複数あるときの discrete vendor（nvidia > amd）。
// active_is_high_performance = active device がその high_performance_device と同一。
export function summarizeGpuAdapters(devices) {
  const normalized = Array.isArray(devices) ? normalizeGpuDevices(devices.map(toGpuDeviceShape)) : null;
  if (!normalized || normalized.length === 0) return null;
  const active = normalized.find((device) => device.active) ?? null;
  const real = normalized.filter((device) => device.vendor_id !== MICROSOFT_VENDOR_ID);
  const vendors = new Set(real.map((device) => gpuVendorName(device.vendor_id)));
  const inactiveHighPerformance = normalized.some((device) => !device.active && device.gpu_preference === HIGH_PERFORMANCE_GPU_PREFERENCE);
  const hybrid = inactiveHighPerformance || (real.length >= 2 && vendors.size >= 2);
  let highPerformance = normalized.find((device) => device.gpu_preference === HIGH_PERFORMANCE_GPU_PREFERENCE) ?? null;
  if (!highPerformance && real.length >= 2 && vendors.size >= 2) {
    for (const vendor of DISCRETE_VENDORS) {
      highPerformance = real.find((device) => gpuVendorName(device.vendor_id) === vendor) ?? null;
      if (highPerformance) break;
    }
  }
  return {
    hybrid,
    active_vendor: active ? gpuVendorName(active.vendor_id) : null,
    active_device: active?.device_string ?? null,
    active_is_high_performance: active !== null && highPerformance !== null && active === highPerformance,
    high_performance_device: highPerformance?.device_string ?? null,
  };
}

function toGpuDeviceShape(device) {
  if (!device || typeof device !== "object") return {};
  return {
    vendorId: device.vendorId ?? device.vendor_id,
    deviceId: device.deviceId ?? device.device_id,
    deviceString: device.deviceString ?? device.device_string,
    active: device.active,
    gpuPreference: device.gpuPreference ?? device.gpu_preference,
  };
}

function finiteInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}
