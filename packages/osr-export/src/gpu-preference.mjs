// Windows のハイブリッド GPU 機で、書き出し子プロセス（gpu / osr 共通の Electron）を高パフォーマンス GPU に載せる。
//
// 事実（osr 契約 §11.7・2026-09-01 実測）: Chromium のスイッチ（--force_high_performance_gpu / --use-adapter-luid）は
// ANGLE / WebGL を dGPU に移すだけで、WebCodecs の Media Foundation H.264 エンコーダは iGPU 側のまま unsupported になる。
// 効くのは OS のアプリ別 GPU 設定（HKCU\Software\Microsoft\DirectX\UserGpuPreferences・値名 = exe フルパス・
// `GpuPreference=2;`）だけで、プロセス生成時に評価されるので spawn 直前に書けば再起動も管理者権限も要らない。
// 値は exe 単位で残るとアプリ本体まで次回起動から dGPU になるため、書き出しの間だけ一時上書きして終了後に元へ戻す。
// 親が途中で死んでも戻せるよう sidecar（<AKARI_HOME ?? ~/.akari>/gpu-preference-override.json）を書き、次回起動時に先に復元する。
import { spawnSync as defaultSpawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, win32 } from "node:path";

export const GPU_PREFERENCE_POLICIES = Object.freeze(["auto", "off", "force"]);
export const GPU_PREFERENCE_ENV = "AKARI_EXPORT_GPU_PREFERENCE";
export const HIGH_PERFORMANCE_GPU_PREFERENCE = "GpuPreference=2;";
export const USER_GPU_PREFERENCES_KEY = "HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences";
export const GPU_PREFERENCE_SIDECAR_NAME = "gpu-preference-override.json";
const RESTORE_WARNING_PREFIX = "[gpu-preference]";

// 方針値の解決: 呼び出し側の options.gpuPreference → env AKARI_EXPORT_GPU_PREFERENCE → "auto"。空文字は未指定と同じ。
export function resolveGpuPreferencePolicy(options = {}, env = process.env) {
  const explicit = presentString(options?.gpuPreference);
  const fromEnv = presentString(env?.[GPU_PREFERENCE_ENV]);
  const policy = explicit ?? fromEnv ?? "auto";
  if (!GPU_PREFERENCE_POLICIES.includes(policy)) {
    throw new Error(`gpuPreference must be one of ${GPU_PREFERENCE_POLICIES.join("|")}, got: ${policy}`);
  }
  return policy;
}

// 判定表（osr 契約 §11.7 裁定 4）。純関数。
export function planGpuPreference({ platform, policy, soft = false, current = null }) {
  if (platform !== "win32") return skip("platform");
  if (soft) return skip("soft");
  if (policy === "off") return skip("policy-off");
  const value = current === undefined ? null : current;
  if (value === HIGH_PERFORMANCE_GPU_PREFERENCE) return skip("already-high-performance");
  if (value === null) {
    return { action: "write", value: HIGH_PERFORMANCE_GPU_PREFERENCE, restore: { kind: "remove" }, reason: "unset" };
  }
  // 利用者が Windows の「グラフィックスの設定」で明示した値（省電力 = GpuPreference=1; 等）は auto では黙って上書きしない。
  if (policy === "auto") return skip("user-preference-respected");
  return { action: "write", value: HIGH_PERFORMANCE_GPU_PREFERENCE, restore: { kind: "write", value }, reason: "forced" };
}

function skip(reason) {
  return { action: "skip", value: null, restore: null, reason };
}

// 対象 exe = launcher.executable を Windows 設定アプリが書く形式（`\` 区切りのフルパス）へ正規化する。
export function normalizeGpuPreferenceExecutable(executable) {
  if (typeof executable !== "string" || executable === "") {
    throw new Error("gpu-preference: launcher executable is required");
  }
  return win32.resolve(executable);
}

// `reg query` の出力から値の部分だけを取り出す。値名（exe パス）にマルチバイトが混ざって文字化けしても
// `REG_SZ    GpuPreference=2;` の ASCII 部分は壊れないので、行末から型名 + データだけを読む。
export function parseRegQueryValue(text) {
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/u, "");
    const match = line.match(/\s(REG_[A-Z_]+)\s+(.*)$/u) ?? line.match(/\s(REG_[A-Z_]+)$/u);
    if (match) return (match[2] ?? "").trim();
  }
  return null;
}

// %SystemRoot%\System32\reg.exe を spawnSync で叩く既定のレジストリアクセス。ネイティブモジュールは使わない。
export function createRegistryAccess({ spawnSync = defaultSpawnSync, systemRoot = null, env = process.env } = {}) {
  const root = presentString(systemRoot) ?? presentString(env?.SystemRoot) ?? presentString(env?.SYSTEMROOT) ?? "C:\\Windows";
  const command = win32.join(root, "System32", "reg.exe");
  const run = (args) => {
    const result = spawnSync(command, args, { encoding: "buffer", windowsHide: true });
    if (result.error) throw result.error;
    return {
      status: result.status,
      stdout: Buffer.isBuffer(result.stdout) ? result.stdout.toString("latin1") : String(result.stdout ?? ""),
      stderr: Buffer.isBuffer(result.stderr) ? result.stderr.toString("latin1") : String(result.stderr ?? ""),
    };
  };
  return {
    command,
    read(executable) {
      const result = run(["query", USER_GPU_PREFERENCES_KEY, "/v", executable]);
      if (result.status !== 0) return null;
      return parseRegQueryValue(result.stdout);
    },
    write(executable, value) {
      const result = run(["add", USER_GPU_PREFERENCES_KEY, "/v", executable, "/t", "REG_SZ", "/d", value, "/f"]);
      if (result.status !== 0) throw new Error(`reg add exited ${result.status}: ${result.stderr.trim() || result.stdout.trim()}`);
    },
    remove(executable) {
      const result = run(["delete", USER_GPU_PREFERENCES_KEY, "/v", executable, "/f"]);
      if (result.status !== 0) throw new Error(`reg delete exited ${result.status}: ${result.stderr.trim() || result.stdout.trim()}`);
    },
  };
}

// akari-launcher と同じ規約（env.AKARI_HOME || ~/.akari）を自前で持つ（依存方向: osr-export → akari-launcher は張らない）。
export function resolveAkariHome(env = process.env, homeDirectory = homedir()) {
  return presentString(env?.AKARI_HOME) ?? join(homeDirectory, ".akari");
}

export function gpuPreferenceSidecarPath(env = process.env, homeDirectory = homedir()) {
  return join(resolveAkariHome(env, homeDirectory), GPU_PREFERENCE_SIDECAR_NAME);
}

export function createSidecarAccess({ env = process.env, homeDirectory = homedir(), path = null } = {}) {
  const sidecarPath = path ?? gpuPreferenceSidecarPath(env, homeDirectory);
  return {
    path: sidecarPath,
    async read() {
      let text;
      try { text = await readFile(sidecarPath, "utf8"); }
      catch (error) {
        if (error?.code === "ENOENT") return null;
        throw error;
      }
      try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === "object" ? parsed : null;
      } catch {
        return null;
      }
    },
    async write(record) {
      await mkdir(dirname(sidecarPath), { recursive: true });
      await writeFile(sidecarPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    },
    async remove() {
      await rm(sidecarPath, { force: true });
    },
  };
}

// 前回の親プロセスが復元前に死んだときの sidecar を先に片付ける（previous null → 削除、else previous を書き戻す）。
export async function recoverStaleGpuPreference({ sidecar, registry, stderr = process.stderr }) {
  const record = await sidecar.read();
  if (!record) return false;
  const executable = typeof record.executable === "string" ? record.executable : null;
  const previous = typeof record.previous === "string" ? record.previous : null;
  if (record.version !== 1 || executable === null) {
    await sidecar.remove();
    return false;
  }
  try {
    const current = await registry.read(executable);
    if (previous === null) {
      if (current !== null) await registry.remove(executable);
    } else if (current !== previous) {
      await registry.write(executable, previous);
    }
    await sidecar.remove();
  } catch (error) {
    stderr?.write?.(`${RESTORE_WARNING_PREFIX} stale override restore failed: ${error?.message ?? error}\n`);
  }
  return true;
}

// write → await run() → finally restore。戻り値の gpuPreference は launchElectronExport の記録・receipt の provenance.gpu_preference になる。
// run() が reject したときも同じ記録を error.gpuPreference に添えて投げ直す（失敗文の判定材料）。
export async function withGpuPreference(launcher, options, run, {
  env = process.env,
  platform = process.platform,
  registry = null,
  sidecar = null,
  executableExists = existsSync,
  stderr = process.stderr,
  now = () => new Date().toISOString(),
} = {}) {
  const policy = resolveGpuPreferencePolicy(options, env);
  const record = {
    platform,
    policy,
    executable: null,
    applied: false,
    previous: null,
    restored: null,
    reason: null,
    recovered_stale: false,
  };
  const finish = async () => ({ result: await runRecorded(run, record), gpuPreference: record });
  if (platform !== "win32") {
    record.reason = "platform";
    return finish();
  }
  const registryAccess = registry ?? createRegistryAccess({ env });
  const sidecarAccess = sidecar ?? createSidecarAccess({ env });
  record.recovered_stale = await recoverStaleGpuPreference({ sidecar: sidecarAccess, registry: registryAccess, stderr });
  const executable = normalizeGpuPreferenceExecutable(launcher?.executable);
  record.executable = executable;
  const soft = Boolean(options?.soft);
  if (soft) {
    record.reason = "soft";
    return finish();
  }
  if (policy === "off") {
    record.reason = "policy-off";
    return finish();
  }
  // 実在しない exe（テストのダミー等）へ値を書かない安全弁。実プロセスは起動時に必ず存在する。
  if (!executableExists(executable)) {
    record.reason = "executable-missing";
    return finish();
  }
  let current;
  try {
    current = await registryAccess.read(executable);
  } catch (error) {
    stderr?.write?.(`${RESTORE_WARNING_PREFIX} registry read failed: ${error?.message ?? error}\n`);
    record.reason = "registry-unavailable";
    return finish();
  }
  record.previous = current;
  const plan = planGpuPreference({ platform, policy, soft, current });
  record.reason = plan.reason;
  if (plan.action !== "write") return finish();
  try {
    await sidecarAccess.write({ version: 1, executable, previous: current, written_at: now() });
  } catch (error) {
    stderr?.write?.(`${RESTORE_WARNING_PREFIX} sidecar write failed: ${error?.message ?? error}\n`);
    record.reason = "sidecar-unavailable";
    return finish();
  }
  try {
    await registryAccess.write(executable, plan.value);
  } catch (error) {
    stderr?.write?.(`${RESTORE_WARNING_PREFIX} write failed: ${error?.message ?? error}\n`);
    await sidecarAccess.remove().catch(() => {});
    record.reason = "write-failed";
    return finish();
  }
  record.applied = true;
  // spawn → 子の close（exit code に関わらず・spawn エラーでも）→ 復元を 1 回。復元失敗は warning + restored: false（throw しない）。
  let result;
  let failure = null;
  try {
    result = await run();
  } catch (error) {
    failure = { error };
  } finally {
    await restore({ registry: registryAccess, sidecar: sidecarAccess, executable, plan, record, stderr });
  }
  if (failure) throw attachRecord(failure.error, record);
  return { result, gpuPreference: record };
}

async function restore({ registry, sidecar, executable, plan, record, stderr }) {
  try {
    if (plan.restore.kind === "remove") await registry.remove(executable);
    else await registry.write(executable, plan.restore.value);
    record.restored = true;
    await sidecar.remove();
  } catch (error) {
    record.restored = false;
    stderr?.write?.(`${RESTORE_WARNING_PREFIX} restore failed: ${error?.message ?? error}\n`);
  }
}

async function runRecorded(run, record) {
  try {
    return await run();
  } catch (error) {
    throw attachRecord(error, record);
  }
}

function attachRecord(error, record) {
  if (error && typeof error === "object") {
    try { error.gpuPreference = record; } catch {}
  }
  return error;
}

// receipt の provenance.gpu_preference（snake_case）。record が無い（他 OS の旧 runner・テストの launcherRunner）なら null。
export function normalizeGpuPreferenceRecord(value) {
  if (!value || typeof value !== "object") return null;
  return {
    policy: typeof value.policy === "string" ? value.policy : null,
    applied: value.applied === true,
    previous: typeof value.previous === "string" ? value.previous : null,
    restored: typeof value.restored === "boolean" ? value.restored : null,
    reason: typeof value.reason === "string" ? value.reason : null,
    recovered_stale: value.recovered_stale === true,
  };
}

function presentString(value) {
  return typeof value === "string" && value !== "" ? value : null;
}
