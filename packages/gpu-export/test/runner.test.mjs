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

test("GPU launcher uses the GPU desktop runtime probe (tier 1 via electron-entry --akari-main)", async () => {
  const result = await resolveGpuLauncher({
    env: { AKARI_OSR_ELECTRON: "/desktop" }, platform: "linux", homeDirectory: "/opt/akari-test",
    probe: async (path) => path === "/desktop" || path.endsWith("resources/packages/gpu-export/src/electron-main.mjs"),
    resolveElectron: () => null,
  });
  assert.equal(result.tier, 1);
});

test("GPU launcher still honours allowDesktop: false (explicit opt-out of tier 1)", async () => {
  const result = await resolveGpuLauncher({
    allowDesktop: false,
    env: { AKARI_OSR_ELECTRON: "/desktop" }, platform: "linux", homeDirectory: "/opt/akari-test",
    probe: async (path) => path === "/desktop" || path.endsWith("resources/packages/gpu-export/src/electron-main.mjs"),
    resolveElectron: () => null,
  });
  assert.equal(result.tier, 3);
});

test("tier 1 GPU arguments carry --akari-main before --render", () => {
  const args = buildGpuElectronArguments({ tier: 1, executable: "/desktop" }, {
    projectRoot: "/p", out: "/o/out.mp4", fps: 30, width: 16, height: 16, duration: 1, frames: 30, quality: "high",
  });
  const mainIndex = args.indexOf("--akari-main");
  assert.ok(mainIndex >= 0);
  assert.equal(args[mainIndex + 1], "packages/gpu-export/src/electron-main.mjs");
  assert.ok(mainIndex < args.indexOf("--render"));
});

test("tier 3 is fail-closed", async () => {
  await assert.rejects(launchGpuExport({ tier: 3, reason: "missing" }, {}), /unavailable/);
});
