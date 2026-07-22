import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const templatePath = resolve(here, "../template.html");
const renderScript = resolve(here, "../render-analysis-report.mjs");
const analysisFixture = resolve(here, "fixtures/analysis-minimal.json");
const interpretationFixture = resolve(here, "fixtures/interpretation-minimal.json");
const interpretationInvalidFixture = resolve(here, "fixtures/interpretation-invalid.json");
const interpretationTwoAssetsFixture = resolve(here, "fixtures/interpretation-two-assets.json");
const analysisAssetAFixture = resolve(here, "fixtures/materials/asset-a/analysis.json");
const analysisAssetBFixture = resolve(here, "fixtures/materials/asset-b/analysis.json");

function run(args) {
  return spawnSync(process.execPath, [renderScript, ...args], { encoding: "utf8" });
}

function embeddedBundleOf(html) {
  const match = html.match(
    /<script type="application\/json" id="akari-analysis-report-data">([\s\S]*?)<\/script>/,
  );
  assert.ok(match, "埋め込み JSON ブロックが見つかる");
  return JSON.parse(match[1]);
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

test("--analysis で同じ ref を重複指定すると拒否する（位置対応づけ廃止・ref 結合化）", () => {
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
    assert.match(result.stderr, /重複して指定されています/);
    assert.ok(!existsSync(outPath));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("複数素材: --analysis <ref>=<path> で正しく ref 結合する（取り違えなし）", () => {
  const dir = mkdtempSync(join(tmpdir(), "analysis-report-test-"));
  try {
    const outPath = join(dir, "report.html");
    const result = run([
      "--analysis",
      `asset-a=${analysisAssetAFixture}`,
      "--analysis",
      `asset-b=${analysisAssetBFixture}`,
      "--interpretation",
      interpretationTwoAssetsFixture,
      "--out",
      outPath,
    ]);

    assert.equal(result.status, 0, result.stderr);
    const html = readFileSync(outPath, "utf8");
    const bundle = embeddedBundleOf(html);
    const byRef = new Map(bundle.assets.map((a) => [a.ref, a]));
    assert.equal(byRef.get("asset-a").analysis.source, "asset-a.mp4", "asset-a に正しい analysis が束ねられている");
    assert.equal(byRef.get("asset-b").analysis.source, "asset-b.mp4", "asset-b に正しい analysis が束ねられている");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("複数素材: --analysis <ref>=<path> の CLI 引数順が assets[] の宣言順と違っても取り違えない（位置対応づけ廃止の確認）", () => {
  const dir = mkdtempSync(join(tmpdir(), "analysis-report-test-"));
  try {
    const outPath = join(dir, "report.html");
    // assets[] の宣言順は asset-a, asset-b だが、CLI では逆順に指定する。
    const result = run([
      "--analysis",
      `asset-b=${analysisAssetBFixture}`,
      "--analysis",
      `asset-a=${analysisAssetAFixture}`,
      "--interpretation",
      interpretationTwoAssetsFixture,
      "--out",
      outPath,
    ]);

    assert.equal(result.status, 0, result.stderr);
    const html = readFileSync(outPath, "utf8");
    const bundle = embeddedBundleOf(html);
    const byRef = new Map(bundle.assets.map((a) => [a.ref, a]));
    assert.equal(byRef.get("asset-a").analysis.source, "asset-a.mp4");
    assert.equal(byRef.get("asset-b").analysis.source, "asset-b.mp4");
    // assets 配列自体の並び順も interpretation.assets[] の宣言順（asset-a, asset-b）を保つ。
    assert.deepEqual(bundle.assets.map((a) => a.ref), ["asset-a", "asset-b"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("複数素材: --analysis を取り違えて指定する（swap）とハードエラーで拒否し、何も書き出さない（2026-07-22 A3.2 の実証への回帰テスト）", () => {
  const dir = mkdtempSync(join(tmpdir(), "analysis-report-test-"));
  try {
    const outPath = join(dir, "report.html");
    // asset-a に asset-b の analysis.json を、asset-b に asset-a の analysis.json を
    // 明示的（ref=path 形式）に取り違えて渡す。かつての位置対応づけ実装ならこれを
    // 無警告で受理していた（multiasset-dogfood A3.2 で実証済みの silent data corruption）。
    const result = run([
      "--analysis",
      `asset-a=${analysisAssetBFixture}`,
      "--analysis",
      `asset-b=${analysisAssetAFixture}`,
      "--interpretation",
      interpretationTwoAssetsFixture,
      "--out",
      outPath,
    ]);

    assert.notEqual(result.status, 0, "取り違えはエラーで落ちる");
    assert.match(result.stderr, /対応していません/);
    assert.match(result.stderr, /取り違えの疑いがあります/);
    assert.ok(!existsSync(outPath), "取り違え検出時は report.html を書き出さない");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("複数素材: 素の path 指定（bare path）は inputs.analyses[].path と一意に照合できれば CLI 順序に関わらず解決する", () => {
  const dir = mkdtempSync(join(tmpdir(), "analysis-report-test-"));
  try {
    const outPath = join(dir, "report.html");
    // ref= を付けず、宣言順（asset-a, asset-b）とは逆の CLI 順で素の path を渡す。
    const result = run([
      "--analysis",
      analysisAssetBFixture,
      "--analysis",
      analysisAssetAFixture,
      "--interpretation",
      interpretationTwoAssetsFixture,
      "--out",
      outPath,
    ]);

    assert.equal(result.status, 0, result.stderr);
    const html = readFileSync(outPath, "utf8");
    const bundle = embeddedBundleOf(html);
    const byRef = new Map(bundle.assets.map((a) => [a.ref, a]));
    assert.equal(byRef.get("asset-a").analysis.source, "asset-a.mp4");
    assert.equal(byRef.get("asset-b").analysis.source, "asset-b.mp4");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("複数素材: 素の path 指定が inputs.analyses[].path のどれとも一致しないとハードエラーで拒否する", () => {
  const dir = mkdtempSync(join(tmpdir(), "analysis-report-test-"));
  try {
    const outPath = join(dir, "report.html");
    const unrelatedPath = analysisFixture; // fixtures/analysis-minimal.json は two-assets 側の analyses に無い
    const result = run([
      "--analysis",
      unrelatedPath,
      "--analysis",
      analysisAssetBFixture,
      "--interpretation",
      interpretationTwoAssetsFixture,
      "--out",
      outPath,
    ]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /いずれとも一致しません/);
    assert.ok(!existsSync(outPath));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("assets[] の一部に対応する --analysis が無いと拒否する（過不足チェック）", () => {
  const dir = mkdtempSync(join(tmpdir(), "analysis-report-test-"));
  try {
    const outPath = join(dir, "report.html");
    const result = run([
      "--analysis",
      `asset-a=${analysisAssetAFixture}`,
      "--interpretation",
      interpretationTwoAssetsFixture,
      "--out",
      outPath,
    ]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /対応する --analysis が指定されていません: asset-b/);
    assert.ok(!existsSync(outPath));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("素材の読み（role/summary/sections）が interpretation.json 通りに埋め込まれ、ref ごとに正しく束ねられる", () => {
  const dir = mkdtempSync(join(tmpdir(), "analysis-report-test-"));
  try {
    const outPath = join(dir, "report.html");
    const result = run([
      "--analysis",
      `asset-a=${analysisAssetAFixture}`,
      "--analysis",
      `asset-b=${analysisAssetBFixture}`,
      "--interpretation",
      interpretationTwoAssetsFixture,
      "--out",
      outPath,
    ]);

    assert.equal(result.status, 0, result.stderr);
    const html = readFileSync(outPath, "utf8");
    const bundle = embeddedBundleOf(html);
    const interpByRef = new Map(bundle.interpretation.assets.map((a) => [a.ref, a]));
    assert.equal(interpByRef.get("asset-a").role, "primary_talk");
    assert.equal(interpByRef.get("asset-a").summary, "Asset A の要約テキスト。");
    assert.equal(interpByRef.get("asset-a").sections.length, 1);
    assert.equal(interpByRef.get("asset-a").sections[0].title, "導入 A");
    assert.equal(interpByRef.get("asset-b").role, "supporting_broll");
    assert.ok(!hasOwn(interpByRef.get("asset-b"), "sections"), "sections 省略時はキー自体が無い");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("template.html は素材の読み（role/summary/sections）を描画するコードを持つ（A3.2 で発見された未実装への回帰トラップ）", () => {
  // multiasset-dogfood（2026-07-22 A3.2）で asset.role / asset.summary / asset.sections が
  // template.html のどこからも参照されていない（書いても画面に出ない）ことが発覚した。
  // ここでは renderFacts が実際にこれらのフィールドを参照していることをソースレベルで固定する
  // （DOM 実測はヘッドレスブラウザが要るため内部リポの out/ 側で別途行う）。
  const templateSource = readFileSync(templatePath, "utf8");
  const factsSection = templateSource.slice(
    templateSource.indexOf("function renderAssetReading"),
    templateSource.indexOf("function renderRelations"),
  );
  assert.ok(factsSection.includes("素材の読み"), "節 3 に「素材の読み」の見出しがある");
  assert.match(factsSection, /interpAsset\.role\b/, "renderFacts が asset.role を参照する");
  assert.match(factsSection, /interpAsset\.summary\b/, "renderFacts が asset.summary を参照する");
  assert.match(factsSection, /interpAsset\.sections\b/, "renderFacts が asset.sections を参照する");
});

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

test("壊れた analysis.json を明確なエラーで拒否する", () => {
  const dir = mkdtempSync(join(tmpdir(), "analysis-report-test-"));
  try {
    const broken = JSON.parse(readFileSync(analysisFixture, "utf8"));
    delete broken.tracks;
    // basename は inputs.analyses[0].path（"analysis-minimal.json"）と揃える
    // （bare path の一意照合は basename/suffix ベースのため、無関係な名前だと
    // 構造検証の手前で「path が一致しません」エラーになってしまう）。
    const brokenAnalysisPath = join(dir, "analysis-minimal.json");
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
