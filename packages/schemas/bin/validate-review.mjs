#!/usr/bin/env node

// review.json v1 注釈モデルの構造と、JSON Schema 単体では表せない範囲・整合制約を検証する。
// targetKind の型別期待フィールド（契約 §3）は助言レベルのため warning（stderr）に出し、
// exit code は errors のみで決定する。edit.json との参照整合（src 等）は edit-lint の責務。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const usage = "使い方: node packages/schemas/bin/validate-review.mjs <review.json>";
const reviewArgument = process.argv[2];

if (!reviewArgument || process.argv.length !== 3) {
  console.error(usage);
  process.exit(2);
}

if (reviewArgument === "--help" || reviewArgument === "-h") {
  console.log(usage);
  process.exit(0);
}

const reviewPath = path.resolve(reviewArgument);
const schemaPath = fileURLToPath(new URL("../review.schema.json", import.meta.url));
const errors = [];
const warnings = [];

const TARGET_KINDS = new Set(["instant", "range", "region", "asset", "insert"]);
const STATUSES = new Set(["open", "addressed", "resolved"]);
const INPUTS = new Set(["typed", "voice"]);
// contract-2026-07-26-doc-image-annotations §1: doc:<プロジェクト相対パス>#<block-id> / image:<プロジェクト相対パス>。
// この 2 種に限り §2 で sourceT: null を許容する。
const DOC_TARGET_PATTERN = /^doc:(.+)#(.+)$/;
const IMAGE_TARGET_PATTERN = /^image:(.+)$/;

if (!isRegularFile(reviewPath)) {
  fail(`review.json が見つかりません: ${reviewPath}`);
  finish();
}

let schema;
try {
  schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
} catch (error) {
  fail(`review.schema.json を JSON として読めません: ${messageOf(error)}`);
  finish();
}
if (schema.$id !== "urn:akari-video:schema:review:v1") {
  fail("review.schema.json の $id が v1 契約と一致しません");
  finish();
}

let review;
try {
  review = JSON.parse(fs.readFileSync(reviewPath, "utf8"));
} catch (error) {
  fail(`review.json を JSON として読めません: ${messageOf(error)}`);
  finish();
}

validateReview(review);
finish();

function validateReview(value) {
  if (!isPlainObject(value)) {
    fail("review.json のルートは object である必要があります");
    return;
  }
  if (Number.isInteger(value.version) && value.version > 0) {
    fail(
      `version ${value.version} は新しすぎるため検証できません。このファイルは新しい形式です。スキル / アプリを更新してください`,
    );
    return;
  }
  if (value.version !== 0) {
    fail("version は 0 である必要があります");
    return;
  }
  if (!Array.isArray(value.annotations)) {
    fail("annotations は配列である必要があります");
    return;
  }
  const ids = new Set();
  for (const [index, annotation] of value.annotations.entries()) {
    validateAnnotation(annotation, index, ids);
  }
}

function validateAnnotation(value, index, ids) {
  const label = `annotations[${index}]`;
  if (!isPlainObject(value)) {
    fail(`${label} は object である必要があります`);
    return;
  }
  if (!isNonEmptyString(value.id)) {
    fail(`${label}.id は空でない文字列である必要があります`);
  } else {
    if (ids.has(value.id)) fail(`annotations[].id が重複しています: ${value.id}`);
    ids.add(value.id);
    if (!/^a-\d{4,}$/.test(value.id)) {
      warn(`${label}.id が推奨形式 a-0000 と異なります: ${value.id}`);
    }
  }
  if (typeof value.createdAt !== "string") {
    fail(`${label}.createdAt は文字列である必要があります`);
  }
  const docOrImageTarget = isDocOrImageTarget(value.target);
  if (value.sourceT === null) {
    if (!docOrImageTarget) {
      fail(
        `${label}.sourceT は target が doc: / image: のときに限り null を許容します（動画面の注釈には時刻が必要です）`,
      );
    }
  } else if (!isFiniteNumber(value.sourceT) || value.sourceT < 0) {
    fail(`${label}.sourceT は 0 以上の有限数（source 秒）である必要があります`);
  }
  validateTarget(value.target, label);
  if (typeof value.text !== "string") {
    fail(`${label}.text は文字列である必要があります`);
  }
  if (!INPUTS.has(value.input)) {
    fail(`${label}.input は typed または voice である必要があります`);
  }
  if (!STATUSES.has(value.status)) {
    fail(`${label}.status は open / addressed / resolved のいずれかである必要があります`);
  }
  validateSourceRange(value.sourceRange, label);
  validateOptionalNonEmptyString(value.src, `${label}.src`);
  validateOptionalNonEmptyString(value.audio, `${label}.audio`);
  validateOptionalNonEmptyString(value.intent, `${label}.intent`);
  if (hasOwn(value, "timelineT") && value.timelineT !== null) {
    if (!isFiniteNumber(value.timelineT)) {
      fail(`${label}.timelineT は null または有限数である必要があります`);
    } else {
      warn(
        `${label}.timelineT は非推奨です（timeline 位置は cuts[] からの射影で求める）。新規書き込みは null にしてください`,
      );
    }
  }
  const targetKind = validateTargetKind(value.targetKind, label);
  const region = validateRegion(value.region, label);
  const strokes = validateStrokes(value.strokes, label);
  const refs = validateRefs(value.refs, label);
  const insertPosition = validateInsertPosition(value.insertPosition, label);
  if (hasOwn(value, "poses") && value.poses !== null) {
    warn(`${label}.poses は予約フィールドです（このバージョンでは無視されます）`);
  }
  validateResponse(value.response, label);

  if (region && strokes) {
    warn(`${label} は region と strokes の両方を持っています（region.box が優先されます）`);
  }
  if (targetKind === "range" && !Array.isArray(value.sourceRange)) {
    warn(`${label} は targetKind range ですが sourceRange がありません`);
  }
  if (targetKind === "region" && !region && !strokes) {
    warn(`${label} は targetKind region ですが region / strokes のいずれもありません`);
  }
  if (targetKind === "asset" && !refs) {
    warn(`${label} は targetKind asset ですが refs がありません`);
  }
  if (targetKind === "insert" && !insertPosition) {
    warn(`${label} は targetKind insert ですが insertPosition がありません`);
  }
}

function isDocOrImageTarget(value) {
  return typeof value === "string" && (DOC_TARGET_PATTERN.test(value) || IMAGE_TARGET_PATTERN.test(value));
}

function validateTarget(value, label) {
  if (value === undefined || value === null) return;
  if (typeof value !== "string" || !value) {
    fail(`${label}.target は null または空でない文字列である必要があります`);
    return;
  }
  if (value.startsWith("doc:") && !DOC_TARGET_PATTERN.test(value)) {
    fail(`${label}.target は doc:<プロジェクト相対パス>#<block-id> の形式である必要があります: ${value}`);
  } else if (value.startsWith("image:") && !IMAGE_TARGET_PATTERN.test(value)) {
    fail(`${label}.target は image:<プロジェクト相対パス> の形式である必要があります: ${value}`);
  }
}

function validateTargetKind(value, label) {
  if (value === undefined || value === null) return null;
  if (!TARGET_KINDS.has(value)) {
    fail(
      `${label}.targetKind は instant / range / region / asset / insert または null である必要があります`,
    );
    return null;
  }
  return value;
}

function validateSourceRange(value, label) {
  if (value === undefined || value === null) return;
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !isFiniteNumber(value[0]) ||
    !isFiniteNumber(value[1])
  ) {
    fail(`${label}.sourceRange は null または [start, end] の数値 2 要素配列である必要があります`);
    return;
  }
  if (value[0] < 0 || value[1] <= value[0]) {
    fail(`${label}.sourceRange は 0 <= start < end を満たす必要があります`);
  }
}

function validateRegion(value, label) {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value) || !Array.isArray(value.box) || value.box.length !== 4) {
    fail(`${label}.region は null または { box: [x, y, w, h] } である必要があります`);
    return null;
  }
  const [x, y, w, h] = value.box;
  const finite = value.box.every((entry) => isFiniteNumber(entry) && entry >= 0 && entry <= 1);
  if (!finite || w <= 0 || h <= 0 || x + w > 1 || y + h > 1) {
    fail(
      `${label}.region.box は 0〜1 の正規化座標で x+w<=1 かつ y+h<=1 を満たす必要があります（source フレーム基準）`,
    );
    return null;
  }
  return value;
}

function validateStrokes(value, label) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length === 0) {
    fail(`${label}.strokes は null または 1 本以上のストローク配列である必要があります`);
    return null;
  }
  for (const [strokeIndex, stroke] of value.entries()) {
    if (!Array.isArray(stroke) || stroke.length < 2) {
      fail(`${label}.strokes[${strokeIndex}] は 2 点以上の [x, y] 点列である必要があります`);
      return null;
    }
    for (const point of stroke) {
      if (
        !Array.isArray(point) ||
        point.length !== 2 ||
        !point.every((entry) => isFiniteNumber(entry) && entry >= 0 && entry <= 1)
      ) {
        fail(
          `${label}.strokes[${strokeIndex}] の点は 0〜1 の正規化座標 [x, y] である必要があります（source フレーム基準）`,
        );
        return null;
      }
    }
  }
  return value;
}

function validateRefs(value, label) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length === 0) {
    fail(`${label}.refs は null または 1 件以上の配列である必要があります`);
    return null;
  }
  for (const [refIndex, ref] of value.entries()) {
    if (!isPlainObject(ref)) {
      fail(`${label}.refs[${refIndex}] は object である必要があります`);
      return null;
    }
    const hasSrc = hasOwn(ref, "src");
    const hasPath = hasOwn(ref, "path");
    if (hasSrc === hasPath) {
      fail(`${label}.refs[${refIndex}] は src / path のどちらか一方だけを持つ必要があります`);
      return null;
    }
    const reference = hasSrc ? ref.src : ref.path;
    if (!isNonEmptyString(reference)) {
      fail(`${label}.refs[${refIndex}].${hasSrc ? "src" : "path"} は空でない文字列である必要があります`);
      return null;
    }
  }
  return value;
}

function validateInsertPosition(value, label) {
  if (value === undefined || value === null) return null;
  if (value !== "before" && value !== "after") {
    fail(`${label}.insertPosition は before / after または null である必要があります`);
    return null;
  }
  return value;
}

function validateResponse(value, label) {
  if (value === undefined || value === null) return;
  if (
    !isPlainObject(value) ||
    typeof value.summary !== "string" ||
    (value.action !== "edited" && value.action !== "declined") ||
    typeof value.respondedAt !== "string"
  ) {
    fail(`${label}.response は null または { summary, action, respondedAt } である必要があります`);
  }
}

function validateOptionalNonEmptyString(value, label) {
  if (value === undefined || value === null) return;
  if (!isNonEmptyString(value)) {
    fail(`${label} は null または空でない文字列である必要があります`);
  }
}

function isRegularFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function fail(message) {
  errors.push(message);
}

function warn(message) {
  warnings.push(message);
}

function finish() {
  for (const warning of warnings) console.error(`warning: ${warning}`);
  if (errors.length > 0) {
    console.error(`NG: ${reviewPath}`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(`OK: ${reviewPath}${warnings.length > 0 ? ` (${warnings.length} warnings)` : ""}`);
  process.exit(0);
}
