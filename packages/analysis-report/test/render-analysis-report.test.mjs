import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const renderScript = resolve(here, "../render-analysis-report.mjs");
const analysisFixture = resolve(here, "fixtures/analysis-minimal.json");
const interpretationFixture = resolve(here, "fixtures/interpretation-minimal.json");
const interpretationInvalidFixture = resolve(here, "fixtures/interpretation-invalid.json");

function run(args) {
  return spawnSync(process.execPath, [renderScript, ...args], { encoding: "utf8" });
}

test("valid analysis + interpretation を渡すと report.html を生成する", () => {
  const dir = mkdtempSync(join(tmpdir(), "analysis-report-test-"));
  try {
    const outPath = join(dir, "report.html");
    const result = run([
      "--analysis",
      analysisFixture,
      "--interpretation",
      interpretationFixture,
      "--out",
      outPath,
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(outPath), "report.html が生成されている");

    const html = readFileSync(outPath, "utf8");
    assert.ok(html.includes('id="akari-analysis-report-data"'));
    assert.ok(!html.includes("__AKARI_ANALYSIS_REPORT_DATA__"), "プレースホルダーが実データに置き換わっている");
    assert.ok(html.includes("clip-01"), "asset ref が埋め込まれている");
    assert.ok(!html.includes("<script>alert"), "素朴なスクリプト注入がない");

    // A2.1（2026-07-22）: 節 4「解釈: 構成案」は表示から除去（arc はデータとして存続）
    const sectionCount = (html.match(/class="report-section"/g) || []).length;
    assert.equal(sectionCount, 6, "report-section は 6 件（構成案の節を除去済み）");
    const navLinkCount = (html.match(/<a href="#section-/g) || []).length;
    assert.equal(navLinkCount, 6, "章ナビは 6 リンク");
    assert.ok(!html.includes('id="section-arc"'), "section-arc は存在しない");
    assert.ok(!html.includes("解釈: 構成案"), "構成案セクションの見出しは表示されない");
    assert.ok(!html.includes("構成案エントリ"), "ヘッダー統計タイルから構成案エントリを除去済み");
    assert.ok(html.includes("検出イベント数"), "ヘッダー統計タイルは事実層由来の代替（検出イベント数）を持つ");
    assert.ok(html.includes('"title":"Opening"'), "arc はデータとして JSON ブロックに保持される");

    // 追加修正（司令塔検収）: 取材台帳の空状態文言が表示から消した「構成案」概念を
    // 参照し続けないよう改訂（他 2 種の空状態文言は不変）
    assert.ok(
      !html.includes("構成案は素材の文脈だけで根拠付きで通りました"),
      "旧空状態文言（構成案を参照）は残っていない",
    );
    assert.ok(
      html.includes("取材事項なし — 素材の文脈だけで根拠付きで筋が通りました"),
      "取材台帳の空状態文言は新文言に更新されている",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validate-interpretation.mjs が REJECT する入力は明確なエラーで拒否し、ファイルを書き出さない", () => {
  const dir = mkdtempSync(join(tmpdir(), "analysis-report-test-"));
  try {
    const outPath = join(dir, "report.html");
    const result = run([
      "--analysis",
      analysisFixture,
      "--interpretation",
      interpretationInvalidFixture,
      "--out",
      outPath,
    ]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /検証に失敗しました/);
    assert.ok(!existsSync(outPath), "無効な入力では report.html を書き出さない");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--analysis の件数が assets[] と一致しないと拒否する", () => {
  const dir = mkdtempSync(join(tmpdir(), "analysis-report-test-"));
  try {
    const outPath = join(dir, "report.html");
    const result = run([
      "--analysis",
      analysisFixture,
      "--analysis",
      analysisFixture,
      "--interpretation",
      interpretationFixture,
      "--out",
      outPath,
    ]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /一致しません/);
    assert.ok(!existsSync(outPath));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("壊れた analysis.json を明確なエラーで拒否する", () => {
  const dir = mkdtempSync(join(tmpdir(), "analysis-report-test-"));
  try {
    const broken = JSON.parse(readFileSync(analysisFixture, "utf8"));
    delete broken.tracks;
    const brokenAnalysisPath = join(dir, "analysis-broken.json");
    writeFileSync(brokenAnalysisPath, JSON.stringify(broken), "utf8");

    const outPath = join(dir, "report.html");
    const result = run([
      "--analysis",
      brokenAnalysisPath,
      "--interpretation",
      interpretationFixture,
      "--out",
      outPath,
    ]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /構造検証に失敗しました/);
    assert.ok(!existsSync(outPath));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
