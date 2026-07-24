#!/usr/bin/env node

// plan-comments.json v0（承認可能プラン層への構造化差し戻し）の構造を検証する。
// docs/contract-2026-07-25-plan-comments-v0.md 参照。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const usage = "使い方: node packages/schemas/bin/validate-plan-comments.mjs <plan-comments.json>";
const planCommentsArgument = process.argv[2];

if (!planCommentsArgument || process.argv.length !== 3) {
  console.error(usage);
  process.exit(2);
}

if (planCommentsArgument === "--help" || planCommentsArgument === "-h") {
  console.log(usage);
  process.exit(0);
}

const planCommentsPath = path.resolve(planCommentsArgument);
const schemaPath = fileURLToPath(new URL("../plan-comments.schema.json", import.meta.url));
const errors = [];

const PASSES = new Set(["structure", "scaffold", "final"]);
const TARGET_KINDS = new Set(["shot", "slot", "cut"]);
const INDEX_TARGET_KINDS = new Set(["shot", "cut"]);

if (!isRegularFile(planCommentsPath)) {
  fail(`plan-comments.json が見つかりません: ${planCommentsPath}`);
  finish();
}

let schema;
try {
  schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
} catch (error) {
  fail(`plan-comments.schema.json を JSON として読めません: ${messageOf(error)}`);
  finish();
}
if (schema.$id !== "urn:akari-video:schema:plan-comments:v0") {
  fail("plan-comments.schema.json の $id が v0 契約と一致しません");
  finish();
}

let planComments;
try {
  planComments = JSON.parse(fs.readFileSync(planCommentsPath, "utf8"));
} catch (error) {
  fail(`plan-comments.json を JSON として読めません: ${messageOf(error)}`);
  finish();
}

validatePlanComments(planComments);
finish();

function validatePlanComments(value) {
  if (!isPlainObject(value)) {
    fail("plan-comments.json のルートは object である必要があります");
    return;
  }
  if (Number.isInteger(value.version) && value.version > 0) {
    fail(
      `version ${value.version} は新しすぎるため検証できません。このファイルは新しい形式です。スキル / アプリを更新してください`,
    );
    return;
  }
  if (!hasOwn(value, "version")) {
    fail("version は必須です");
  } else if (value.version !== 0) {
    fail("version は 0 である必要があります");
  }
  if (!hasOwn(value, "pass")) {
    fail("pass は必須です");
  } else if (!PASSES.has(value.pass)) {
    fail("pass は structure / scaffold / final のいずれかである必要があります");
  }
  if (!hasOwn(value, "submitted_at")) {
    fail("submitted_at は必須です");
  } else if (typeof value.submitted_at !== "string" || !isIsoDateTime(value.submitted_at)) {
    fail("submitted_at は ISO 8601 日時の文字列である必要があります");
  }
  if (!hasOwn(value, "comments")) {
    fail("comments は必須です");
  } else {
    validateComments(value.comments);
  }
}

function validateComments(value) {
  if (!Array.isArray(value)) {
    fail("comments は配列である必要があります");
    return;
  }
  for (const [index, comment] of value.entries()) {
    const label = `comments[${index}]`;
    if (!isPlainObject(comment)) {
      fail(`${label} は object である必要があります`);
      continue;
    }
    for (const field of ["target_kind", "target_id", "title", "text"]) {
      if (!hasOwn(comment, field)) {
        fail(`${label}.${field} は必須です`);
      }
    }
    if (hasOwn(comment, "target_kind") && !TARGET_KINDS.has(comment.target_kind)) {
      fail(`${label}.target_kind は shot / slot / cut のいずれかである必要があります`);
    }
    if (hasOwn(comment, "target_id")) {
      if (!isNonEmptyString(comment.target_id)) {
        fail(`${label}.target_id は空でない文字列である必要があります`);
      } else if (INDEX_TARGET_KINDS.has(comment.target_kind) && !/^\d+$/.test(comment.target_id)) {
        fail(
          `${label}.target_id は target_kind ${comment.target_kind} では配列インデックスの数字文字列である必要があります: ${comment.target_id}`,
        );
      }
    }
    if (hasOwn(comment, "title") && !isNonEmptyString(comment.title)) {
      fail(`${label}.title は空でない文字列である必要があります`);
    }
    if (hasOwn(comment, "text") && !isNonEmptyString(comment.text)) {
      fail(`${label}.text は空でない文字列である必要があります`);
    }
  }
}

function isIsoDateTime(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && /^\d{4}-\d{2}-\d{2}T/.test(value);
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

function finish() {
  if (errors.length > 0) {
    console.error(`NG: ${planCommentsPath}`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(`OK: ${planCommentsPath}`);
  process.exit(0);
}
