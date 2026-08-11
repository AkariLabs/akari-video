// vision-tracks.mjs --check の「正直さ」を確認する回帰テスト
// （検収基準: 「--check が正直（macOS 以外相当の欠落を偽装した時に不可を返す）」）。
//
// 実際に OS を差し替えることはできないため、PATH から swiftc / ffmpeg を隠して
// 「macOS 以外相当の欠落」を模擬する。--check が推測実行に倒れず、欠けている道具を
// 正直に reason へ書いて available: false を返すことを検証する
// （contract §3「宣言のない能力は存在しない」の実装確認）。

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
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

function runCheck(pathOverride) {
  return spawnSync(process.execPath, [wrapperScript, "--check"], {
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
