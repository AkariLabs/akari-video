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
  ELECTRON_CHILD_ENV_BLOCKLIST,
  electronChildEnvironment,
  isDevRepositoryLayout,
  launchElectronExport,
  resolveElectronLauncher,
} from "../src/runner.mjs";

function spawnMock({ code = 0, stdout = [], beforeClose, calls } = {}) {
  return (command, args, options) => {
    calls?.push({ command, args, options });
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

const DEV_REPOSITORY = Object.freeze({
  repoRoot: "/repo",
  readTextFile: async () => JSON.stringify({ workspaces: ["packages/*"] }),
});
const PACKAGED_LAYOUT = Object.freeze({
  repoRoot: "/resources",
  readTextFile: async () => JSON.stringify({ name: "packaged-resources" }),
});

test("isDevRepositoryLayout は workspaces 配列だけを dev レイアウトと判定する", async (t) => {
  await t.test("workspaces 配列あり", async () => {
    let readPath = null;
    assert.equal(await isDevRepositoryLayout({
      repoRoot: "/repo",
      readTextFile: async (path) => {
        readPath = path;
        return JSON.stringify({ workspaces: ["packages/*"] });
      },
    }), true);
    assert.equal(readPath, join("/repo", "package.json"));
  });
  for (const [name, readTextFile] of [
    ["package.json 不在", async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); }],
    ["壊れた JSON", async () => "{ broken"],
    ["workspaces なし", async () => JSON.stringify({ name: "packaged-resources" })],
    ["workspaces が配列ではない", async () => JSON.stringify({ workspaces: { packages: ["packages/*"] } })],
  ]) {
    await t.test(name, async () => {
      assert.equal(await isDevRepositoryLayout({ repoRoot: "/repo", readTextFile }), false);
    });
  }
});

test("isDevRepositoryLayout は注入時に結果をメモ化しない", async () => {
  let reads = 0;
  const options = {
    repoRoot: "/repo",
    readTextFile: async () => {
      reads += 1;
      return JSON.stringify({ workspaces: ["packages/*"] });
    },
  };
  assert.equal(await isDevRepositoryLayout(options), true);
  assert.equal(await isDevRepositoryLayout(options), true);
  assert.equal(reads, 2);
});

test("dev レイアウトは installed desktop を外して npm electron を選ぶ", async () => {
  const result = await resolveElectronLauncher({
    ...DEV_REPOSITORY,
    env: {}, platform: "linux", homeDirectory: "/home/test",
    probe: async () => true, resolveElectron: () => "/npm/electron",
  });
  assert.equal(result.tier, 2);
  assert.equal(result.kind, "npm-electron");
});

test("dev レイアウトでも AKARI_OSR_ELECTRON の明示指定は候補に残る", async () => {
  const result = await resolveElectronLauncher({
    ...DEV_REPOSITORY,
    env: { AKARI_OSR_ELECTRON: "/desktop" }, platform: "linux", homeDirectory: "/home/test",
    probe: async (path) => path === "/desktop", resolveElectron: () => null,
  });
  assert.equal(result.tier, 1);
  assert.equal(result.reason, "environment override");
});

test("dev レイアウトで Electron が無ければ tier 3 の理由に脱出口を示す", async () => {
  const result = await resolveElectronLauncher({
    ...DEV_REPOSITORY,
    env: {}, platform: "linux", homeDirectory: "/home/test",
    probe: async () => true, resolveElectron: () => null,
  });
  assert.equal(result.tier, 3);
  assert.equal(result.skippedInstalledDesktop, true);
  assert.match(result.reason, /開発リポジトリ配置/u);
  assert.match(result.reason, /AKARI_EXPORT_ALLOW_DESKTOP=1/u);
  assert.match(result.reason, /AKARI_OSR_ELECTRON=<path>/u);
});

test("AKARI_EXPORT_ALLOW_DESKTOP=1 は dev レイアウトでも tier 1 を許可する", async () => {
  const result = await resolveElectronLauncher({
    ...DEV_REPOSITORY,
    env: { AKARI_EXPORT_ALLOW_DESKTOP: "1" }, platform: "linux", homeDirectory: "/home/test",
    probe: async () => true, resolveElectron: () => null,
  });
  assert.equal(result.tier, 1);
  assert.equal(result.reason, "installed desktop app");
});

test("非 dev レイアウトは env 未設定でも従来どおり tier 1 を許可する", async () => {
  const result = await resolveElectronLauncher({
    ...PACKAGED_LAYOUT,
    env: {}, platform: "linux", homeDirectory: "/home/test",
    probe: async () => true, resolveElectron: () => null,
  });
  assert.equal(result.tier, 1);
});

test("明示 allowInstalledDesktop:true と allowDesktop:true は dev 自動判定より優先される", async () => {
  for (const explicit of [{ allowInstalledDesktop: true }, { allowDesktop: true }]) {
    const result = await resolveElectronLauncher({
      ...DEV_REPOSITORY,
      ...explicit,
      env: {}, platform: "linux", homeDirectory: "/home/test",
      probe: async () => true, resolveElectron: () => null,
    });
    assert.equal(result.tier, 1);
  }
});

test("AKARI_EXPORT_ALLOW_DESKTOP=0 は dev 判定より先に desktop 全体を外す", async () => {
  let reads = 0;
  const result = await resolveElectronLauncher({
    repoRoot: "/repo", readTextFile: async () => { reads += 1; return JSON.stringify({ workspaces: ["packages/*"] }); },
    env: { AKARI_OSR_ELECTRON: "/desktop", AKARI_EXPORT_ALLOW_DESKTOP: "0" },
    platform: "linux", homeDirectory: "/home/test",
    probe: async () => true, resolveElectron: () => null,
  });
  assert.equal(result.tier, 3);
  assert.equal(result.reason, "Electron unavailable");
  assert.equal(reads, 0);
});

test("器は desktop を npm electron より優先する", async () => {
  const result = await resolveElectronLauncher({
    env: { AKARI_OSR_ELECTRON: "/desktop" }, platform: "linux", homeDirectory: "/home/test",
    probe: async (path) => path === "/desktop", resolveElectron: () => "/npm/electron",
  });
  assert.equal(result.tier, 1);
});

test("allowInstalledDesktop:false はインストール済みアプリ候補を飛ばし、tier 3 に理由を残す", async () => {
  const result = await resolveElectronLauncher({
    allowInstalledDesktop: false,
    env: {}, platform: "darwin", homeDirectory: "/opt/akari-test",
    probe: async () => true, resolveElectron: () => null,
  });
  assert.equal(result.tier, 3);
  assert.equal(result.skippedInstalledDesktop, true);
  assert.match(result.reason, /installed desktop app is skipped/);
  assert.equal(Object.hasOwn(result, "warning"), false);
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

test("dist 4 エントリの欠損は理由付き tier 3 になる", async () => {
  const result = await resolveElectronLauncher({
    ...PACKAGED_LAYOUT,
    env: {}, platform: "linux", homeDirectory: "/home/test",
    probe: async (path) => path !== "/npm/version" && path.startsWith("/npm/"), resolveElectron: () => "/npm/electron",
  });
  assert.equal(result.tier, 3);
  assert.equal(result.reason, "Electron unavailable");
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

test("tier 1 は GPU main を --akari-main の POSIX 相対パスとして --render より前へ渡す", () => {
  const args = buildElectronArguments({ tier: 1 }, {
    ...exportOptions("/out.mp4"),
    mainScript: "/x/packages/gpu-export/src/electron-main.mjs",
  });
  const optionIndex = args.indexOf("--akari-main");
  assert.ok(optionIndex >= 0);
  assert.equal(args[optionIndex + 1], "packages/gpu-export/src/electron-main.mjs");
  assert.ok(optionIndex < args.indexOf("--render"));
});

test("tier 1 は mainScript 未指定なら --akari-main を付けない", () => {
  const args = buildElectronArguments({ tier: 1 }, exportOptions("/out.mp4"));
  assert.equal(args.includes("--akari-main"), false);
});

test("tier 2 は明示 mainScript を argv[1] に保ち --akari-main を付けない", () => {
  const mainScript = "/x/packages/gpu-export/src/electron-main.mjs";
  const args = buildElectronArguments({ tier: 2 }, {
    ...exportOptions("/out.mp4"),
    mainScript,
  });
  assert.equal(args[0], mainScript);
  assert.equal(args.includes("--akari-main"), false);
});

test("tier 1 は packages 配下でない mainScript を拒否する", () => {
  assert.throws(
    () => buildElectronArguments({ tier: 1 }, {
      ...exportOptions("/out.mp4"),
      mainScript: "/x/runtime/electron-main.mjs",
    }),
    /OSR launcher: mainScript must live under packages\/ \(got \/x\/runtime\/electron-main\.mjs\)/,
  );
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
    assert.equal(Object.hasOwn(result, "fellBackToLegacy"), false);
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

test("electronChildEnvironment は ELECTRON_RUN_AS_NODE だけを外し、他の変数と元の env は保つ（#27）", () => {
  const env = { ELECTRON_RUN_AS_NODE: "1", PATH: "/usr/bin", AKARI_OSR_SOFT: "1" };
  const child = electronChildEnvironment(env);
  assert.deepEqual(child, { PATH: "/usr/bin", AKARI_OSR_SOFT: "1" });
  assert.equal(env.ELECTRON_RUN_AS_NODE, "1");
  assert.deepEqual([...ELECTRON_CHILD_ENV_BLOCKLIST], ["ELECTRON_RUN_AS_NODE"]);
});

test("electronChildEnvironment は Windows の大文字小文字違いも外す（#27）", () => {
  const child = electronChildEnvironment({ electron_run_as_node: "1", Electron_Run_As_Node: "1", Path: "C:\\Windows" });
  assert.deepEqual(child, { Path: "C:\\Windows" });
});

test("tier 1 の Electron 子プロセスは親の ELECTRON_RUN_AS_NODE を継承しない（#27）", async () => {
  const root = await mkdtemp(join(tmpdir(), "osr-runner-"));
  try {
    const out = join(root, "video.mp4");
    const calls = [];
    await launchElectronExport({ tier: 1, executable: "/desktop" }, exportOptions(out), {
      spawnImpl: spawnMock({ calls, beforeClose: () => writeFile(out, "video") }),
      env: { ELECTRON_RUN_AS_NODE: "1", PATH: "/usr/bin" },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, "/desktop");
    assert.equal(calls[0].args[0], "--force-device-scale-factor=1");
    assert.equal("ELECTRON_RUN_AS_NODE" in calls[0].options.env, false);
    assert.equal(calls[0].options.env.PATH, "/usr/bin");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("tier 2 の Electron 子プロセスも ELECTRON_RUN_AS_NODE を外して spawn する（#27）", async () => {
  const root = await mkdtemp(join(tmpdir(), "osr-runner-"));
  try {
    const out = join(root, "video.mp4");
    const calls = [];
    await launchElectronExport({ tier: 2, executable: "/npm/electron" }, exportOptions(out), {
      spawnImpl: spawnMock({ calls, beforeClose: () => writeFile(out, "video") }),
      env: { ELECTRON_RUN_AS_NODE: "1", AKARI_OSR_VERIFY: "hash" },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, "/npm/electron");
    assert.match(calls[0].args[0], /electron-main\.mjs$/);
    assert.equal("ELECTRON_RUN_AS_NODE" in calls[0].options.env, false);
    assert.equal(calls[0].options.env.AKARI_OSR_VERIFY, "hash");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("env 未指定なら process.env から ELECTRON_RUN_AS_NODE を外して渡す（shim 経由の CLI 起動・#27）", async () => {
  const root = await mkdtemp(join(tmpdir(), "osr-runner-"));
  const previous = process.env.ELECTRON_RUN_AS_NODE;
  process.env.ELECTRON_RUN_AS_NODE = "1";
  try {
    const out = join(root, "video.mp4");
    const calls = [];
    await launchElectronExport({ tier: 1, executable: "/desktop" }, exportOptions(out), {
      spawnImpl: spawnMock({ calls, beforeClose: () => writeFile(out, "video") }),
    });
    assert.equal(calls.length, 1);
    assert.equal("ELECTRON_RUN_AS_NODE" in calls[0].options.env, false);
    assert.equal(calls[0].options.env.PATH, process.env.PATH);
    assert.equal(process.env.ELECTRON_RUN_AS_NODE, "1");
  } finally {
    if (previous === undefined) delete process.env.ELECTRON_RUN_AS_NODE;
    else process.env.ELECTRON_RUN_AS_NODE = previous;
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

// Windows のアプリ別 GPU 設定の一時上書き（gpu-preference.mjs・契約 §11.7）。registry / sidecar は注入し、順序を配列で固定する。
const WINDOWS_ELECTRON = "C:/wt/node_modules/electron/dist/electron.exe";
const WINDOWS_ELECTRON_NORMALIZED = "C:\\wt\\node_modules\\electron\\dist\\electron.exe";

function gpuPreferenceMocks(values = {}) {
  const log = [];
  let sidecarRecord = null;
  return {
    log,
    values,
    registry: {
      read(exe) { log.push(["read", exe]); return Object.hasOwn(values, exe) ? values[exe] : null; },
      write(exe, value) { log.push(["write", exe, value]); values[exe] = value; },
      remove(exe) { log.push(["remove", exe]); delete values[exe]; },
    },
    sidecar: {
      async read() { return sidecarRecord; },
      async write(record) { log.push(["sidecar", record.previous]); sidecarRecord = record; },
      async remove() { sidecarRecord = null; },
      get record() { return sidecarRecord; },
    },
    executableExists: () => true,
    stderr: { write() {} },
  };
}

test("win32・未設定・auto・GPU 出口: registry.write → spawn → registry.remove の順で、exe は \\ 区切りに正規化される（a・j・r1: exit gpu）", async () => {
  const root = await mkdtemp(join(tmpdir(), "osr-runner-gpu-pref-"));
  try {
    const out = join(root, "video.mp4");
    const mocks = gpuPreferenceMocks();
    const calls = [];
    const result = await launchElectronExport({ tier: 2, executable: WINDOWS_ELECTRON }, { ...exportOptions(out), exit: "gpu" }, {
      spawnImpl: spawnMock({ calls, beforeClose: async () => { mocks.log.push(["spawn"]); await writeFile(out, "video"); } }),
      env: { PATH: "/usr/bin" }, platform: "win32", ...mocks,
    });
    assert.deepEqual(mocks.log, [
      ["read", WINDOWS_ELECTRON_NORMALIZED],
      ["sidecar", null],
      ["write", WINDOWS_ELECTRON_NORMALIZED, "GpuPreference=2;"],
      ["spawn"],
      ["remove", WINDOWS_ELECTRON_NORMALIZED],
    ]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, WINDOWS_ELECTRON);
    assert.deepEqual(result.gpuPreference, {
      platform: "win32", policy: "auto", exit: "gpu", executable: WINDOWS_ELECTRON_NORMALIZED,
      applied: true, previous: null, restored: true, reason: "unset", recovered_stale: false,
    });
    assert.equal(mocks.sidecar.record, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("win32: 子が exit ≠ 0 でも spawn が error を emit しても restore は 1 回走る（h）", async () => {
  const root = await mkdtemp(join(tmpdir(), "osr-runner-gpu-pref-"));
  try {
    const out = join(root, "video.mp4");
    for (const spawnImpl of [spawnMock({ code: 1 }), spawnMock({ beforeClose: () => { throw new Error("spawn ENOENT"); } })]) {
      const mocks = gpuPreferenceMocks();
      await assert.rejects(
        launchElectronExport({ tier: 2, executable: WINDOWS_ELECTRON }, { ...exportOptions(out), exit: "gpu" }, { spawnImpl, env: {}, platform: "win32", ...mocks }),
        (error) => {
          assert.equal(error.gpuPreference.applied, true);
          assert.equal(error.gpuPreference.restored, true);
          return true;
        },
      );
      assert.deepEqual(mocks.log.filter(([name]) => name === "remove"), [["remove", WINDOWS_ELECTRON_NORMALIZED]]);
      assert.deepEqual(mocks.values, {});
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("win32: 利用者の GpuPreference=1; は auto で尊重し、force は復元まで行う（b・c）", async () => {
  const root = await mkdtemp(join(tmpdir(), "osr-runner-gpu-pref-"));
  try {
    const out = join(root, "video.mp4");
    const respected = gpuPreferenceMocks({ [WINDOWS_ELECTRON_NORMALIZED]: "GpuPreference=1;" });
    const auto = await launchElectronExport({ tier: 2, executable: WINDOWS_ELECTRON }, { ...exportOptions(out), exit: "gpu" }, {
      spawnImpl: spawnMock({ beforeClose: () => writeFile(out, "video") }), env: {}, platform: "win32", ...respected,
    });
    assert.equal(respected.log.filter(([name]) => name === "write" || name === "remove").length, 0);
    assert.equal(auto.gpuPreference.reason, "user-preference-respected");
    const forced = gpuPreferenceMocks({ [WINDOWS_ELECTRON_NORMALIZED]: "GpuPreference=1;" });
    const force = await launchElectronExport({ tier: 2, executable: WINDOWS_ELECTRON }, { ...exportOptions(out), gpuPreference: "force" }, {
      spawnImpl: spawnMock({ beforeClose: async () => { forced.log.push(["spawn"]); await writeFile(out, "video"); } }), env: {}, platform: "win32", ...forced,
    });
    assert.deepEqual(forced.log.filter(([name]) => name !== "read" && name !== "sidecar"), [
      ["write", WINDOWS_ELECTRON_NORMALIZED, "GpuPreference=2;"],
      ["spawn"],
      ["write", WINDOWS_ELECTRON_NORMALIZED, "GpuPreference=1;"],
    ]);
    assert.equal(forced.values[WINDOWS_ELECTRON_NORMALIZED], "GpuPreference=1;");
    assert.deepEqual([force.gpuPreference.applied, force.gpuPreference.previous, force.gpuPreference.restored], [true, "GpuPreference=1;", true]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("darwin / linux / soft / off / OSR 出口の auto は registry に触らず理由だけ記録し、spawn 引数は従来どおり（e・f・g・r1: not-gpu-exit を追加）", async () => {
  const root = await mkdtemp(join(tmpdir(), "osr-runner-gpu-pref-"));
  try {
    const out = join(root, "video.mp4");
    const cases = [
      { platform: "darwin", options: {}, env: {}, reason: "platform" },
      { platform: "linux", options: { exit: "gpu" }, env: {}, reason: "platform" },
      { platform: "win32", options: { soft: true, exit: "gpu" }, env: {}, reason: "soft" },
      { platform: "win32", options: { exit: "gpu" }, env: { AKARI_EXPORT_GPU_PREFERENCE: "off" }, reason: "policy-off" },
      { platform: "win32", options: { exit: "osr" }, env: {}, reason: "not-gpu-exit" },
      { platform: "win32", options: {}, env: {}, reason: "not-gpu-exit" },
    ];
    for (const { platform, options, env, reason } of cases) {
      const mocks = gpuPreferenceMocks();
      const calls = [];
      const result = await launchElectronExport({ tier: 2, executable: WINDOWS_ELECTRON }, { ...exportOptions(out), ...options }, {
        spawnImpl: spawnMock({ calls, beforeClose: () => writeFile(out, "video") }), env, platform, ...mocks,
      });
      assert.equal(mocks.log.filter(([name]) => name === "write" || name === "remove").length, 0, `${platform}/${reason}`);
      assert.equal(result.gpuPreference.reason, reason);
      assert.equal(result.gpuPreference.applied, false);
      assert.deepEqual(calls[0].args, buildElectronArguments({ tier: 2, executable: WINDOWS_ELECTRON }, { ...exportOptions(out), ...options }));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("win32: 冒頭に stale な sidecar があれば先に復元して recovered_stale: true（i）", async () => {
  const root = await mkdtemp(join(tmpdir(), "osr-runner-gpu-pref-"));
  try {
    const out = join(root, "video.mp4");
    const mocks = gpuPreferenceMocks({ [WINDOWS_ELECTRON_NORMALIZED]: "GpuPreference=2;" });
    await mocks.sidecar.write({ version: 1, executable: WINDOWS_ELECTRON_NORMALIZED, previous: null, written_at: "2026-08-31T00:00:00.000Z" });
    mocks.log.length = 0;
    const result = await launchElectronExport({ tier: 2, executable: WINDOWS_ELECTRON }, { ...exportOptions(out), exit: "gpu" }, {
      spawnImpl: spawnMock({ beforeClose: async () => { mocks.log.push(["spawn"]); await writeFile(out, "video"); } }), env: {}, platform: "win32", ...mocks,
    });
    assert.deepEqual(mocks.log.slice(0, 2), [["read", WINDOWS_ELECTRON_NORMALIZED], ["remove", WINDOWS_ELECTRON_NORMALIZED]]);
    assert.equal(result.gpuPreference.recovered_stale, true);
    assert.equal(result.gpuPreference.applied, true);
    assert.deepEqual(mocks.values, {});
    assert.equal(mocks.sidecar.record, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("不正な gpuPreference は spawn 前に許容値付きで throw する（k）", async () => {
  const mocks = gpuPreferenceMocks();
  await assert.rejects(
    launchElectronExport({ tier: 2, executable: WINDOWS_ELECTRON }, { ...exportOptions("/out.mp4"), gpuPreference: "always" }, {
      spawnImpl: () => assert.fail("must not spawn"), env: {}, platform: "win32", ...mocks,
    }),
    /gpuPreference must be one of auto\|off\|force, got: always/u,
  );
  await assert.rejects(
    launchElectronExport({ tier: 2, executable: WINDOWS_ELECTRON }, exportOptions("/out.mp4"), {
      spawnImpl: () => assert.fail("must not spawn"), env: { AKARI_EXPORT_GPU_PREFERENCE: "yes" }, platform: "darwin", ...mocks,
    }),
    /gpuPreference must be one of auto\|off\|force, got: yes/u,
  );
});

test("AKARI_EXPORT_ALLOW_DESKTOP=0 は tier 1 候補を飛ばし、明示 allowDesktop: true が env に勝つ（l）", async () => {
  // npm electron 無し（resolveElectron → null）で tier 1 が候補に残るか（tier 1）飛ぶか（tier 3）だけを見る。
  const probe = async (path) => path === "/desktop";
  const skipped = await resolveElectronLauncher({
    env: { AKARI_OSR_ELECTRON: "/desktop", AKARI_EXPORT_ALLOW_DESKTOP: "0" }, platform: "linux", homeDirectory: "/home/test",
    probe, resolveElectron: () => null,
  });
  assert.equal(skipped.tier, 3);
  assert.equal(skipped.reason, "Electron unavailable");
  const explicit = await resolveElectronLauncher({
    allowDesktop: true,
    env: { AKARI_OSR_ELECTRON: "/desktop", AKARI_EXPORT_ALLOW_DESKTOP: "0" }, platform: "linux", homeDirectory: "/home/test",
    probe, resolveElectron: () => null,
  });
  assert.equal(explicit.tier, 1);
  const untouched = await resolveElectronLauncher({
    env: { AKARI_OSR_ELECTRON: "/desktop", AKARI_EXPORT_ALLOW_DESKTOP: "1" }, platform: "linux", homeDirectory: "/home/test",
    probe, resolveElectron: () => null,
  });
  assert.equal(untouched.tier, 1);
  const stillOptOut = await resolveElectronLauncher({
    allowDesktop: false,
    env: { AKARI_OSR_ELECTRON: "/desktop" }, platform: "linux", homeDirectory: "/home/test",
    probe, resolveElectron: () => null,
  });
  assert.equal(stillOptOut.tier, 3);
});

test("win32: OSR 出口（exit osr）の auto は registry に書かず、記録は applied false / not-gpu-exit / exit osr。force なら書いて復元（n・r1 裁定 1 改訂）", async () => {
  const root = await mkdtemp(join(tmpdir(), "osr-runner-gpu-pref-"));
  try {
    const out = join(root, "video.mp4");
    const mocks = gpuPreferenceMocks();
    const calls = [];
    const result = await launchElectronExport({ tier: 2, executable: WINDOWS_ELECTRON }, { ...exportOptions(out), exit: "osr" }, {
      spawnImpl: spawnMock({ calls, beforeClose: () => writeFile(out, "video") }), env: {}, platform: "win32", ...mocks,
    });
    assert.equal(mocks.log.filter(([name]) => name === "write" || name === "remove" || name === "sidecar").length, 0);
    assert.equal(calls.length, 1);
    assert.deepEqual(result.gpuPreference, {
      platform: "win32", policy: "auto", exit: "osr", executable: WINDOWS_ELECTRON_NORMALIZED,
      applied: false, previous: null, restored: null, reason: "not-gpu-exit", recovered_stale: false,
    });
    const forced = gpuPreferenceMocks();
    const force = await launchElectronExport({ tier: 2, executable: WINDOWS_ELECTRON }, { ...exportOptions(out), exit: "osr", gpuPreference: "force" }, {
      spawnImpl: spawnMock({ beforeClose: async () => { forced.log.push(["spawn"]); await writeFile(out, "video"); } }), env: {}, platform: "win32", ...forced,
    });
    assert.deepEqual(forced.log.filter(([name]) => name !== "read" && name !== "sidecar"), [
      ["write", WINDOWS_ELECTRON_NORMALIZED, "GpuPreference=2;"],
      ["spawn"],
      ["remove", WINDOWS_ELECTRON_NORMALIZED],
    ]);
    assert.deepEqual([force.gpuPreference.exit, force.gpuPreference.applied, force.gpuPreference.restored], ["osr", true, true]);
    assert.deepEqual(forced.values, {});
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
