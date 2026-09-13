import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { renderStoryboardPrint } from "../render-storyboard-print.mjs";

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDirectory = path.join(packageDirectory, "test", "fixtures", "storyboard-print");
const rendererPath = path.join(packageDirectory, "render-storyboard-print.mjs");
const generatedAt = "2026-09-13T12:34:56.000Z";

function fixture() {
  const edit = JSON.parse(readFileSync(path.join(fixtureDirectory, "edit.json"), "utf8"));
  const captions = JSON.parse(readFileSync(path.join(fixtureDirectory, "captions.json"), "utf8"));
  const frames = ["opening", "middle", "ending"].map((itemId, index) => ({
    itemId,
    time_s: index + 0.25,
    pngPath: path.join(fixtureDirectory, "frames", `${index + 1}.png`),
  }));
  const sidecars = {
    opening: { state: "planned", kind: "still" },
    middle: { state: "done", kind: "video" },
    ending: { state: "done", kind: "still" },
  };
  return { edit, captions, frames, sidecars };
}

function digest(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

test("3 item の尺バー・字幕・3 種の生成バッジを自己完結 HTML に描く", () => {
  const input = fixture();
  const html = renderStoryboardPrint({ ...input, generatedAt, title: "テスト絵コンテ" });
  assert.equal([...html.matchAll(/data-storyboard-item=/g)].length, 3);
  assert.equal([...html.matchAll(/style="width:33\.333333%"/g)].length, 3);
  assert.match(html, /最初の字幕です/);
  assert.match(html, /badge-planned">planned/);
  assert.match(html, /badge-video">生成/);
  assert.match(html, /badge-still">静止画/);
  assert.equal([...html.matchAll(/src="data:image\/png;base64,/g)].length, 3);
  assert.doesNotMatch(html, /<(?:img|script|link)[^>]+(?:src|href)="https?:\/\//i);
});

test("generatedAt 固定時は 2 回描画がバイト一致する", () => {
  const input = fixture();
  assert.equal(
    renderStoryboardPrint({ ...input, generatedAt }),
    renderStoryboardPrint({ ...input, generatedAt }),
  );
});

test("合計尺は edit.json の item duration から再計算する", () => {
  const input = fixture();
  const original = renderStoryboardPrint({ ...input, generatedAt });
  assert.match(original, /<dd>00:06\.0<\/dd>/);
  const changed = structuredClone(input.edit);
  changed.tracks[0].items[2].duration = 90;
  const updated = renderStoryboardPrint({ ...input, edit: changed, generatedAt });
  assert.match(updated, /<dd>00:07\.0<\/dd>/);
  assert.notEqual(original, updated);
});

test("CLI --no-capture は manifest とプレースホルダー HTML を生成する", () => {
  const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "akari-storyboard-print-"));
  try {
    const result = spawnSync(process.execPath, [rendererPath, fixtureDirectory, "--no-capture", "--out", temporaryDirectory], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const html = readFileSync(path.join(temporaryDirectory, "index.html"), "utf8");
    const manifest = JSON.parse(readFileSync(path.join(temporaryDirectory, "storyboard.json"), "utf8"));
    assert.equal([...html.matchAll(/<div class="frame-placeholder"/g)].length, 3);
    assert.match(html, /badge-planned">planned/);
    assert.match(html, /badge-video">生成/);
    assert.match(html, /badge-still">静止画/);
    assert.equal(manifest.edit_sha256, digest(path.join(fixtureDirectory, "edit.json")));
    assert.deepEqual(manifest.times_s, [0.26666666666666666, 2.2666666666666666, 4.266666666666667]);
    assert.ok(!html.includes(fixtureDirectory));
    assert.ok(!JSON.stringify(manifest).includes(fixtureDirectory));
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("captions.json が無いプロジェクトも空字幕として CLI 描画を続行する", () => {
  const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "akari-storyboard-no-captions-"));
  const projectDirectory = path.join(temporaryDirectory, "project");
  const outputDirectory = path.join(temporaryDirectory, "out");
  try {
    mkdirSync(projectDirectory);
    writeFileSync(path.join(projectDirectory, "edit.json"), readFileSync(path.join(fixtureDirectory, "edit.json")));
    cpSync(path.join(fixtureDirectory, "assets"), path.join(projectDirectory, "assets"), { recursive: true });
    const result = spawnSync(process.execPath, [rendererPath, projectDirectory, "--no-capture", "--out", outputDirectory], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const html = readFileSync(path.join(outputDirectory, "index.html"), "utf8");
    const manifest = JSON.parse(readFileSync(path.join(outputDirectory, "storyboard.json"), "utf8"));
    assert.equal([...html.matchAll(/data-storyboard-item=/g)].length, 3);
    assert.equal(manifest.captions_sha256, null);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("source を持たない visual item はコマと尺バーから静かに除外する", () => {
  const input = fixture();
  const edit = structuredClone(input.edit);
  edit.tracks[0].items.push({ id: "missing-source", name: "壊れた item", at: 180, duration: 30 });
  let html;
  assert.doesNotThrow(() => {
    html = renderStoryboardPrint({ ...input, edit, generatedAt });
  });
  assert.equal([...html.matchAll(/data-storyboard-item=/g)].length, 3);
  assert.equal([...html.matchAll(/class="duration-segment /g)].length, 3);
  assert.doesNotMatch(html, /missing-source|壊れた item/);
});
