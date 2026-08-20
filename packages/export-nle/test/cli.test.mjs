import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { assertWellFormedXml } from "./helpers.mjs";

const bin = resolve(dirname(fileURLToPath(import.meta.url)), "..", "bin", "export-nle.mjs");

function makeProject() {
  const root = mkdtempSync(join(tmpdir(), "export-nle-"));
  writeFileSync(join(root, "edit.json"), JSON.stringify({
    version: 2,
    output: { width: 1280, height: 720, fps: 30 },
    sources: [{ id: "main", path: "source.mp4", proxy: null }],
    tracks: [{ id: "main-track", lane: "visual", items: [
      { id: "c1", at: 0, duration: 150, source: { kind: "media", src: "main", in: 0, out: 5 } },
      { id: "c2", at: 150, duration: 60, transform: { scale: 1.1 }, source: { kind: "media", src: "main", in: 10, out: 12 } },
    ] }],
    audio: {
      narration: [
        { id: "n-0001", path: "n.mp3", t: 1, provenance: { provider: "human" } },
      ],
      bgm: { path: "bgm.mp3", gain_db: -12, ducking: true },
    },
  }, null, 2));
  writeFileSync(join(root, "captions.json"), JSON.stringify([
    { id: "c-0001", start: 0.5, end: 2, text: "テスト字幕", speaker: null, sourceRef: null, edited: false },
  ]));
  return root;
}

test("CLI: --no-probe --json で 3 形式 + レポートを書き出し exit 0", () => {
  const root = makeProject();
  const result = spawnSync(process.execPath, [bin, root, "--no-probe", "--json"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "beta-unverified");
  assert.equal(report.probed, false);
  assert.equal(report.written.length, 3);
  assert.ok(report.dropped.some((entry) => entry.field === "audio.bgm.ducking"));
  // プレースホルダ尺の warning が出ている（黙って推測しない）
  assert.ok(report.warnings.some((warning) => warning.includes("実尺が不明")));

  const outDir = join(root, "exports", "nle");
  const name = root.split("/").pop();
  for (const file of [`${name}.fcpxml`, `${name}.premiere.xml`, `${name}.srt`, "export-report.json"]) {
    assert.ok(existsSync(join(outDir, file)), `missing ${file}`);
  }
  assertWellFormedXml(readFileSync(join(outDir, `${name}.fcpxml`), "utf8"));
  assertWellFormedXml(readFileSync(join(outDir, `${name}.premiere.xml`), "utf8"));
  const srt = readFileSync(join(outDir, `${name}.srt`), "utf8");
  assert.match(srt, /00:00:00,500 --> 00:00:02,000\nテスト字幕/);
});

test("CLI: 不正入力は exit 2", () => {
  const result = spawnSync(process.execPath, [bin, "/nonexistent/path"], { encoding: "utf8" });
  assert.equal(result.status, 2);
});

test("CLI: --format srt だけの選択実行", () => {
  const root = makeProject();
  const result = spawnSync(process.execPath, [bin, root, "--no-probe", "--format", "srt", "--json"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.written.length, 1);
  assert.equal(report.written[0].format, "srt");
});
