import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const renderScript = resolve(here, "../render-decision-log-report.mjs");
const fixtures = resolve(here, "fixtures");

function run(args, cwd) {
  return spawnSync(process.execPath, [renderScript, ...args], { cwd, encoding: "utf8" });
}

function embeddedDataOf(html) {
  const match = html.match(/<script type="application\/json" id="akari-decision-log-report-data">([\s\S]*?)<\/script>/u);
  assert.ok(match, "埋め込み JSON ブロックが見つかる");
  return JSON.parse(match[1]);
}

function prepareProject(fixtureName) {
  const root = mkdtempSync(join(tmpdir(), "decision-log-report-test-"));
  const logPath = join(root, "decision-log.md");
  writeFileSync(logPath, readFileSync(resolve(fixtures, fixtureName, "decision-log.md")));
  return { root, logPath, outPath: join(root, ".akari", "reports", "decision-log-report.html") };
}

function installPixel(root, relative = join("assets", "frame.png")) {
  const path = join(root, relative);
  mkdirSync(dirname(path), { recursive: true });
  copyFileSync(resolve(fixtures, "pixel.png"), path);
  return path;
}

test("(a) 表形式の上書き・tone JSON・実在/欠落画像を構造化する", () => {
  const project = prepareProject("table");
  try {
    installPixel(project.root);
    const result = run(["--log", project.logPath, "--out", project.outPath, "--project", project.root], project.root);
    assert.equal(result.status, 0, result.stderr);
    const data = embeddedDataOf(readFileSync(project.outPath, "utf8"));
    assert.equal(data.decisions.length, 3);
    assert.equal(data.decisions[0].supersededBy, 1);
    assert.equal(data.decisions[1].supersededBy, null);
    assert.deepEqual(data.decisions[2].tone, ["勢い", "無機質"]);
    assert.equal(data.decisions[2].tempo, "高速");
    assert.equal(data.images.length, 2);
    const existing = data.images.find((image) => image.path === "assets/frame.png");
    assert.deepEqual(existing, {
      path: "assets/frame.png",
      exists: true,
      src: "../../assets/frame.png",
      decisionIndex: 1,
      blockIndex: null,
    });
    const missing = data.images.find((image) => image.path === "assets/missing.jpg");
    assert.equal(missing.exists, false);
    assert.equal(missing.src, null);
  } finally {
    rmSync(project.root, { recursive: true, force: true });
  }
});

test("(b) 自由記述は見出し・ネストリストを blocks に保ち、構造化行ゼロの空状態を持つ", () => {
  const project = prepareProject("freeform");
  try {
    const result = run(["--log", project.logPath, "--out", project.outPath], project.root);
    assert.equal(result.status, 0, result.stderr);
    const html = readFileSync(project.outPath, "utf8");
    const data = embeddedDataOf(html);
    assert.equal(data.decisions.length, 0);
    assert.ok(data.blocks.some((block) => block.type === "heading"));
    assert.ok(data.blocks.some((block) => block.type === "list" && block.depth === 1));
    assert.ok(data.blocks.some((block) => block.type === "table"));
    assert.match(html, /表形式の決定行はまだありません（記録原文を参照）/u);
  } finally {
    rmSync(project.root, { recursive: true, force: true });
  }
});

test("(c) 1 行パイプ形式から category・subject・checkpoint を抽出する", () => {
  const project = prepareProject("pipe");
  try {
    const result = run(["--log", project.logPath, "--out", project.outPath], project.root);
    assert.equal(result.status, 0, result.stderr);
    const data = embeddedDataOf(readFileSync(project.outPath, "utf8"));
    assert.equal(data.decisions.length, 1);
    assert.equal(data.decisions[0].category, "rendition");
    assert.equal(data.decisions[0].subject, "guide/2d-bustup");
    assert.equal(data.decisions[0].checkpoint, "素材計画");
  } finally {
    rmSync(project.root, { recursive: true, force: true });
  }
});

test("(d) 空ファイルは空状態を描画して exit 0 になる", () => {
  const project = prepareProject("empty");
  try {
    const result = run(["--log", project.logPath, "--out", project.outPath], project.root);
    assert.equal(result.status, 0, result.stderr);
    const html = readFileSync(project.outPath, "utf8");
    const data = embeddedDataOf(html);
    assert.equal(data.stats.decisionRows, 0);
    assert.equal(data.stats.blockCount, 0);
    assert.equal(data.decisions.length, 0);
    assert.equal(data.blocks.length, 0);
    assert.match(html, /判断記録はまだありません/u);
  } finally {
    rmSync(project.root, { recursive: true, force: true });
  }
});

test("(e) --log 不在は exit 1 で出力を作らない", () => {
  const root = mkdtempSync(join(tmpdir(), "decision-log-report-test-"));
  try {
    const outPath = join(root, "reports", "report.html");
    const result = run(["--log", join(root, "missing.md"), "--out", outPath], root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /読み込めません/u);
    assert.equal(existsSync(outPath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("(f) 同じ入力を 2 回描画すると出力バイトが一致する", () => {
  const project = prepareProject("table");
  try {
    installPixel(project.root);
    const out1 = join(project.root, ".akari", "reports", "report-1.html");
    const out2 = join(project.root, ".akari", "reports", "report-2.html");
    const first = run(["--log", project.logPath, "--out", out1, "--project", project.root], project.root);
    const second = run(["--log", project.logPath, "--out", out2, "--project", project.root], project.root);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.status, 0, second.stderr);
    assert.deepEqual(readFileSync(out1), readFileSync(out2));
  } finally {
    rmSync(project.root, { recursive: true, force: true });
  }
});

test("(g) HTML は CSP と固定 title を持ち、外部 URL・data 画像・決定 UI を含まない", () => {
  const project = prepareProject("table");
  try {
    installPixel(project.root);
    const result = run(["--log", project.logPath, "--out", project.outPath, "--project", project.root], project.root);
    assert.equal(result.status, 0, result.stderr);
    const html = readFileSync(project.outPath, "utf8");
    assert.match(html, /<title>AKARI Video 判断記録レポート<\/title>/u);
    assert.match(html, /http-equiv="Content-Security-Policy"/u);
    assert.doesNotMatch(html, /data:image|http:\/\/|https:\/\//u);
    assert.doesNotMatch(html, /<(?:button|input|select|textarea|form)\b/iu);
  } finally {
    rmSync(project.root, { recursive: true, force: true });
  }
});

test("(h) planning 配下の --log は --project 省略時に親の project root を使う", () => {
  const root = mkdtempSync(join(tmpdir(), "decision-log-report-test-"));
  try {
    const logPath = join(root, "planning", "decision-log.md");
    mkdirSync(dirname(logPath), { recursive: true });
    writeFileSync(logPath, "参照画像: assets/default.png\n", "utf8");
    installPixel(root, join("assets", "default.png"));
    const outPath = join(root, ".akari", "reports", "decision-log-report.html");
    const result = run(["--log", logPath, "--out", outPath], root);
    assert.equal(result.status, 0, result.stderr);
    const data = embeddedDataOf(readFileSync(outPath, "utf8"));
    assert.equal(data.source.path, "planning/decision-log.md");
    assert.equal(data.source.projectName, root.split(/[\\/]/u).at(-1));
    assert.equal(data.images[0].exists, true);
    assert.equal(data.images[0].src, "../../assets/default.png");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("(i) 裸パスは ASCII のパス文字と区切りを要求し、グロブを収集しない", () => {
  const project = prepareProject("path-tokens");
  try {
    installPixel(project.root);
    const result = run(["--log", project.logPath, "--out", project.outPath, "--project", project.root], project.root);
    assert.equal(result.status, 0, result.stderr);
    const data = embeddedDataOf(readFileSync(project.outPath, "utf8"));
    assert.deepEqual(data.images.map((image) => image.path), ["assets/frame.png"]);
    assert.equal(data.stats.imageCount, 1);
  } finally {
    rmSync(project.root, { recursive: true, force: true });
  }
});

test("(j) 引用の連続行は blockquote 1 ブロックとして描画する", () => {
  const project = prepareProject("blockquote");
  try {
    const result = run(["--log", project.logPath, "--out", project.outPath], project.root);
    assert.equal(result.status, 0, result.stderr);
    const html = readFileSync(project.outPath, "utf8");
    const data = embeddedDataOf(html);
    const quotes = data.blocks.filter((block) => block.type === "blockquote");
    assert.equal(quotes.length, 1);
    assert.equal(quotes[0].text, "既存行は変更・削除せず、追記のみ行う。");
    assert.match(html, /block\.type\s*===\s*["']blockquote["']/u);
    assert.match(html, /el\s*\(\s*["']blockquote["']/u);
    const reportBody = html.replace(/<script type="application\/json" id="akari-decision-log-report-data">[\s\S]*?<\/script>/u, "");
    assert.doesNotMatch(reportBody, /(?:&gt;|>) 既存行/u);
  } finally {
    rmSync(project.root, { recursive: true, force: true });
  }
});
