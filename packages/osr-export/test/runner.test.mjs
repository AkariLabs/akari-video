import assert from "node:assert/strict";
import test from "node:test";

import { buildElectronArguments, FALLBACK_WARNING, resolveElectronLauncher } from "../src/runner.mjs";

test("器は desktop を npm electron より優先する", async () => {
  const result = await resolveElectronLauncher({
    env: { AKARI_OSR_ELECTRON: "/desktop" }, platform: "linux", homeDirectory: "/home/test",
    probe: async (path) => path === "/desktop", resolveElectron: () => "/npm/electron",
  });
  assert.equal(result.tier, 1);
});

test("器は健全な npm electron dist を tier 2 にする", async () => {
  const required = new Set(["/npm/LICENSE", "/npm/LICENSES.chromium.html", "/npm/version", "/npm/electron"]);
  const result = await resolveElectronLauncher({
    env: {}, platform: "linux", homeDirectory: "/home/test",
    probe: async (path) => required.has(path), resolveElectron: () => "/npm/electron",
  });
  assert.equal(result.tier, 2);
});

test("dist 4 エントリの欠損は警告付き tier 3 へ落ちる", async () => {
  const result = await resolveElectronLauncher({
    env: {}, platform: "linux", homeDirectory: "/home/test",
    probe: async (path) => path !== "/npm/version" && path.startsWith("/npm/"), resolveElectron: () => "/npm/electron",
  });
  assert.equal(result.tier, 3);
  assert.equal(result.warning, FALLBACK_WARNING);
});

test("tier 2 は script を argv[1] に保ち Chromium スイッチを後置する", () => {
  const args = buildElectronArguments({ tier: 2 }, {
    projectRoot: "/project", out: "/out.mp4", fps: 30, width: 1920, height: 1080,
    duration: 1, frames: 30, soft: true, queueDepth: 2, dumpFrames: [0, 29],
  });
  assert.match(args[0], /electron-main\.mjs$/);
  assert.equal(args[1], "--force-device-scale-factor=1");
  assert.ok(args.includes("--disable-gpu"));
  assert.ok(args.includes("--dump-frames"));
});

test("tier 1 も実プロセス引数へ Chromium スイッチを渡す", () => {
  const args = buildElectronArguments({ tier: 1 }, {
    projectRoot: "/project", out: "/out.mp4", fps: 30, width: 1920, height: 1080,
    duration: 1, frames: 30,
  });
  assert.equal(args[0], "--force-device-scale-factor=1");
  assert.ok(args.indexOf("--force-color-profile=srgb") < args.indexOf("--render"));
});
