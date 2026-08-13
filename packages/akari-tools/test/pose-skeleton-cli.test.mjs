import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(packageRoot, "bin", "pose-skeleton.mjs");

test("pose-skeleton: --check は ffmpeg/ffprobe の可否を JSON で返す", () => {
  const result = spawnSync(process.execPath, [script, "--check"], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.equal(typeof JSON.parse(result.stdout).available, "boolean");
});

test("pose-skeleton: 必須入力が無ければ exit 2", () => {
  const result = spawnSync(process.execPath, [script], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(JSON.parse(result.stdout).reason, /--analysis.*--edit/);
});

test("pose-skeleton: ツマミの不正値は外部バイナリ起動前に拒否", () => {
  const result = spawnSync(process.execPath, [script, "--smoothing", "0"], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(JSON.parse(result.stdout).reason, /--smoothing/);
});
