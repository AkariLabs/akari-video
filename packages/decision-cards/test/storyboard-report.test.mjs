import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { accessSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { renderResearchPlanReportFile } from "../render-research-plan-report.mjs";

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDirectory = path.join(packageDirectory, "test", "fixtures", "research-plan");
const artifactDirectory = path.join(packageDirectory, "test", "artifacts");
const chromeCandidates = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

function findChrome() {
  for (const candidate of chromeCandidates) {
    try {
      accessSync(candidate);
      return candidate;
    } catch {
      // 次の既知パスを試す。
    }
  }
  return null;
}

function withRenderedFixture(name, run) {
  const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "akari-storyboard-report-"));
  const outputPath = path.join(temporaryDirectory, `${name}.html`);
  try {
    renderResearchPlanReportFile(path.join(fixtureDirectory, name, "research-plan.json"), outputPath);
    return run({ outputPath, html: readFileSync(outputPath, "utf8") });
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function count(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

test("画像あり fixture は自己完結 img をカード面へ埋め込む", () => {
  withRenderedFixture("with-image", ({ html }) => {
    assert.match(html, /<img class="shot-image" data-shot-image src="data:image\/svg\+xml;base64,/);
    assert.doesNotMatch(html, /src="shot\.svg"/);
  });
});

test("画像なし fixture は shot_type と description のプレースホルダーを表示する", () => {
  withRenderedFixture("without-image", ({ html }) => {
    assert.match(html, /data-shot-placeholder/);
    assert.match(html, />overhead</);
    assert.match(html, /机の上で工程を説明する俯瞰ショット/);
  });
});

test("3章 + カットアウェイ2本 fixture は主軸・分岐・戻り線を SVG DOM に持つ", () => {
  withRenderedFixture("branching", ({ html }) => {
    assert.match(html, /<svg data-storyboard-flow/);
    assert.equal(count(html, /data-flow-role="main-node"/g), 3);
    assert.equal(count(html, /data-flow-role="cutaway-node"/g), 2);
    assert.equal(count(html, /data-flow-role="branch-line"/g), 2);
    assert.equal(count(html, /data-flow-role="return-line"/g), 2);
    assert.equal(count(html, /data-flow-role="chapter-band"/g), 3);
  });
});

test("新フィールド皆無の旧形式も生成でき、構造面は空面になる", () => {
  withRenderedFixture("legacy", ({ html }) => {
    assert.match(html, /data-shot-placeholder/);
    assert.match(html, /data-structure-empty/);
    assert.match(html, /構造情報なし/);
  });
});

test("headless Chrome の DOM でもタブと SVG 構造を機械照合する", (t) => {
  const chrome = findChrome();
  if (!chrome) {
    t.skip("Chrome/Chromium が無いため DOM 実測を省略");
    return;
  }
  withRenderedFixture("branching", ({ outputPath }) => {
    const executed = spawnSync(
      chrome,
      ["--headless=new", "--disable-gpu", "--no-sandbox", "--dump-dom", `${pathToFileURL(outputPath).href}#storyboard-structure`],
      { encoding: "utf8", timeout: 20_000 },
    );
    if (executed.status === null || /FATAL:|Permission denied/.test(executed.stderr || "")) {
      t.skip("実行環境が headless Chrome の起動を許可していないため DOM 実測を省略");
      return;
    }
    assert.equal(executed.status, 0, executed.stderr);
    assert.match(executed.stdout, /data-storyboard-panel="structure"/);
    assert.match(executed.stdout, /id="storyboard-structure"[^>]*>\s*<div class="flow-legend"/);
    assert.doesNotMatch(executed.stdout, /id="storyboard-structure"[^>]*hidden/);
    assert.equal(count(executed.stdout, /data-flow-role="main-node"/g), 3);
    assert.equal(count(executed.stdout, /data-flow-role="cutaway-node"/g), 2);
  });
});

test("カード面と構造面のスクリーンショット証跡を生成する", (t) => {
  const chrome = findChrome();
  if (!chrome) {
    t.skip("Chrome/Chromium が無いためスクリーンショットを省略");
    return;
  }
  mkdirSync(artifactDirectory, { recursive: true });
  const cases = [
    { hash: "#storyboard-cards", file: "storyboard-card-view.png" },
    { hash: "#storyboard-structure", file: "storyboard-structure-view.png" },
  ];
  withRenderedFixture("branching", ({ outputPath }) => {
    for (const screenshot of cases) {
      const screenshotPath = path.join(artifactDirectory, screenshot.file);
      const executed = spawnSync(
        chrome,
        [
          "--headless=new",
          "--disable-gpu",
          "--hide-scrollbars",
          "--no-sandbox",
          "--window-size=1440,1100",
          `--screenshot=${screenshotPath}`,
          `${pathToFileURL(outputPath).href}${screenshot.hash}`,
        ],
        { encoding: "utf8", timeout: 20_000 },
      );
      if (executed.status === null || /FATAL:|Permission denied/.test(executed.stderr || "")) {
        t.skip("実行環境が headless Chrome の起動を許可していないためスクリーンショットを省略");
        return;
      }
      assert.equal(executed.status, 0, executed.stderr);
      assert.ok(statSync(screenshotPath).size > 10_000, `${screenshot.file} が小さすぎます`);
    }
    t.diagnostic(`screenshots: ${cases.map(({ file }) => path.join(artifactDirectory, file)).join(", ")}`);
  });
});
