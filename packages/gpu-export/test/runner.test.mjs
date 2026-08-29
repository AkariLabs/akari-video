import assert from "node:assert/strict";
import test from "node:test";

import { buildGpuElectronArguments, launchGpuExport, resolveGpuLauncher } from "../src/runner.mjs";

test("tier 2 uses the GPU main and product flags", () => {
  const args = buildGpuElectronArguments({ tier: 2 }, {
    projectRoot: "/project", out: "/out.mp4", fps: 30, width: 320, height: 180,
    duration: 1, frames: 30, queueDepth: 5, bitrate: 1234, soft: true, trapReadback: true,
  });
  assert.match(args[0], /gpu-export\/src\/electron-main\.mjs$/);
  assert.ok(args.includes("--trap-readback"));
  assert.ok(args.includes("--bitrate"));
  assert.equal(args[args.indexOf("--bitrate") + 1], "1234");
  assert.equal(args[args.indexOf("--quality") + 1], "high");
  assert.ok(args.includes("--soft"));
});

test("runner resolves quality bitrate and keeps master fail-closed", () => {
  const args = buildGpuElectronArguments({ tier: 2 }, {
    projectRoot: "/project", out: "/out.mp4", fps: 30, width: 320, height: 180,
    duration: 1, frames: 30, quality: "light",
  });
  assert.equal(args[args.indexOf("--quality") + 1], "light");
  assert.equal(args[args.indexOf("--bitrate") + 1], "5000000");
  assert.throws(() => buildGpuElectronArguments({ tier: 2 }, {
    projectRoot: "/project", out: "/out.mp4", fps: 30, width: 320, height: 180,
    duration: 1, frames: 30, quality: "master",
  }), /master は GPU 出口では --bitrate の明示が必要/);
});

test("GPU launcher skips the desktop tier (tier 1) until the shell can run the GPU main", async () => {
  const result = await resolveGpuLauncher({
    env: { AKARI_OSR_ELECTRON: "/desktop" }, platform: "linux", homeDirectory: "/opt/akari-test",
    probe: async (path) => path === "/desktop" || path.endsWith("resources/packages/gpu-export/src/electron-main.mjs"),
    resolveElectron: () => null,
  });
  assert.equal(result.tier, 3);
  assert.match(result.reason, /desktop app \(launcher tier 1\) is not wired/);
});

test("GPU launcher still resolves npm Electron (tier 2) when the desktop tier is skipped", async () => {
  const result = await resolveGpuLauncher({
    env: { AKARI_OSR_ELECTRON: "/desktop" }, platform: "linux", homeDirectory: "/opt/akari-test",
    probe: async () => true,
    resolveElectron: () => "/electron",
  });
  assert.equal(result.tier, 2);
  assert.equal(result.executable, "/electron");
});

test("GPU launcher honours an explicit allowDesktop: true (for the future tier 1 wiring)", async () => {
  const result = await resolveGpuLauncher({
    allowDesktop: true,
    env: { AKARI_OSR_ELECTRON: "/desktop" }, platform: "linux", homeDirectory: "/opt/akari-test",
    probe: async (path) => path === "/desktop" || path.endsWith("resources/packages/gpu-export/src/electron-main.mjs"),
    resolveElectron: () => null,
  });
  assert.equal(result.tier, 1);
});

test("tier 3 is fail-closed", async () => {
  await assert.rejects(launchGpuExport({ tier: 3, reason: "missing" }, {}), /unavailable/);
});
