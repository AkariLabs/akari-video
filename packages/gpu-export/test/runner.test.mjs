import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
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
  assert.equal(args.includes("--quantizer"), false);
  assert.equal(args[args.indexOf("--quality") + 1], "high");
  assert.ok(args.includes("--soft"));
});

test("runner places a forwarded quantizer immediately after bitrate", () => {
  const args = buildGpuElectronArguments({ tier: 2 }, {
    projectRoot: "/project", out: "/out.mp4", fps: 30, width: 1920, height: 1080,
    duration: 1, frames: 30, quality: "standard", bitrate: 8_000_000, quantizer: 26,
  });
  const bitrateIndex = args.indexOf("--bitrate");
  assert.deepEqual(args.slice(bitrateIndex, bitrateIndex + 4), ["--bitrate", "8000000", "--quantizer", "26"]);
});

test("runner forwards sorted dump frame numbers", () => {
  const args = buildGpuElectronArguments({ tier: 2 }, {
    projectRoot: "/project", out: "/out.mp4", fps: 30, width: 320, height: 180,
    duration: 1, frames: 30, bitrate: 1234, dumpFrames: [0, 12, 29],
  });
  assert.equal(args[args.indexOf("--dump-frames") + 1], "0,12,29");
});

test("runner forwards force eligibility to the Electron child", () => {
  const args = buildGpuElectronArguments({ tier: 2 }, {
    projectRoot: "/project", out: "/out.mp4", fps: 30, width: 320, height: 180,
    duration: 1, frames: 30, force: true,
  });
  assert.ok(args.includes("--force-eligibility"));
});

test("runner omits force eligibility by default", () => {
  const args = buildGpuElectronArguments({ tier: 2 }, {
    projectRoot: "/project", out: "/out.mp4", fps: 30, width: 320, height: 180,
    duration: 1, frames: 30,
  });
  assert.equal(args.includes("--force-eligibility"), false);
});

test("runner resolves quality bitrate and keeps master fail-closed", () => {
  const args = buildGpuElectronArguments({ tier: 2 }, {
    projectRoot: "/project", out: "/out.mp4", fps: 30, width: 320, height: 180,
    duration: 1, frames: 30, quality: "light",
  });
  assert.equal(args[args.indexOf("--quality") + 1], "light");
  assert.equal(args[args.indexOf("--bitrate") + 1], "5000000");
  assert.equal(args[args.indexOf("--quantizer") + 1], "30");
  assert.throws(() => buildGpuElectronArguments({ tier: 2 }, {
    projectRoot: "/project", out: "/out.mp4", fps: 30, width: 320, height: 180,
    duration: 1, frames: 30, quality: "master",
  }), /master は GPU 出口では --bitrate の明示が必要/);
});

test("runner resolves HEVC bitrate and quantizer from HEVC presets", () => {
  const args = buildGpuElectronArguments({ tier: 2 }, {
    projectRoot: "/project", out: "/out.mp4", fps: 30, width: 1920, height: 1080,
    duration: 1, frames: 30, quality: "standard", codec: "hevc",
  });
  assert.equal(args[args.indexOf("--bitrate") + 1], "4800000");
  assert.equal(args[args.indexOf("--quantizer") + 1], "24");
});

test("GPU launcher uses the GPU desktop runtime probe (tier 1 via electron-entry --akari-main)", async () => {
  const result = await resolveGpuLauncher({
    env: { AKARI_OSR_ELECTRON: "/desktop" }, platform: "linux", homeDirectory: "/opt/akari-test",
    probe: async (path) => path === "/desktop" || path.endsWith("resources/packages/gpu-export/src/electron-main.mjs"),
    resolveElectron: () => null,
  });
  assert.equal(result.tier, 1);
});

test("GPU launcher inherits the dev-layout installed desktop opt-out", async () => {
  const result = await resolveGpuLauncher({
    repoRoot: "/repo",
    readTextFile: async () => JSON.stringify({ workspaces: ["packages/*"] }),
    env: {}, platform: "linux", homeDirectory: "/opt/akari-test",
    probe: async () => true,
    resolveElectron: () => "/npm/electron",
  });
  assert.equal(result.tier, 2);
  assert.equal(result.kind, "npm-electron");
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

test("GPU launcher strips ELECTRON_RUN_AS_NODE from the Electron child on tier 1 and tier 2 (#27)", async () => {
  const root = await mkdtemp(join(tmpdir(), "gpu-runner-"));
  try {
    for (const launcher of [{ tier: 1, executable: "/desktop" }, { tier: 2, executable: "/npm/electron" }]) {
      const out = join(root, `video-${launcher.tier}.mp4`);
      const calls = [];
      const spawnImpl = (command, args, options) => {
        calls.push({ command, args, options });
        const child = new EventEmitter();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        setImmediate(async () => {
          child.stdout.end();
          child.stderr.end();
          await writeFile(out, "video");
          child.emit("close", 0, null);
        });
        return child;
      };
      await launchGpuExport(launcher, {
        projectRoot: "/p", out, fps: 30, width: 16, height: 16, duration: 1, frames: 30, quality: "high",
      }, { spawnImpl, env: { ELECTRON_RUN_AS_NODE: "1", AKARI_OSR_SOFT: "1" } });
      assert.equal(calls.length, 1);
      assert.equal(calls[0].command, launcher.executable);
      assert.equal(calls[0].args.includes("--akari-main"), launcher.tier === 1);
      assert.equal("ELECTRON_RUN_AS_NODE" in calls[0].options.env, false);
      assert.equal(calls[0].options.env.AKARI_OSR_SOFT, "1");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("tier 3 is fail-closed", async () => {
  await assert.rejects(launchGpuExport({ tier: 3, reason: "missing" }, {}), /unavailable/);
});

test("runner scales the quality preset bitrate for 4K output and leaves explicit bitrates alone", () => {
  const scaled = buildGpuElectronArguments({ tier: 2 }, {
    projectRoot: "/project", out: "/out.mp4", fps: 30, width: 3840, height: 2160,
    duration: 1, frames: 30, quality: "high",
  });
  assert.equal(scaled[scaled.indexOf("--bitrate") + 1], "48000000");
  const explicit = buildGpuElectronArguments({ tier: 2 }, {
    projectRoot: "/project", out: "/out.mp4", fps: 30, width: 3840, height: 2160,
    duration: 1, frames: 30, quality: "high", bitrate: 9_000_000,
  });
  assert.equal(explicit[explicit.indexOf("--bitrate") + 1], "9000000");
});

test("launchGpuExport passes exit: \"gpu\" to launchElectronExport (observed through the injected argumentBuilder; o, r1 revision of ruling 1)", async () => {
  const root = await mkdtemp(join(tmpdir(), "gpu-runner-exit-"));
  try {
    const out = join(root, "video.mp4");
    let observed = null;
    const spawnImpl = () => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      setImmediate(async () => { child.stdout.end(); child.stderr.end(); await writeFile(out, "video"); child.emit("close", 0, null); });
      return child;
    };
    const result = await launchGpuExport({ tier: 2, executable: "/npm/electron" }, {
      projectRoot: "/p", out, fps: 30, width: 16, height: 16, duration: 1, frames: 30, quality: "high",
    }, {
      spawnImpl, env: {}, platform: "linux",
      argumentBuilder: (launcher, options) => { observed = options; return buildGpuElectronArguments(launcher, options); },
    });
    assert.equal(observed.exit, "gpu");
    assert.equal(result.gpuPreference.exit, "gpu");
    assert.equal(result.gpuPreference.reason, "platform");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("auto preserves VGPU failure instead of falling back to OSR", async () => {
  const { runGpuWithRuntimeFallback } = await import('../../render-cut/src/render-cut.mjs');
  let osrCalls = 0;
  for (const prefix of ['VGPU-UNAVAILABLE:', 'VGPU-DEVICE-LOST:', 'VGPU-RENDER:']) {
    const error = new Error(`${prefix} caption-measure-unstable`);
    await assert.rejects(runGpuWithRuntimeFallback({ engineRequested: 'auto',
      runGpu: async () => { throw error; }, runOsr: async () => { osrCalls++; },
    }), value => value === error);
  }
  assert.equal(osrCalls, 0);
});
