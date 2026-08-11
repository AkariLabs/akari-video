import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(packageRoot, "bin", "eye-bar.mjs");

function run(args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
}

test("eye-bar: --check は ffmpeg/ffprobe の可否を JSON で返す", () => {
  const result = run(["--check"]);
  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout.trim());
  assert.equal(typeof parsed.available, "boolean");
});

test("eye-bar: --edit が無ければ exit 2 で理由を返す", () => {
  const result = run([]);
  assert.equal(result.status, 2);
  const parsed = JSON.parse(result.stdout.trim());
  assert.equal(parsed.ok, false);
  assert.match(parsed.reason, /--edit/);
});

test("eye-bar: edit.json が見つからなければ exit 1 で理由を返す", () => {
  const result = run(["--edit", "/nonexistent/edit.json", "--analysis", "/nonexistent/analysis.json"]);
  assert.equal(result.status, 1);
  const parsed = JSON.parse(result.stdout.trim());
  assert.equal(parsed.ok, false);
  assert.match(parsed.reason, /edit\.json/);
});
