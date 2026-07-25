#!/usr/bin/env node

// analysis.json（事実層・複数可）+ interpretation.json（解釈層・プロジェクト単位 1 ファイル）から
// 読み取り専用の分析レポート HTML を生成する。
//
// テンプレート（template.html）は不変の UI 正本で、このスクリプトの役割は
// (1) interpretation.json を validate-interpretation.mjs で検証する
// (2) analysis.json 群を構造的に検証する
// (3) keyframe 画像の実在確認（存在すれば相対パスを解決、無ければ null — テンプレ側が
//     note チップへ縮退する）
// (4) 生データをそのまま <script type="application/json"> ブロックへ束ねて埋め込む
// だけであり、章の折りたたみ・空状態文言・バッジ表示などの描画ロジックは一切持たない
// （それは template.html の役割）。interpretation.json の arc はここでも束ねてそのまま
// 埋め込む（レポート表示からは除外されるが、schema・データは不変 — 2026-07-22 改訂）。

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const templatePath = resolve(here, "template.html");
const validateInterpretationBin = resolve(
  here,
  "../schemas/bin/validate-interpretation.mjs",
);

const DATA_PLACEHOLDER = '{"__AKARI_ANALYSIS_REPORT_DATA__": true}';
const BLOCKS_PLACEHOLDER = '{"__AKARI_ANALYSIS_REPORT_BLOCKS__": true}';

function usage() {
  return [
    "使い方:",
    "  node render-analysis-report.mjs --analysis <ref>=<path> [--analysis <ref>=<path> ...] --interpretation <path> --out <report.html>",
    "",
    "  --analysis の正式形は <ref>=<path>（ref は interpretation.assets[].ref を明示する）。",
    "  素の <path> のみの指定も許容するが、inputs.analyses[].path と basename / suffix で",
    "  一意に照合できる場合に限る（不一致・曖昧は即エラー。順序へのフォールバックはしない）。",
    "  どちらの形でも、与えた path は当該 ref の inputs.analyses[].path と対応しているかを",
    "  照合する（2026-07-22 A3.2 の取り違え実証を受けた FK クロスチェック）。",
    "  interpretation.assets[] の全 ref に対応する --analysis が過不足なく必要。",
  ].join("\n");
}

function parseArgs(argv) {
  const analysisPaths = [];
  let interpretationPath = null;
  let outPath = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      return { help: true };
    }
    if (arg === "--analysis") {
      const value = argv[i + 1];
      if (value === undefined) throw new Error("--analysis には値が必要です");
      analysisPaths.push(value);
      i += 1;
      continue;
    }
    if (arg === "--interpretation") {
      const value = argv[i + 1];
      if (value === undefined) throw new Error("--interpretation には値が必要です");
      interpretationPath = value;
      i += 1;
      continue;
    }
    if (arg === "--out") {
      const value = argv[i + 1];
      if (value === undefined) throw new Error("--out には値が必要です");
      outPath = value;
      i += 1;
      continue;
    }
    throw new Error(`未知の引数です: ${arg}`);
  }

  if (analysisPaths.length === 0) throw new Error("--analysis を 1 件以上指定してください");
  if (!interpretationPath) throw new Error("--interpretation は必須です");
  if (!outPath) throw new Error("--out は必須です");

  return { help: false, analysisPaths, interpretationPath, outPath };
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function readJson(path, label) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    fail(`${label} を読み込めません: ${path}\n${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`${label} が有効な JSON ではありません: ${path}\n${error.message}`);
  }
  return undefined;
}

// analysis.schema.json の必須構造のみを検査する軽量チェック（zero-dep 方針のため ajv 等は
// 導入しない）。events[] の判別ユニオンの厳密な検証は行わない — 明らかな壊れ入力の拒否が目的。
function validateAnalysisStructure(analysis, label) {
  const errors = [];
  if (!isRecord(analysis)) {
    errors.push("ルートは object である必要があります");
    return errors;
  }
  if (analysis.version !== 0) errors.push("version は 0 である必要があります");
  if (!isNonEmptyString(analysis.source)) errors.push("source は空でない文字列である必要があります");
  for (const field of ["transcript", "keyframes", "events"]) {
    if (!Array.isArray(analysis[field])) errors.push(`${field} は配列である必要があります`);
  }
  if (!isRecord(analysis.tracks)) {
    errors.push("tracks は object である必要があります");
  } else {
    if (!Array.isArray(analysis.tracks.speakers)) errors.push("tracks.speakers は配列である必要があります");
    if (!Array.isArray(analysis.tracks.faces)) errors.push("tracks.faces は配列である必要があります");
    if (
      !hasOwn(analysis.tracks, "person_matte") ||
      (analysis.tracks.person_matte !== null && typeof analysis.tracks.person_matte !== "string")
    ) {
      errors.push("tracks.person_matte は string か null である必要があります");
    }
  }
  for (const [index, kf] of (analysis.keyframes || []).entries()) {
    if (!isRecord(kf)) {
      errors.push(`keyframes[${index}] は object である必要があります`);
      continue;
    }
    if (typeof kf.t !== "number") errors.push(`keyframes[${index}].t は数値である必要があります`);
    if (!isNonEmptyString(kf.path)) errors.push(`keyframes[${index}].path は空でない文字列である必要があります`);
    if (!isNonEmptyString(kf.note)) errors.push(`keyframes[${index}].note は空でない文字列である必要があります`);
  }
  for (const [index, seg] of (analysis.transcript || []).entries()) {
    if (!isRecord(seg) || typeof seg.start !== "number" || typeof seg.end !== "number" || !isNonEmptyString(seg.text)) {
      errors.push(`transcript[${index}] は start/end(数値)・text(空でない文字列) を持つ object である必要があります`);
    }
  }
  for (const [index, event] of (analysis.events || []).entries()) {
    if (!isRecord(event) || !isNonEmptyString(event.type)) {
      errors.push(`events[${index}] は type を持つ object である必要があります`);
      continue;
    }
    if (event.type === "chapter" && typeof event.t !== "number") {
      errors.push(`events[${index}] (chapter) は t(数値) が必要です`);
    }
    if (["trouble", "filler", "hook", "highlight"].includes(event.type)) {
      if (typeof event.start !== "number" || typeof event.end !== "number") {
        errors.push(`events[${index}] (${event.type}) は start/end(数値) が必要です`);
      }
    }
  }
  return errors;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function toPosixRelative(fromDir, toPath) {
  const rel = relative(fromDir, toPath);
  return rel.split(sep).join("/");
}

// --- block-id 導出（doc:<path>#<block-id> 注釈ターゲットの地ならし）---
//
// 内部契約 contract-2026-07-26-doc-image-annotations.md §1 の 3 要件
// （データ由来・再生成安定・文書内一意）を満たす block-id を、埋め込む生データ
// （bundle）から導出する純関数群。生成した blocks マニフェストは bundle 本体には
// 混ぜず、別の <script type="application/json" id="akari-analysis-report-blocks">
// として template.html 側へ埋め込む（「生データをそのまま埋め込む」原則を保つため）。

class BlockIdCollisionError extends Error {
  constructor(duplicateIds) {
    super(`block-id が文書内で衝突しています: ${duplicateIds.join(", ")}`);
    this.duplicateIds = duplicateIds;
  }
}

// URL fragment として安全にするため、id を構成する各データ由来セグメントを
// percent-encode する（encodeURIComponent は "#" を含め fragment 中で意味を持つ
// 文字を必ず潰す）。セグメント間の区切りは常に ":"（encodeURIComponent は ":" を
// 必ずエンコードするため、区切りとセグメント内部の値が衝突しない）。
function blockId(kind, ...parts) {
  return [kind, ...parts.map((part) => encodeURIComponent(String(part)))].join(":");
}

// analysis.events の chapter を開始秒昇順で並べたキー列。template.html の
// chaptersOf() と同じフィルタ・ソートを独立に再現している。章そのものには
// analysis.schema 上 id 相当のフィールドが無いため、開始秒 (t) を「データ由来
// キー（無ければ章開始時刻）」の「無ければ」側の安定キーとして採用する。
// chaptersOf() のソートロジックを変えるときはここも合わせて直すこと。
function chapterStartKeysOf(analysis) {
  return (analysis.events || [])
    .filter((event) => event.type === "chapter")
    .map((event) => event.t)
    .sort((a, b) => a - b);
}

// bundle（このスクリプトが template.html へ埋め込む生データそのもの）から
// blocks マニフェストを導出する。assets[] や relations[] / open_questions[] の
// 並び順には一切依存しない（ref・target/kind・question.id など内容由来のキーのみ
// 使う）ため、入力の並べ替えに対して安定する。
function buildBlocksManifest(bundle) {
  const ids = [];
  const record = (id) => {
    ids.push(id);
    return id;
  };

  const interpAssetsByRef = new Map(
    (bundle.interpretation.assets || []).map((asset) => [asset.ref, asset]),
  );

  const byRef = {};
  for (const asset of bundle.assets) {
    const ref = asset.ref;
    const analysis = asset.analysis;
    const interpAsset = interpAssetsByRef.get(ref);

    const chapterStartKeys = chapterStartKeysOf(analysis);
    const chapters = {};
    if (chapterStartKeys.length === 0) {
      // 章情報が無い素材は transcript 全体を 1 ブロックとして扱う（template.html
      // 側の「章情報なし」details 1 個に対応）。
      chapters.unchaptered = record(blockId("transcript-chapter", ref, "unchaptered"));
    } else {
      for (const start of chapterStartKeys) {
        chapters[String(start)] = record(blockId("transcript-chapter", ref, start));
      }
    }

    const images = {};
    for (const kf of analysis.keyframes || []) {
      // 画像が実在確認できた（imageSrc が非 null）キーフレームのみ block-id を持つ
      // — template.html は imageSrc が無いキーフレームには img 要素を描画しない。
      if (kf.imageSrc) {
        images[kf.path] = record(blockId("image", ref, kf.path));
      }
    }

    const relations = {};
    for (const relation of (interpAsset && interpAsset.relations) || []) {
      const key = JSON.stringify([relation.target, relation.kind]);
      relations[key] = record(blockId("relation", ref, relation.target, relation.kind));
    }

    byRef[ref] = {
      timeline: record(blockId("asset-timeline", ref)),
      facts: record(blockId("asset-facts", ref)),
      chapters,
      images,
      relations,
    };
  }

  const questions = {};
  for (const question of bundle.interpretation.open_questions || []) {
    questions[question.id] = record(blockId("question", question.id));
  }

  // 来歴（節 6）は「節単位で可」（契約 §1 対象ブロック表）に従い固定キー 1 個。
  const provenance = record(blockId("provenance", "section"));

  const counts = new Map();
  for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1);
  const duplicates = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id);
  if (duplicates.length > 0) {
    throw new BlockIdCollisionError(duplicates);
  }

  return { version: 0, byRef, questions, provenance };
}

// --- FK 結合（2026-07-22 A3.2 の swap 実証への対応）---
//
// 位置対応づけ（i 番目の --analysis が assets[i]）を廃止し、ref で結合する。
// 正式形は --analysis <ref>=<path>。素の <path> のみの指定も許容するが、
// interpretation.json の inputs.analyses[].path と一意に照合できる場合に限る
// （basename または path segment の末尾一致が 1 件に定まる場合）。どちらの形でも、
// 最終的に確定した ref に対応する inputs.analyses[].path と、CLI で与えた path が
// 対応しているかを追加でクロスチェックする — ref=path 形式で意図的/誤って
// 取り違えたペアを渡した場合もここで検出する。

function pathSegments(value) {
  return value
    .split(/[\\/]+/)
    .filter((segment) => segment.length > 0 && segment !== ".");
}

// b の path segment 列が a の末尾（または a が b の末尾）と一致するかを見る。
// 双方の basename（segment 数 1）同士の比較もこの関数でカバーされる。
function isPathSuffixMatch(a, b) {
  const segA = pathSegments(a);
  const segB = pathSegments(b);
  if (segA.length === 0 || segB.length === 0) return false;
  const [shorter, longer] = segA.length <= segB.length ? [segA, segB] : [segB, segA];
  const offset = longer.length - shorter.length;
  for (let i = 0; i < shorter.length; i += 1) {
    if (longer[offset + i] !== shorter[i]) return false;
  }
  return true;
}

function pathsCorrespond(rawPath, recordedPath, interpretationDir) {
  if (isPathSuffixMatch(rawPath, recordedPath)) return true;
  try {
    return resolve(rawPath) === resolve(interpretationDir, recordedPath);
  } catch {
    return false;
  }
}

// 素の path 指定から、inputs.analyses[].path との一意照合で ref を確定する。
// 一致 0 件・複数件（曖昧）はどちらもハードエラー（順序へのフォールバックはしない）。
// pathsCorrespond と同じ判定（suffix match または絶対パス一致）を使う — 相対パスに
// ".." が含まれる場合、素朴な segment 末尾一致だけでは判定できないため。
function resolveBareAnalysisRef(rawPath, analysesEntries, interpretationDir) {
  const matchingRefs = new Set();
  for (const entry of analysesEntries) {
    if (!entry || typeof entry.path !== "string" || typeof entry.ref !== "string") continue;
    if (pathsCorrespond(rawPath, entry.path, interpretationDir)) matchingRefs.add(entry.ref);
  }
  if (matchingRefs.size === 0) {
    fail(
      `--analysis の path が inputs.analyses[].path のいずれとも一致しません` +
        `（--analysis <ref>=<path> 形式で明示してください）: ${rawPath}`,
    );
  }
  if (matchingRefs.size > 1) {
    fail(
      `--analysis の path が inputs.analyses[].path に複数一致し一意に定まりません` +
        `（--analysis <ref>=<path> 形式で明示してください）: ${rawPath}`,
    );
  }
  return [...matchingRefs][0];
}

// --analysis 引数群を解決し、Map<ref, rawPath>（CLI で与えられた生の path 文字列）を返す。
function resolveAnalysisArgs(analysisArgs, interpretation, interpretationDir) {
  const interpAssets = interpretation.assets || [];
  const assetRefs = new Set(interpAssets.map((asset) => asset.ref));
  const analysesEntries = (interpretation.inputs && interpretation.inputs.analyses) || [];
  const analysesEntryByRef = new Map(
    analysesEntries
      .filter((entry) => entry && typeof entry.ref === "string")
      .map((entry) => [entry.ref, entry]),
  );

  const pathByRef = new Map();

  for (const analysisArg of analysisArgs) {
    const eqIndex = analysisArg.indexOf("=");
    let ref;
    let rawPath;
    if (eqIndex > 0) {
      ref = analysisArg.slice(0, eqIndex);
      rawPath = analysisArg.slice(eqIndex + 1);
      if (!rawPath) {
        fail(`--analysis の指定が不正です（ref=path の path が空です）: ${analysisArg}`);
      }
      if (!assetRefs.has(ref)) {
        fail(`--analysis の ref が interpretation.assets[].ref に存在しません: ${ref}（${analysisArg}）`);
      }
    } else {
      rawPath = analysisArg;
      ref = resolveBareAnalysisRef(rawPath, analysesEntries, interpretationDir);
    }

    // FK クロスチェック: 確定した ref に対応する inputs.analyses[].path と、CLI で
    // 与えられた path が対応しているかを検証する（取り違えの実証への対応）。
    const recordedEntry = analysesEntryByRef.get(ref);
    if (recordedEntry && !pathsCorrespond(rawPath, recordedEntry.path, interpretationDir)) {
      fail(
        `--analysis の path が ref『${ref}』の inputs.analyses[].path` +
          `（${recordedEntry.path}）と対応していません: ${rawPath}` +
          "（取り違えの疑いがあります。--analysis <ref>=<path> の対応を再確認してください）",
      );
    }

    if (pathByRef.has(ref)) {
      fail(`--analysis に同じ ref が重複して指定されています: ${ref}`);
    }
    pathByRef.set(ref, rawPath);
  }

  const missingRefs = [...assetRefs].filter((ref) => !pathByRef.has(ref));
  if (missingRefs.length > 0) {
    fail(`assets[].ref に対応する --analysis が指定されていません: ${missingRefs.join(", ")}`);
  }

  return pathByRef;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error("");
    console.error(usage());
    process.exit(2);
  }

  if (args.help) {
    console.log(usage());
    process.exit(0);
  }

  const interpretationAbsolutePath = resolve(args.interpretationPath);
  if (!existsSync(interpretationAbsolutePath)) {
    fail(`interpretation.json が見つかりません: ${interpretationAbsolutePath}`);
  }

  // interpretation.json は SSOT である packages/schemas/bin/validate-interpretation.mjs で
  // 検証する（このスクリプト側でロジックを複製しない）。PASS しなければ何も書き出さず終了する。
  try {
    execFileSync(process.execPath, [validateInterpretationBin, interpretationAbsolutePath], {
      stdio: "pipe",
    });
  } catch (error) {
    console.error(`interpretation.json の検証に失敗しました（validate-interpretation.mjs）: ${interpretationAbsolutePath}`);
    if (error.stdout) console.error(error.stdout.toString());
    if (error.stderr) console.error(error.stderr.toString());
    process.exit(1);
  }

  const interpretation = readJson(interpretationAbsolutePath, "interpretation.json");
  const interpAssets = interpretation.assets || [];
  const interpretationDir = dirname(interpretationAbsolutePath);

  const pathByRef = resolveAnalysisArgs(args.analysisPaths, interpretation, interpretationDir);

  const outAbsolutePath = resolve(args.outPath);
  const outDir = dirname(outAbsolutePath);

  // assets[] は常に interpretation.assets[] の順序で束ねる（CLI 引数の順序には依存しない）。
  const assets = [];
  for (const interpAsset of interpAssets) {
    const analysisArg = pathByRef.get(interpAsset.ref);
    const analysisAbsolutePath = resolve(analysisArg);
    if (!existsSync(analysisAbsolutePath)) {
      fail(`analysis.json が見つかりません: ${analysisAbsolutePath}`);
    }
    const analysis = readJson(analysisAbsolutePath, "analysis.json");
    const errors = validateAnalysisStructure(analysis, analysisAbsolutePath);
    if (errors.length > 0) {
      console.error(`analysis.json の構造検証に失敗しました: ${analysisAbsolutePath}`);
      for (const message of errors) console.error(`- ${message}`);
      process.exit(1);
    }

    const analysisDir = dirname(analysisAbsolutePath);
    const resolvedKeyframes = (analysis.keyframes || []).map((kf) => {
      const kfAbsolutePath = resolve(analysisDir, kf.path);
      let imageSrc = null;
      try {
        if (existsSync(kfAbsolutePath) && statSync(kfAbsolutePath).isFile()) {
          imageSrc = toPosixRelative(outDir, kfAbsolutePath);
        }
      } catch {
        imageSrc = null;
      }
      return { ...kf, imageSrc };
    });

    assets.push({
      ref: interpAsset.ref,
      analysisPath: isAbsolute(analysisArg) ? analysisArg : toPosixRelative(process.cwd(), analysisAbsolutePath),
      analysis: { ...analysis, keyframes: resolvedKeyframes },
    });
  }

  const bundle = {
    version: 0,
    generatedAt: new Date().toISOString(),
    assets,
    interpretation,
  };

  let blocksManifest;
  try {
    blocksManifest = buildBlocksManifest(bundle);
  } catch (error) {
    if (error instanceof BlockIdCollisionError) {
      fail(`block-id の導出に失敗しました: ${error.message}`);
    }
    throw error;
  }

  const serialized = JSON.stringify(bundle).replace(/</g, "\\u003c");
  const serializedBlocks = JSON.stringify(blocksManifest).replace(/</g, "\\u003c");

  const templateText = readFileSync(templatePath, "utf8");
  if (!templateText.includes(DATA_PLACEHOLDER)) {
    fail(`template.html の埋め込み用プレースホルダーが見つかりません: ${templatePath}`);
  }
  if (!templateText.includes(BLOCKS_PLACEHOLDER)) {
    fail(`template.html の block-id マニフェスト埋め込み用プレースホルダーが見つかりません: ${templatePath}`);
  }
  const rendered = templateText
    .replace(DATA_PLACEHOLDER, serialized)
    .replace(BLOCKS_PLACEHOLDER, serializedBlocks);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(outAbsolutePath, rendered, "utf8");

  const bytes = Buffer.byteLength(rendered, "utf8");
  console.log(`OK: ${outAbsolutePath} (${bytes.toLocaleString("en-US")} bytes)`);
}

main();
