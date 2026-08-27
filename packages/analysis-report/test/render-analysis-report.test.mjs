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
const interpretationBlocksFullFixture = resolve(here, "fixtures/interpretation-blocks-full.json");
const interpretationBlocksFullSwappedFixture = resolve(
  here,
  "fixtures/interpretation-blocks-full-swapped.json",
);
const analysisCollisionFixture = resolve(here, "fixtures/collision/analysis-minimal.json");

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

function embeddedBlocksOf(html) {
  const match = html.match(
    /<script type="application\/json" id="akari-analysis-report-blocks">([\s\S]*?)<\/script>/,
  );
  assert.ok(match, "埋め込み blocks マニフェストが見つかる");
  return JSON.parse(match[1]);
}

// blocks マニフェスト（packages/analysis-report/README.md の block-id スキーム節と
// 対応表を参照）を、id の平坦なリストへ展開する。文書内一意性の検査に使う。
function flattenBlockIds(blocks) {
  const ids = [];
  for (const perAsset of Object.values(blocks.byRef || {})) {
    ids.push(perAsset.timeline, perAsset.facts);
    ids.push(...Object.values(perAsset.chapters || {}));
    ids.push(...Object.values(perAsset.images || {}));
    ids.push(...Object.values(perAsset.relations || {}));
  }
  ids.push(...Object.values(blocks.questions || {}));
  if (blocks.provenance) ids.push(blocks.provenance);
  return ids;
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

test("template.html の renderFacts が person_matte の object 形（quality / mask_path / mask_format）を描画するコードを持つ", () => {
  // 生成 HTML にはテンプレートの JS ソースがそのまま含まれるため、文字列の有無だけでは表示を検証できない。
  // ここでは描画コードを構造的に固定し、描画結果そのものの実測はヘッドレスブラウザによる L1 に委ねる。
  const templateSource = readFileSync(templatePath, "utf8");
  const factsSection = templateSource.slice(
    templateSource.indexOf("function renderFacts"),
    templateSource.indexOf("function renderRelations"),
  );
  assert.match(factsSection, /const personMatte = tracks\.person_matte\b/, "renderFacts が person_matte を参照する");
  assert.match(
    factsSection,
    /personMatte\s*\?\s*"人物マット: あり"\s*:\s*"人物マット: なし"/,
    "person_matte の真偽で人物マットの有無を出し分ける",
  );
  assert.match(factsSection, /personMatte\.quality\b/, "renderFacts が quality を参照する");
  assert.match(factsSection, /personMatte\.mask_path\b/, "renderFacts が mask_path を参照する");
  assert.match(factsSection, /personMatte\.mask_format\b/, "renderFacts が mask_format を参照する");
  assert.match(factsSection, /マスク併産: あり/, "mask_path があるときマスク併産ありを描画する");
});

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function writeAnalysisWithPersonMatte(dir, personMatte) {
  const analysis = JSON.parse(readFileSync(analysisFixture, "utf8"));
  analysis.tracks.person_matte = personMatte;
  const analysisPath = join(dir, "analysis-minimal.json");
  writeFileSync(analysisPath, JSON.stringify(analysis), "utf8");
  return analysisPath;
}

function renderPersonMatteCase(dir, personMatte, outputName = "report.html") {
  const analysisPath = writeAnalysisWithPersonMatte(dir, personMatte);
  const outPath = join(dir, outputName);
  const result = run([
    "--analysis",
    analysisPath,
    "--interpretation",
    interpretationFixture,
    "--out",
    outPath,
  ]);
  return { analysisPath, outPath, result };
}

test("tracks.person_matte の後方互換 string 形を受理する", () => {
  const dir = mkdtempSync(join(tmpdir(), "analysis-report-test-"));
  try {
    const personMatte = "matte/person.webm";
    const { outPath, result } = renderPersonMatteCase(dir, personMatte);

    assert.equal(result.status, 0, result.stderr);
    const bundle = embeddedBundleOf(readFileSync(outPath, "utf8"));
    assert.equal(bundle.assets[0].analysis.tracks.person_matte, personMatte);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tracks.person_matte の null 形を受理する", () => {
  const dir = mkdtempSync(join(tmpdir(), "analysis-report-test-"));
  try {
    const { outPath, result } = renderPersonMatteCase(dir, null);

    assert.equal(result.status, 0, result.stderr);
    const bundle = embeddedBundleOf(readFileSync(outPath, "utf8"));
    assert.equal(bundle.assets[0].analysis.tracks.person_matte, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tracks.person_matte の object 形（マスクなし）を受理し、quality を保持する", () => {
  const dir = mkdtempSync(join(tmpdir(), "analysis-report-test-"));
  try {
    const personMatte = {
      path: "matte/person.webm",
      fps: 29.97,
      quality: "balanced",
    };
    const { outPath, result } = renderPersonMatteCase(dir, personMatte);

    assert.equal(result.status, 0, result.stderr);
    // 生成 HTML にはテンプレートの JS ソースがそのまま含まれるため、文字列の有無だけでは表示を検証できない。
    // 描画コードは構造トラップで検査し、描画結果そのものの実測はヘッドレスブラウザによる L1 に委ねる。
    const bundle = embeddedBundleOf(readFileSync(outPath, "utf8"));
    assert.deepEqual(bundle.assets[0].analysis.tracks.person_matte, personMatte);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tracks.person_matte の object 形（マスクあり）を受理し、マスク情報を保持する", () => {
  const dir = mkdtempSync(join(tmpdir(), "analysis-report-test-"));
  try {
    const personMatte = {
      path: "matte/person.webm",
      fps: 30,
      quality: "accurate",
      mask_path: "matte/person.webm.mask.mp4",
      mask_format: "gray-h264-fullrange",
    };
    const { outPath, result } = renderPersonMatteCase(dir, personMatte);

    assert.equal(result.status, 0, result.stderr);
    // 生成 HTML にはテンプレートの JS ソースがそのまま含まれるため、文字列の有無だけでは表示を検証できない。
    // 描画コードは構造トラップで検査し、描画結果そのものの実測はヘッドレスブラウザによる L1 に委ねる。
    const bundle = embeddedBundleOf(readFileSync(outPath, "utf8"));
    assert.deepEqual(bundle.assets[0].analysis.tracks.person_matte, personMatte);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tracks.person_matte の不正な object 形は拒否し、ファイルを書き出さない", () => {
  const dir = mkdtempSync(join(tmpdir(), "analysis-report-test-"));
  try {
    const { outPath, result } = renderPersonMatteCase(dir, { fps: 30, quality: "balanced" });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /tracks\.person_matte.*path.*fps/);
    assert.ok(!existsSync(outPath));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tracks.person_matte の object 形でも generatedAt を除き同一入力から同一バイトの report.html を生成する", () => {
  const dir = mkdtempSync(join(tmpdir(), "analysis-report-test-"));
  try {
    const personMatte = {
      path: "matte/person.webm",
      fps: 30,
      quality: "accurate",
      mask_path: "matte/person.webm.mask.mp4",
      mask_format: "gray-h264-fullrange",
    };
    const analysisPath = writeAnalysisWithPersonMatte(dir, personMatte);
    const outPath1 = join(dir, "report-1.html");
    const outPath2 = join(dir, "report-2.html");
    const args = [
      "--analysis",
      analysisPath,
      "--interpretation",
      interpretationFixture,
    ];
    const result1 = run([...args, "--out", outPath1]);
    const result2 = run([...args, "--out", outPath2]);

    assert.equal(result1.status, 0, result1.stderr);
    assert.equal(result2.status, 0, result2.stderr);
    // generatedAt はレポート生成の実行時刻を持つため厳密なバイト一致にはならない。
    // その 1 フィールドだけを固定値へ正規化し、それ以外が完全に決定的であることを検査する。
    const output1 = readFileSync(outPath1);
    const output2 = readFileSync(outPath2);
    const html1 = output1.toString("utf8");
    const html2 = output2.toString("utf8");
    const isoPattern = /20\d\d-\d\d-\d\dT[\d:.]+Z/g;
    const generatedAtPattern = /"generatedAt":"20\d\d-\d\d-\d\dT[\d:.]+Z"/g;
    const isoValues1 = html1.match(isoPattern) || [];
    const isoValues2 = html2.match(isoPattern) || [];
    const generatedAtFields1 = html1.match(generatedAtPattern) || [];
    const generatedAtFields2 = html2.match(generatedAtPattern) || [];

    assert.equal(isoValues1.length, 1, "1 回目の ISO8601 実行時刻は generatedAt の 1 件だけ");
    assert.equal(isoValues2.length, 1, "2 回目の ISO8601 実行時刻は generatedAt の 1 件だけ");
    assert.equal(generatedAtFields1.length, 1, "1 回目の generatedAt フィールドは 1 件だけ");
    assert.equal(generatedAtFields2.length, 1, "2 回目の generatedAt フィールドは 1 件だけ");
    assert.notEqual(isoValues1[0], isoValues2[0], "2 回の生成時刻は異なる");
    assert.notDeepEqual(output1, output2, "正規化前の出力差分には generatedAt の実行時刻がある");

    const normalized1 = html1.replace(generatedAtPattern, '"generatedAt":"<GENERATED_AT>"');
    const normalized2 = html2.replace(generatedAtPattern, '"generatedAt":"<GENERATED_AT>"');
    assert.equal(normalized1, normalized2, "generatedAt の 1 か所を除けば全バイトが一致する");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

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

// vision-tracks v0（docs/contract-2026-08-11-analysis-vision-tracks-v0.md）の消費者追随債務
// 確認: tracks.face_landmarks / tracks.hand_pose / tracks.body_pose_3d / tracks.face_expression という optional キーを持つ
// analysis.json を、この軽量チェック（validateAnalysisStructure）がエラー扱いしないこと。
// person_matte 契約 §9 が残した「消費者の追随債務」を新トラックで繰り返さないための回帰トラップ。
test("4 種の optional vision track pointer を持つ analysis.json も軽量チェックを通る（vision-tracks v0 追随確認）", () => {
  const dir = mkdtempSync(join(tmpdir(), "analysis-report-test-"));
  try {
    const outPath = join(dir, "report.html");
    const result = run([
      "--analysis",
      resolve(here, "fixtures/analysis-vision-tracks.json"),
      "--interpretation",
      resolve(here, "fixtures/interpretation-vision-tracks.json"),
      "--out",
      outPath,
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(outPath), "report.html が生成されている");

    const bundle = embeddedBundleOf(readFileSync(outPath, "utf8"));
    const embeddedTracks = bundle.assets[0].analysis.tracks;
    assert.equal(embeddedTracks.face_landmarks.path, "vision/face-landmarks.json");
    assert.deepEqual(embeddedTracks.face_landmarks.features, ["face_contour"]);
    assert.equal(embeddedTracks.hand_pose.path, "vision/hand-pose.json");
    assert.equal(embeddedTracks.body_pose_3d.path, "vision/body-pose-3d.json");
    assert.equal(embeddedTracks.face_expression.path, "vision/face-expression.json");
    assert.deepEqual(embeddedTracks.face_expression.features, [
      "head-pose-ypr-radians",
      "mediapipe-blendshapes-52",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tracks.face_landmarks.features の空文字・重複は軽量チェックで拒否する", () => {
  const dir = mkdtempSync(join(tmpdir(), "analysis-report-test-"));
  try {
    const broken = JSON.parse(readFileSync(resolve(here, "fixtures/analysis-vision-tracks.json"), "utf8"));
    broken.tracks.face_landmarks.features = ["face_contour", "face_contour", ""];
    const analysisPath = join(dir, "analysis-vision-tracks.json");
    writeFileSync(analysisPath, JSON.stringify(broken), "utf8");
    const result = run([
      "--analysis", analysisPath,
      "--interpretation", resolve(here, "fixtures/interpretation-vision-tracks.json"),
      "--out", join(dir, "report.html"),
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /face_landmarks\.features/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- block-id（doc:<path>#<block-id> 注釈ターゲットの地ならし・2026-07-26）---
//
// 内部契約 contract-2026-07-26-doc-image-annotations.md §1 の 3 要件
// （データ由来・再生成安定・文書内一意）を、対象ブロック 7 種（README.md の
// block-id スキーム節を参照）について検証する。

test("block-id: 対象ブロック全種（7 種）の id が文書内で一意（fixtures/interpretation-blocks-full）", () => {
  const dir = mkdtempSync(join(tmpdir(), "analysis-report-test-"));
  try {
    const outPath = join(dir, "report.html");
    const result = run([
      "--analysis",
      `asset-a=${analysisAssetAFixture}`,
      "--analysis",
      `asset-b=${analysisAssetBFixture}`,
      "--interpretation",
      interpretationBlocksFullFixture,
      "--out",
      outPath,
    ]);

    assert.equal(result.status, 0, result.stderr);
    const html = readFileSync(outPath, "utf8");
    const blocks = embeddedBlocksOf(html);
    const ids = flattenBlockIds(blocks);

    assert.ok(ids.length > 0, "block-id が 1 件以上生成されている");
    assert.equal(new Set(ids).size, ids.length, "全 block-id が文書内で一意（重複ゼロ）");
    assert.ok(!ids.some((id) => id.includes("#")), "block-id は # を含まない");

    const kinds = ["asset-timeline", "transcript-chapter", "asset-facts", "relation", "question", "provenance", "image"];
    for (const kind of kinds) {
      assert.ok(
        ids.some((id) => id === kind || id.startsWith(`${kind}:`)),
        `対象ブロック種別 "${kind}" の block-id が少なくとも 1 件存在する`,
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("block-id: 同一データで 2 回 render しても全 id が完全一致する（再生成安定）", () => {
  const dir = mkdtempSync(join(tmpdir(), "analysis-report-test-"));
  try {
    const args = [
      "--analysis",
      `asset-a=${analysisAssetAFixture}`,
      "--analysis",
      `asset-b=${analysisAssetBFixture}`,
      "--interpretation",
      interpretationBlocksFullFixture,
    ];
    const outPath1 = join(dir, "report-1.html");
    const outPath2 = join(dir, "report-2.html");
    const result1 = run([...args, "--out", outPath1]);
    const result2 = run([...args, "--out", outPath2]);

    assert.equal(result1.status, 0, result1.stderr);
    assert.equal(result2.status, 0, result2.stderr);

    const blocks1 = embeddedBlocksOf(readFileSync(outPath1, "utf8"));
    const blocks2 = embeddedBlocksOf(readFileSync(outPath2, "utf8"));
    assert.deepEqual(blocks1, blocks2, "2 回の render で blocks マニフェストが完全一致する");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("block-id: assets[] の宣言順を入れ替えても同一素材の block-id は不変（並べ替え安定）", () => {
  const dir = mkdtempSync(join(tmpdir(), "analysis-report-test-"));
  try {
    const outPath = join(dir, "report.html");
    const outPathSwapped = join(dir, "report-swapped.html");

    const result = run([
      "--analysis",
      `asset-a=${analysisAssetAFixture}`,
      "--analysis",
      `asset-b=${analysisAssetBFixture}`,
      "--interpretation",
      interpretationBlocksFullFixture,
      "--out",
      outPath,
    ]);
    // 宣言順（assets[] / inputs.analyses[] / open_questions[]）をすべて逆にした
    // fixture。--analysis の CLI 引数順も入れ替える。
    const resultSwapped = run([
      "--analysis",
      `asset-b=${analysisAssetBFixture}`,
      "--analysis",
      `asset-a=${analysisAssetAFixture}`,
      "--interpretation",
      interpretationBlocksFullSwappedFixture,
      "--out",
      outPathSwapped,
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(resultSwapped.status, 0, resultSwapped.stderr);

    const blocks = embeddedBlocksOf(readFileSync(outPath, "utf8"));
    const blocksSwapped = embeddedBlocksOf(readFileSync(outPathSwapped, "utf8"));

    assert.deepEqual(
      blocks.byRef["asset-a"],
      blocksSwapped.byRef["asset-a"],
      "asset-a の block-id 一式は宣言順に依存しない",
    );
    assert.deepEqual(
      blocks.byRef["asset-b"],
      blocksSwapped.byRef["asset-b"],
      "asset-b の block-id 一式は宣言順に依存しない",
    );
    assert.deepEqual(blocks.questions, blocksSwapped.questions, "取材台帳の block-id は宣言順に依存しない");
    assert.equal(blocks.provenance, blocksSwapped.provenance);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("block-id: 取材台帳の質問行 id に open_questions[].id が使われている", () => {
  const dir = mkdtempSync(join(tmpdir(), "analysis-report-test-"));
  try {
    const outPath = join(dir, "report.html");
    const result = run([
      "--analysis",
      `asset-a=${analysisAssetAFixture}`,
      "--analysis",
      `asset-b=${analysisAssetBFixture}`,
      "--interpretation",
      interpretationBlocksFullFixture,
      "--out",
      outPath,
    ]);

    assert.equal(result.status, 0, result.stderr);
    const html = readFileSync(outPath, "utf8");
    const bundle = embeddedBundleOf(html);
    const blocks = embeddedBlocksOf(html);

    const questionIds = bundle.interpretation.open_questions.map((q) => q.id);
    assert.deepEqual(questionIds.sort(), ["oq-01", "oq-02"], "fixture の質問 id 前提");
    for (const qid of questionIds) {
      assert.equal(blocks.questions[qid], `question:${qid}`, "質問行の block-id が open_questions[].id 由来である");
    }

    // template.html の inline script が open_questions[].id を経由せず自前で
    // 別の block-id を作っていないことも合わせて固定する（SSOT は CLI 側）。
    const templateSource = readFileSync(templatePath, "utf8");
    assert.match(
      templateSource,
      /blocksManifest\.questions\?\.\[question\.id\]/,
      "取材台帳の行は blocksManifest.questions[question.id] を参照する",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("block-id: id 衝突を人工的に作る入力はハードエラーで拒否し、report.html を書き出さない", () => {
  const dir = mkdtempSync(join(tmpdir(), "analysis-report-test-"));
  try {
    const outPath = join(dir, "report.html");
    // 同一 t（開始秒）の chapter イベントを 2 つ持つ analysis.json は
    // transcript-chapter:clip-01:0 を 2 回生成し、文書内衝突になる。
    const result = run([
      "--analysis",
      analysisCollisionFixture,
      "--interpretation",
      interpretationFixture,
      "--out",
      outPath,
    ]);

    assert.notEqual(result.status, 0, "block-id 衝突はエラーで落ちる");
    assert.match(result.stderr, /block-id.*衝突/);
    assert.match(result.stderr, /transcript-chapter:clip-01:0/);
    assert.ok(!existsSync(outPath), "衝突検出時は report.html を書き出さない");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("block-id: データ payload script の中身は入力 JSON と同一内容のまま（生データ原則の担保）", () => {
  const dir = mkdtempSync(join(tmpdir(), "analysis-report-test-"));
  try {
    const outPath = join(dir, "report.html");
    const result = run([
      "--analysis",
      `asset-a=${analysisAssetAFixture}`,
      "--analysis",
      `asset-b=${analysisAssetBFixture}`,
      "--interpretation",
      interpretationBlocksFullFixture,
      "--out",
      outPath,
    ]);

    assert.equal(result.status, 0, result.stderr);
    const bundle = embeddedBundleOf(readFileSync(outPath, "utf8"));

    const originalInterpretation = JSON.parse(readFileSync(interpretationBlocksFullFixture, "utf8"));
    assert.deepEqual(
      bundle.interpretation,
      originalInterpretation,
      "interpretation はそのまま埋め込まれている（block-id 由来のフィールドを追加していない）",
    );

    const originalAssetA = JSON.parse(readFileSync(analysisAssetAFixture, "utf8"));
    const embeddedAssetA = bundle.assets.find((a) => a.ref === "asset-a").analysis;
    for (const field of ["version", "source", "transcript", "events", "tracks"]) {
      assert.deepEqual(embeddedAssetA[field], originalAssetA[field], `analysis.${field} は不変`);
    }
    // keyframes は既存仕様で imageSrc が追加される（block-id とは無関係の既存挙動）。
    // それ以外のキーフレーム由来フィールドは元データと一致する。
    assert.equal(embeddedAssetA.keyframes.length, originalAssetA.keyframes.length);
    for (const [index, kf] of embeddedAssetA.keyframes.entries()) {
      assert.equal(kf.t, originalAssetA.keyframes[index].t);
      assert.equal(kf.path, originalAssetA.keyframes[index].path);
      assert.equal(kf.note, originalAssetA.keyframes[index].note);
    }

    for (const asset of bundle.assets) {
      assert.deepEqual(
        Object.keys(asset).sort(),
        ["analysis", "analysisPath", "ref"],
        "assets[] の各エントリに block-id 由来の新規キーを追加していない",
      );
    }
    assert.ok(!hasOwn(bundle, "blocksManifest"), "bundle 本体に blocksManifest を混ぜない（別 script タグの原則）");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
