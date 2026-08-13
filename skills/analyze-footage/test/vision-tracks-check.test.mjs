// vision-tracks.mjs --check の「正直さ」を確認する回帰テスト
// （検収基準: 「--check が正直（macOS 以外相当の欠落を偽装した時に不可を返す）」）。
//
// 実際に OS を差し替えることはできないため、PATH から swiftc / ffmpeg を隠して
// 「macOS 以外相当の欠落」を模擬する。--check が推測実行に倒れず、欠けている道具を
// 正直に reason へ書いて available: false を返すことを検証する
// （contract §3「宣言のない能力は存在しない」の実装確認）。

import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const wrapperScript = resolve(here, "../bin/vision-tracks/vision-tracks.mjs");
const isDarwin = process.platform === "darwin";

function which(command) {
  const result = spawnSync("/usr/bin/which", [command], { encoding: "utf8" });
  const found = result.stdout.trim();
  return found || null;
}

function runCheck(pathOverride, kinds = null) {
  return spawnSync(process.execPath, [wrapperScript, "--check", ...(kinds ? ["--kinds", kinds] : [])], {
    encoding: "utf8",
    env: { ...process.env, PATH: pathOverride },
  });
}

test(
  "swiftc も ffmpeg も PATH に無いと available:false を正直に返す",
  { skip: isDarwin ? false : "darwin 前提のテスト" },
  () => {
    const result = runCheck("/usr/bin:/bin");
    const reported = JSON.parse(result.stdout);
    assert.equal(reported.available, false);
    assert.ok(typeof reported.reason === "string" && reported.reason.length > 0);
  },
);

test(
  "macOS 13 では body-pose-3d だけ unavailable になり face,hand は利用できる",
  { skip: isDarwin ? false : "darwin 前提のテスト" },
  () => {
    const commands = Object.fromEntries(
      ["swiftc", "ffmpeg", "ffprobe"].map((command) => [command, which(command)]),
    );
    if (Object.values(commands).some((command) => !command)) {
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), "vision-tracks-check-macos13-test-"));
    try {
      for (const [command, target] of Object.entries(commands)) {
        symlinkSync(realpathSync(target), join(dir, command));
      }
      const swVers = join(dir, "sw_vers");
      writeFileSync(swVers, "#!/bin/sh\necho '13.0'\n", "utf8");
      chmodSync(swVers, 0o755);
      const pathOverride = `${dir}:/usr/bin:/bin`;

      const legacyResult = runCheck(pathOverride, "face,hand");
      assert.equal(legacyResult.status, 0, legacyResult.stderr);
      assert.equal(JSON.parse(legacyResult.stdout).available, true);

      const bodyPoseResult = runCheck(pathOverride, "body-pose-3d");
      assert.equal(bodyPoseResult.status, 0, bodyPoseResult.stderr);
      const bodyPoseReported = JSON.parse(bodyPoseResult.stdout);
      assert.equal(bodyPoseReported.available, false);
      assert.match(bodyPoseReported.reason, /macOS 14/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "swiftc はあるが ffmpeg が PATH に無いと available:false を正直に返す（推測実行しない）",
  { skip: isDarwin ? false : "darwin 前提のテスト" },
  () => {
    const swiftc = which("swiftc");
    if (!swiftc) {
      // このマシンに swiftc 自体が無い場合はこのケースを検証できない（前提が崩れる）。
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), "vision-tracks-check-test-"));
    try {
      symlinkSync(swiftc, join(dir, "swiftc"));
      const result = runCheck(`${dir}:/usr/bin:/bin`);
      const reported = JSON.parse(result.stdout);
      assert.equal(reported.available, false);
      assert.match(reported.reason, /ffmpeg/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "swiftc・ffmpeg・ffprobe が揃っていると available:true を返す（このマシンでの非退行確認）",
  { skip: isDarwin ? false : "darwin 前提のテスト" },
  () => {
    const result = spawnSync(process.execPath, [wrapperScript, "--check"], { encoding: "utf8" });
    const reported = JSON.parse(result.stdout);
    // このリポジトリの開発機は swiftc/ffmpeg が入っている前提（report.md の実測もこの環境で
    // 取得した）。無ければ他の全テストも成立しないため、ここで素直に確認する。
    assert.equal(reported.available, true, JSON.stringify(reported));
  },
);
