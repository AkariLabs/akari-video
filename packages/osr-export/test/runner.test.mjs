import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  buildElectronArguments,
  desktopCandidates,
  FALLBACK_WARNING,
  launchElectronExport,
  resolveElectronLauncher,
} from "../src/runner.mjs";

function spawnMock({ code = 0, stdout = [], beforeClose } = {}) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    setImmediate(async () => {
      try {
        for (const chunk of stdout) child.stdout.write(chunk);
        child.stdout.end();
        child.stderr.end();
        await beforeClose?.();
        child.emit("close", code, null);
      } catch (error) {
        child.emit("error", error);
      }
    });
    return child;
  };
}

function exportOptions(out) {
  return {
    projectRoot: "/project",
    out,
    fps: 30,
    width: 1920,
    height: 1080,
    duration: 1,
    frames: 30,
  };
}

test("器は desktop を npm electron より優先する", async () => {
  const result = await resolveElectronLauncher({
    env: { AKARI_OSR_ELECTRON: "/desktop" }, platform: "linux", homeDirectory: "/home/test",
    probe: async (path) => path === "/desktop", resolveElectron: () => "/npm/electron",
  });
  assert.equal(result.tier, 1);
});

test("allowInstalledDesktop:false はインストール済みアプリ候補を飛ばし、tier 3 に理由と警告を残す", async () => {
  const result = await resolveElectronLauncher({
    allowInstalledDesktop: false,
    env: {}, platform: "darwin", homeDirectory: "/opt/akari-test",
    probe: async () => true, resolveElectron: () => null,
  });
  assert.equal(result.tier, 3);
  assert.equal(result.skippedInstalledDesktop, true);
  assert.match(result.reason, /installed desktop app is skipped/);
  assert.match(result.warning, /候補から外しています/);
});

test("allowInstalledDesktop:false でも AKARI_OSR_ELECTRON の明示指定は tier 1 になる", async () => {
  const result = await resolveElectronLauncher({
    allowInstalledDesktop: false,
    env: { AKARI_OSR_ELECTRON: "/desktop" }, platform: "darwin", homeDirectory: "/opt/akari-test",
    probe: async (path) => path === "/desktop", resolveElectron: () => null,
  });
  assert.equal(result.tier, 1);
  assert.equal(result.reason, "environment override");
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

test("tier 1 は run 配下の user data を --render より前へ渡す", () => {
  const options = exportOptions(join("render-tmp", "run-1", "video.mp4"));
  const args = buildElectronArguments({ tier: 1 }, options);
  const userDataArgument = `--user-data-dir=${join(dirname(options.out), "electron-user-data")}`;
  assert.ok(args.includes(userDataArgument));
  assert.ok(args.indexOf("--force-device-scale-factor=1") < args.indexOf(userDataArgument));
  assert.ok(args.indexOf(userDataArgument) < args.indexOf("--render"));
});

test("tier 2 は script を先頭に保って run 配下の user data を渡す", () => {
  const options = exportOptions(join("render-tmp", "run-2", "video.mp4"));
  const args = buildElectronArguments({ tier: 2 }, options);
  const userDataArgument = `--user-data-dir=${join(dirname(options.out), "electron-user-data")}`;
  assert.match(args[0], /electron-main\.mjs$/);
  assert.ok(args.includes(userDataArgument));
  assert.ok(args.indexOf(userDataArgument) < args.indexOf("--render"));
});

test("明示した user data ディレクトリは run 配下の既定より優先される", () => {
  const options = { ...exportOptions(join("render-tmp", "run-3", "video.mp4")), userDataDir: join("custom", "profile") };
  const args = buildElectronArguments({ tier: 1 }, options);
  assert.ok(args.includes(`--user-data-dir=${options.userDataDir}`));
  assert.ok(!args.includes(`--user-data-dir=${join(dirname(options.out), "electron-user-data")}`));
});

test("exit 0 でも出力が無ければ単一インスタンスロックの可能性を報告する", async () => {
  const root = await mkdtemp(join(tmpdir(), "osr-runner-"));
  try {
    const out = join(root, "video.mp4");
    await assert.rejects(
      launchElectronExport({ tier: 1, executable: "/electron" }, exportOptions(out), { spawnImpl: spawnMock() }),
      (error) => {
        assert.match(error.message, /単一インスタンスロック/);
        assert.match(error.message, /PROGRESS 行 0/);
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("exit 0 で空の出力なら分割された PROGRESS 行数を含めて失敗する", async () => {
  const root = await mkdtemp(join(tmpdir(), "osr-runner-"));
  try {
    const out = join(root, "video.mp4");
    await assert.rejects(
      launchElectronExport({ tier: 1, executable: "/electron" }, exportOptions(out), {
        spawnImpl: spawnMock({
          stdout: ["PROG", "RESS frame=1 total=2\nPROGRESS frame=2 total=2\n"],
          beforeClose: () => writeFile(out, ""),
        }),
      }),
      /PROGRESS 行 2/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("exit 0 で空でない出力を作れば成功する", async () => {
  const root = await mkdtemp(join(tmpdir(), "osr-runner-"));
  try {
    const out = join(root, "video.mp4");
    const result = await launchElectronExport({ tier: 1, executable: "/electron" }, exportOptions(out), {
      spawnImpl: spawnMock({ beforeClose: () => writeFile(out, "video") }),
    });
    assert.equal(result.fellBackToLegacy, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("exit 1 は既存の Electron 終了エラーを維持する", async () => {
  const root = await mkdtemp(join(tmpdir(), "osr-runner-"));
  try {
    const out = join(root, "video.mp4");
    await assert.rejects(
      launchElectronExport({ tier: 1, executable: "/electron" }, exportOptions(out), { spawnImpl: spawnMock({ code: 1 }) }),
      /OSR Electron exited 1/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Windows デスクトップ候補は NSIS 既定を従来候補より優先する", () => {
  const localAppData = join("drive", "Users", "test", "AppData", "Local");
  const candidates = desktopCandidates({ env: { LOCALAPPDATA: localAppData }, platform: "win32", homeDirectory: "home" });
  assert.deepEqual(candidates.slice(0, 2), [
    join(localAppData, "Programs", "@akari-videoshell", "AKARI Video.exe"),
    join(localAppData, "Programs", "AKARI Video", "AKARI Video.exe"),
  ]);
});
