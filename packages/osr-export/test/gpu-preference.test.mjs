import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createRegistryAccess,
  createSidecarAccess,
  GPU_PREFERENCE_SIDECAR_NAME,
  HIGH_PERFORMANCE_GPU_PREFERENCE,
  normalizeGpuPreferenceExecutable,
  normalizeGpuPreferenceRecord,
  parseRegQueryValue,
  planGpuPreference,
  recoverStaleGpuPreference,
  resolveAkariHome,
  resolveGpuPreferencePolicy,
  USER_GPU_PREFERENCES_KEY,
  withGpuPreference,
} from "../src/gpu-preference.mjs";

const EXE = "C:\\akari\\node_modules\\electron\\dist\\electron.exe";
const HIGH = HIGH_PERFORMANCE_GPU_PREFERENCE;
const POWER_SAVING = "GpuPreference=1;";

// 呼び出し順を配列で固定するための registry / sidecar モック。registry.read は values（exe → 値）を見る。
function fakeRegistry(values = {}, { log = [], failRemove = false, failWrite = false } = {}) {
  return {
    log,
    values,
    read(exe) { log.push(["read", exe]); return Object.hasOwn(values, exe) ? values[exe] : null; },
    write(exe, value) {
      log.push(["write", exe, value]);
      if (failWrite) throw new Error("reg add exited 1: access denied");
      values[exe] = value;
    },
    remove(exe) {
      log.push(["remove", exe]);
      if (failRemove) throw new Error("reg delete exited 1: access denied");
      delete values[exe];
    },
  };
}

function fakeSidecar({ log = [], record = null } = {}) {
  const state = { record };
  return {
    log,
    state,
    async read() { log.push(["sidecar.read"]); return state.record; },
    async write(value) { log.push(["sidecar.write", value]); state.record = value; },
    async remove() { log.push(["sidecar.remove"]); state.record = null; },
  };
}

function deps(overrides = {}) {
  return {
    env: {},
    platform: "win32",
    executableExists: () => true,
    stderr: { write() {} },
    now: () => "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

test("policy は options → env → auto の順に解決し、不正値は許容値を含めて throw する（k）", () => {
  assert.equal(resolveGpuPreferencePolicy({}, {}), "auto");
  assert.equal(resolveGpuPreferencePolicy({}, { AKARI_EXPORT_GPU_PREFERENCE: "off" }), "off");
  assert.equal(resolveGpuPreferencePolicy({ gpuPreference: "force" }, { AKARI_EXPORT_GPU_PREFERENCE: "off" }), "force");
  assert.equal(resolveGpuPreferencePolicy({ gpuPreference: "" }, { AKARI_EXPORT_GPU_PREFERENCE: "" }), "auto");
  assert.throws(() => resolveGpuPreferencePolicy({ gpuPreference: "always" }, {}), /auto\|off\|force.*always/u);
  assert.throws(() => resolveGpuPreferencePolicy({}, { AKARI_EXPORT_GPU_PREFERENCE: "1" }), /auto\|off\|force.*got: 1/u);
});

test("判定表: 未設定 + auto は GPU 出口なら書いて終了後に削除する（a・r1: auto は exit gpu だけに適用）", () => {
  assert.deepEqual(planGpuPreference({ platform: "win32", policy: "auto", soft: false, current: null, exit: "gpu" }), {
    action: "write", value: HIGH, restore: { kind: "remove" }, reason: "unset",
  });
});

test("判定表: 利用者の明示設定（省電力）は GPU 出口の auto でも上書きしない（b・r1: exit gpu を明示）", () => {
  assert.deepEqual(planGpuPreference({ platform: "win32", policy: "auto", soft: false, current: POWER_SAVING, exit: "gpu" }), {
    action: "skip", value: null, restore: null, reason: "user-preference-respected",
  });
});

test("判定表: force は書いて終了後に元の値へ戻す（c）", () => {
  assert.deepEqual(planGpuPreference({ platform: "win32", policy: "force", soft: false, current: POWER_SAVING }), {
    action: "write", value: HIGH, restore: { kind: "write", value: POWER_SAVING }, reason: "forced",
  });
});

test("判定表: 既に高パフォーマンスなら auto / force とも触らない（d・r1: GPU 出口で判定）", () => {
  for (const policy of ["auto", "force"]) {
    assert.deepEqual(planGpuPreference({ platform: "win32", policy, soft: false, current: HIGH, exit: "gpu" }), {
      action: "skip", value: null, restore: null, reason: "already-high-performance",
    });
  }
});

test("判定表: off / 他 OS / soft は理由付きで skip する（e・f・g）", () => {
  assert.equal(planGpuPreference({ platform: "win32", policy: "off", soft: false, current: null }).reason, "policy-off");
  assert.equal(planGpuPreference({ platform: "darwin", policy: "auto", soft: false, current: null }).reason, "platform");
  assert.equal(planGpuPreference({ platform: "linux", policy: "force", soft: false, current: null }).reason, "platform");
  assert.equal(planGpuPreference({ platform: "win32", policy: "auto", soft: true, current: null }).reason, "soft");
  assert.equal(planGpuPreference({ platform: "win32", policy: "force", soft: true, current: POWER_SAVING }).action, "skip");
});

test("withGpuPreference: win32・未設定・auto・GPU 出口は write → run → remove の順で、記録は applied / previous null / restored（a・r1: exit gpu）", async () => {
  const log = [];
  const registry = fakeRegistry({}, { log });
  const sidecar = fakeSidecar({ log });
  const { result, gpuPreference } = await withGpuPreference({ executable: EXE }, { exit: "gpu" }, async () => {
    log.push(["spawn"]);
    return "ran";
  }, deps({ registry, sidecar }));
  assert.equal(result, "ran");
  assert.deepEqual(log, [
    ["sidecar.read"],
    ["read", EXE],
    ["sidecar.write", { version: 1, executable: EXE, previous: null, written_at: "2026-09-01T00:00:00.000Z" }],
    ["write", EXE, HIGH],
    ["spawn"],
    ["remove", EXE],
    ["sidecar.remove"],
  ]);
  assert.deepEqual(gpuPreference, {
    platform: "win32", policy: "auto", exit: "gpu", executable: EXE, applied: true, previous: null, restored: true, reason: "unset", recovered_stale: false,
  });
  assert.deepEqual(registry.values, {});
  assert.equal(sidecar.state.record, null);
});

test("withGpuPreference: GpuPreference=1; + auto（GPU 出口）は 0 回書き込みで user-preference-respected（b・r1: exit gpu）", async () => {
  const log = [];
  const registry = fakeRegistry({ [EXE]: POWER_SAVING }, { log });
  const { gpuPreference } = await withGpuPreference({ executable: EXE }, { exit: "gpu" }, async () => "ran", deps({ registry, sidecar: fakeSidecar({ log }) }));
  assert.equal(log.filter(([name]) => name === "write" || name === "remove").length, 0);
  assert.equal(gpuPreference.applied, false);
  assert.equal(gpuPreference.previous, POWER_SAVING);
  assert.equal(gpuPreference.reason, "user-preference-respected");
  assert.equal(gpuPreference.restored, null);
});

test("withGpuPreference: GpuPreference=1; + force は write → run → write(元の値) で復元する（c）", async () => {
  const log = [];
  const registry = fakeRegistry({ [EXE]: POWER_SAVING }, { log });
  const { gpuPreference } = await withGpuPreference({ executable: EXE }, { gpuPreference: "force" }, async () => {
    log.push(["spawn"]);
    assert.equal(registry.values[EXE], HIGH);
  }, deps({ registry, sidecar: fakeSidecar({ log }) }));
  const writes = log.filter(([name]) => name === "write" || name === "remove" || name === "spawn");
  assert.deepEqual(writes, [["write", EXE, HIGH], ["spawn"], ["write", EXE, POWER_SAVING]]);
  assert.equal(registry.values[EXE], POWER_SAVING);
  assert.deepEqual({ applied: gpuPreference.applied, previous: gpuPreference.previous, restored: gpuPreference.restored, reason: gpuPreference.reason },
    { applied: true, previous: POWER_SAVING, restored: true, reason: "forced" });
});

test("withGpuPreference: 既に GpuPreference=2; なら 0 回書き込みで already-high-performance（d）", async () => {
  const log = [];
  const registry = fakeRegistry({ [EXE]: HIGH }, { log });
  const { gpuPreference } = await withGpuPreference({ executable: EXE }, { gpuPreference: "force" }, async () => "ran", deps({ registry, sidecar: fakeSidecar({ log }) }));
  assert.equal(log.filter(([name]) => name === "write" || name === "remove").length, 0);
  assert.equal(gpuPreference.reason, "already-high-performance");
  assert.equal(registry.values[EXE], HIGH);
});

test("withGpuPreference: off は registry を読みもせず policy-off で run する（e）", async () => {
  const log = [];
  const registry = fakeRegistry({}, { log });
  const { gpuPreference } = await withGpuPreference({ executable: EXE }, {}, async () => "ran", deps({ registry, sidecar: fakeSidecar({ log }), env: { AKARI_EXPORT_GPU_PREFERENCE: "off" } }));
  assert.deepEqual(log, [["sidecar.read"]]);
  assert.equal(gpuPreference.policy, "off");
  assert.equal(gpuPreference.reason, "policy-off");
  assert.equal(gpuPreference.applied, false);
});

test("withGpuPreference: darwin / linux は registry にも sidecar にも触らず platform で run する（f）", async () => {
  for (const platform of ["darwin", "linux"]) {
    const log = [];
    const registry = fakeRegistry({}, { log });
    const { result, gpuPreference } = await withGpuPreference({ executable: "/Applications/AKARI Video.app/Contents/MacOS/AKARI Video" }, {}, async () => "ran", deps({ registry, sidecar: fakeSidecar({ log }), platform }));
    assert.equal(result, "ran");
    assert.deepEqual(log, []);
    assert.deepEqual(gpuPreference, {
      platform, policy: "auto", exit: "osr", executable: null, applied: false, previous: null, restored: null, reason: "platform", recovered_stale: false,
    });
  }
});

test("withGpuPreference: soft は 0 回書き込みで soft（g）", async () => {
  const log = [];
  const registry = fakeRegistry({}, { log });
  const { gpuPreference } = await withGpuPreference({ executable: EXE }, { soft: true }, async () => "ran", deps({ registry, sidecar: fakeSidecar({ log }) }));
  assert.equal(log.filter(([name]) => name !== "sidecar.read").length, 0);
  assert.equal(gpuPreference.reason, "soft");
});

test("withGpuPreference: run が reject しても restore は 1 回走り、error に記録が付く（h）", async () => {
  const log = [];
  const registry = fakeRegistry({}, { log });
  const sidecar = fakeSidecar({ log });
  const failure = new Error("OSR Electron exited 1 (no signal)");
  await assert.rejects(
    withGpuPreference({ executable: EXE }, { exit: "gpu" }, async () => { throw failure; }, deps({ registry, sidecar })),
    (error) => {
      assert.equal(error, failure);
      assert.equal(error.gpuPreference.applied, true);
      assert.equal(error.gpuPreference.restored, true);
      return true;
    },
  );
  assert.deepEqual(log.filter(([name]) => name === "remove"), [["remove", EXE]]);
  assert.deepEqual(registry.values, {});
  assert.equal(sidecar.state.record, null);
});

test("withGpuPreference: 復元に失敗しても throw せず warning + restored: false・sidecar は残す（裁定 5）", async () => {
  const log = [];
  const warnings = [];
  const registry = fakeRegistry({}, { log, failRemove: true });
  const sidecar = fakeSidecar({ log });
  const { gpuPreference } = await withGpuPreference({ executable: EXE }, { exit: "gpu" }, async () => "ran", deps({ registry, sidecar, stderr: { write: (text) => warnings.push(text) } }));
  assert.equal(gpuPreference.applied, true);
  assert.equal(gpuPreference.restored, false);
  assert.match(warnings.join(""), /^\[gpu-preference\] restore failed: /u);
  assert.notEqual(sidecar.state.record, null);
});

test("withGpuPreference: 冒頭の stale sidecar（previous null）は先に削除し recovered_stale: true（i）", async () => {
  const log = [];
  const registry = fakeRegistry({ [EXE]: HIGH }, { log });
  const sidecar = fakeSidecar({ log, record: { version: 1, executable: EXE, previous: null, written_at: "2026-08-31T00:00:00.000Z" } });
  const { gpuPreference } = await withGpuPreference({ executable: EXE }, { exit: "gpu" }, async () => { log.push(["spawn"]); }, deps({ registry, sidecar }));
  assert.deepEqual(log.slice(0, 4), [["sidecar.read"], ["read", EXE], ["remove", EXE], ["sidecar.remove"]]);
  assert.ok(log.some(([name]) => name === "spawn"));
  assert.equal(gpuPreference.recovered_stale, true);
  // 回復後は「未設定」なので通常どおり write → spawn → remove して終わる
  assert.equal(gpuPreference.applied, true);
  assert.equal(gpuPreference.previous, null);
  assert.deepEqual(registry.values, {});
});

test("withGpuPreference: stale sidecar（previous あり）は元の値を書き戻す（i）", async () => {
  const log = [];
  const registry = fakeRegistry({ [EXE]: HIGH }, { log });
  const sidecar = fakeSidecar({ log, record: { version: 1, executable: EXE, previous: POWER_SAVING, written_at: "2026-08-31T00:00:00.000Z" } });
  const { gpuPreference } = await withGpuPreference({ executable: EXE }, { exit: "gpu" }, async () => "ran", deps({ registry, sidecar }));
  assert.deepEqual(log.slice(0, 4), [["sidecar.read"], ["read", EXE], ["write", EXE, POWER_SAVING], ["sidecar.remove"]]);
  assert.equal(gpuPreference.recovered_stale, true);
  assert.equal(gpuPreference.reason, "user-preference-respected");
  assert.equal(registry.values[EXE], POWER_SAVING);
});

test("recoverStaleGpuPreference: 壊れた sidecar は捨て、値が既に無ければ削除を試みない", async () => {
  const log = [];
  const registry = fakeRegistry({}, { log });
  const broken = fakeSidecar({ log, record: { version: 99 } });
  assert.equal(await recoverStaleGpuPreference({ sidecar: broken, registry, stderr: { write() {} } }), false);
  assert.equal(broken.state.record, null);
  const clean = fakeSidecar({ log, record: { version: 1, executable: EXE, previous: null } });
  assert.equal(await recoverStaleGpuPreference({ sidecar: clean, registry, stderr: { write() {} } }), true);
  assert.equal(log.filter(([name]) => name === "remove" || name === "write").length, 0);
});

test("exe パスは / 混じりでも Windows 設定アプリの形式（\\ 区切りフルパス）へ正規化する（j）", () => {
  assert.equal(normalizeGpuPreferenceExecutable("C:/akari/node_modules/electron/dist/electron.exe"), EXE);
  assert.equal(normalizeGpuPreferenceExecutable("C:\\akari\\node_modules\\electron\\dist\\..\\dist\\electron.exe"), EXE);
  assert.throws(() => normalizeGpuPreferenceExecutable(""), /executable is required/u);
});

test("reg query の出力は値の部分だけを読み、値名のマルチバイトや文字化けに影響されない（j）", () => {
  const output = [
    "",
    "HKEY_CURRENT_USER\\Software\\Microsoft\\DirectX\\UserGpuPreferences",
    "    D:\\\u5c71\u7530 \u592a\u90ce\\AppData\\Local\\Programs\\@akari-videoshell\\AKARI Video.exe    REG_SZ    GpuPreference=2;",
    "",
  ].join("\r\n");
  assert.equal(parseRegQueryValue(output), HIGH);
  const mojibake = "    D:\\\u00e5\u00b1\u00b1\u00e7\u0094\u00b0\\electron.exe    REG_SZ    GpuPreference=1;\r\n";
  assert.equal(parseRegQueryValue(mojibake), POWER_SAVING);
  assert.equal(parseRegQueryValue("    C:\\x\\electron.exe    REG_SZ    \r\n"), "");
  assert.equal(parseRegQueryValue("ERROR: The system was unable to find the specified registry key or value."), null);
  assert.equal(parseRegQueryValue(""), null);
});

test("既定の registry access は %SystemRoot%\\System32\\reg.exe を query / add / delete で叩き、非 0 の query は null", () => {
  const calls = [];
  const spawnSync = (command, args) => {
    calls.push([command, ...args]);
    if (args[0] === "query") {
      return calls.length === 1
        ? { status: 1, stdout: Buffer.from(""), stderr: Buffer.from("ERROR: not found") }
        : { status: 0, stdout: Buffer.from(`\r\n${USER_GPU_PREFERENCES_KEY}\r\n    ${EXE}    REG_SZ    GpuPreference=2;\r\n`, "latin1"), stderr: Buffer.alloc(0) };
    }
    return { status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  };
  const registry = createRegistryAccess({ spawnSync, systemRoot: "C:\\Windows" });
  assert.equal(registry.command, "C:\\Windows\\System32\\reg.exe");
  assert.equal(registry.read(EXE), null);
  registry.write(EXE, HIGH);
  assert.equal(registry.read(EXE), HIGH);
  registry.remove(EXE);
  assert.deepEqual(calls, [
    ["C:\\Windows\\System32\\reg.exe", "query", USER_GPU_PREFERENCES_KEY, "/v", EXE],
    ["C:\\Windows\\System32\\reg.exe", "add", USER_GPU_PREFERENCES_KEY, "/v", EXE, "/t", "REG_SZ", "/d", HIGH, "/f"],
    ["C:\\Windows\\System32\\reg.exe", "query", USER_GPU_PREFERENCES_KEY, "/v", EXE],
    ["C:\\Windows\\System32\\reg.exe", "delete", USER_GPU_PREFERENCES_KEY, "/v", EXE, "/f"],
  ]);
  const failing = createRegistryAccess({ spawnSync: () => ({ status: 1, stdout: Buffer.alloc(0), stderr: Buffer.from("ERROR: Access is denied.") }), systemRoot: "C:\\Windows" });
  assert.throws(() => failing.write(EXE, HIGH), /reg add exited 1: ERROR: Access is denied\./u);
  assert.throws(() => failing.remove(EXE), /reg delete exited 1/u);
});

test("sidecar は <AKARI_HOME ?? ~/.akari>/gpu-preference-override.json に version 1 で書き、削除できる（裁定 6）", async () => {
  const root = await mkdtemp(join(tmpdir(), "gpu-preference-sidecar-"));
  try {
    assert.equal(resolveAkariHome({}, "/home/test"), join("/home/test", ".akari"));
    assert.equal(resolveAkariHome({ AKARI_HOME: root }, "/home/test"), root);
    const sidecar = createSidecarAccess({ env: { AKARI_HOME: root } });
    assert.equal(sidecar.path, join(root, GPU_PREFERENCE_SIDECAR_NAME));
    assert.equal(await sidecar.read(), null);
    await sidecar.write({ version: 1, executable: EXE, previous: null, written_at: "2026-09-01T00:00:00.000Z" });
    assert.deepEqual(JSON.parse(await readFile(sidecar.path, "utf8")), { version: 1, executable: EXE, previous: null, written_at: "2026-09-01T00:00:00.000Z" });
    assert.deepEqual(await sidecar.read(), { version: 1, executable: EXE, previous: null, written_at: "2026-09-01T00:00:00.000Z" });
    await writeFile(sidecar.path, "{not json", "utf8");
    assert.equal(await sidecar.read(), null);
    await sidecar.remove();
    assert.equal(await sidecar.read(), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("receipt 用の正規化は snake_case 7 項目（exit 込み・q）だけを残し、記録が無ければ null", () => {
  assert.equal(normalizeGpuPreferenceRecord(undefined), null);
  assert.equal(normalizeGpuPreferenceRecord(null), null);
  assert.deepEqual(normalizeGpuPreferenceRecord({
    platform: "win32", policy: "auto", exit: "gpu", executable: EXE, applied: true, previous: null, restored: true, reason: "unset", recovered_stale: false,
  }), { policy: "auto", exit: "gpu", applied: true, previous: null, restored: true, reason: "unset", recovered_stale: false });
  assert.deepEqual(normalizeGpuPreferenceRecord({ policy: "off", reason: "policy-off" }), {
    policy: "off", exit: null, applied: false, previous: null, restored: null, reason: "policy-off", recovered_stale: false,
  });
  assert.equal(normalizeGpuPreferenceRecord({ policy: "auto", exit: "unknown" }).exit, null);
});

import { normalizeGpuPreferenceExit } from "../src/gpu-preference.mjs";

test("判定表: OSR 出口は auto では書かず（not-gpu-exit）、force なら書いて元へ戻す（m・r1 裁定 1 改訂）", () => {
  assert.deepEqual(planGpuPreference({ platform: "win32", policy: "auto", soft: false, current: null, exit: "osr" }), {
    action: "skip", value: null, restore: null, reason: "not-gpu-exit",
  });
  assert.equal(planGpuPreference({ platform: "win32", policy: "auto", soft: false, current: POWER_SAVING, exit: "osr" }).reason, "not-gpu-exit");
  assert.equal(planGpuPreference({ platform: "win32", policy: "auto", soft: false, current: HIGH, exit: "osr" }).reason, "not-gpu-exit");
  // exit 未指定 / 不明は保守的に osr 扱い
  assert.equal(planGpuPreference({ platform: "win32", policy: "auto", soft: false, current: null }).reason, "not-gpu-exit");
  assert.equal(planGpuPreference({ platform: "win32", policy: "auto", soft: false, current: null, exit: "unknown" }).reason, "not-gpu-exit");
  // force は出口に関係なく write + 復元（restore は current に応じて remove / write）
  assert.deepEqual(planGpuPreference({ platform: "win32", policy: "force", soft: false, current: null, exit: "osr" }), {
    action: "write", value: HIGH, restore: { kind: "remove" }, reason: "unset",
  });
  assert.deepEqual(planGpuPreference({ platform: "win32", policy: "force", soft: false, current: POWER_SAVING, exit: "osr" }), {
    action: "write", value: HIGH, restore: { kind: "write", value: POWER_SAVING }, reason: "forced",
  });
  assert.equal(planGpuPreference({ platform: "win32", policy: "force", soft: false, current: HIGH, exit: "osr" }).reason, "already-high-performance");
  // GPU 出口の auto + 未設定は従来どおり write
  assert.equal(planGpuPreference({ platform: "win32", policy: "auto", soft: false, current: null, exit: "gpu" }).action, "write");
  // off / platform / soft は not-gpu-exit より先に判定される
  assert.equal(planGpuPreference({ platform: "win32", policy: "off", soft: false, current: null, exit: "osr" }).reason, "policy-off");
  assert.equal(planGpuPreference({ platform: "darwin", policy: "auto", soft: false, current: null, exit: "osr" }).reason, "platform");
  assert.equal(planGpuPreference({ platform: "win32", policy: "auto", soft: true, current: null, exit: "osr" }).reason, "soft");
  assert.equal(normalizeGpuPreferenceExit(undefined), "osr");
  assert.equal(normalizeGpuPreferenceExit("gpu"), "gpu");
});

test("withGpuPreference: OSR 出口の auto は registry に書かず not-gpu-exit・exit osr を記録、force なら write → run → 復元（n・r1）", async () => {
  const log = [];
  const registry = fakeRegistry({}, { log });
  const sidecar = fakeSidecar({ log });
  const { result, gpuPreference } = await withGpuPreference({ executable: EXE }, { exit: "osr" }, async () => "ran", deps({ registry, sidecar }));
  assert.equal(result, "ran");
  assert.equal(log.filter(([name]) => name === "write" || name === "remove").length, 0);
  assert.deepEqual(gpuPreference, {
    platform: "win32", policy: "auto", exit: "osr", executable: EXE, applied: false, previous: null, restored: null, reason: "not-gpu-exit", recovered_stale: false,
  });
  // exit 未指定も同じ
  const unspecified = await withGpuPreference({ executable: EXE }, {}, async () => "ran", deps({ registry, sidecar }));
  assert.equal(unspecified.gpuPreference.reason, "not-gpu-exit");
  assert.equal(unspecified.gpuPreference.exit, "osr");
  // force は OSR 出口でも write → spawn → remove
  log.length = 0;
  const forced = await withGpuPreference({ executable: EXE }, { exit: "osr", gpuPreference: "force" }, async () => { log.push(["spawn"]); }, deps({ registry, sidecar }));
  assert.deepEqual(log.filter(([name]) => ["write", "spawn", "remove"].includes(name)), [["write", EXE, HIGH], ["spawn"], ["remove", EXE]]);
  assert.deepEqual(
    { exit: forced.gpuPreference.exit, applied: forced.gpuPreference.applied, restored: forced.gpuPreference.restored, reason: forced.gpuPreference.reason },
    { exit: "osr", applied: true, restored: true, reason: "unset" },
  );
  assert.deepEqual(registry.values, {});
});
