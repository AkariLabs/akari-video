#!/usr/bin/env node

// intake.json v0 の構造を、Node.js 組み込み機能だけで検証する。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const usage = "使い方: node packages/schemas/bin/validate-intake.mjs <intake.json>";
const intakeArgument = process.argv[2];

if (!intakeArgument || process.argv.length !== 3) {
  console.error(usage);
  process.exit(2);
}

if (intakeArgument === "--help" || intakeArgument === "-h") {
  console.log(usage);
  process.exit(0);
}

const TASK_IDS = ["transcribe-captions", "silence-cut", "bgm-sfx", "narration", "3d-inserts"];
const AUTONOMY_VALUES = ["full-auto", "checkpoint", "collaborative"];
const STATUS_VALUES = ["draft", "submitted"];
const ROOT_FIELDS = ["version", "tasks", "target", "autonomy", "status", "submitted_at"];
const TARGET_REQUIRED_FIELDS = ["duration_s", "keep_length"];
const TARGET_FIELDS = ["duration_s", "keep_length", "taste"];

const intakePath = path.resolve(intakeArgument);
const schemaPath = fileURLToPath(new URL("../intake.schema.json", import.meta.url));
const errors = [];

if (!isRegularFile(intakePath)) {
  fail(`intake.json が見つかりません: ${intakePath}`);
  finish();
}

let schema;
try {
  schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
} catch (error) {
  fail(`intake.schema.json を JSON として読めません: ${messageOf(error)}`);
  finish();
}
if (schema.$id !== "urn:akari-video:schema:intake:v0") {
  fail("intake.schema.json の $id が v0 契約と一致しません");
  finish();
}

let intake;
try {
  intake = JSON.parse(fs.readFileSync(intakePath, "utf8"));
} catch (error) {
  fail(`intake.json を JSON として読めません: ${messageOf(error)}`);
  finish();
}

validateIntake(intake);
finish();

function validateIntake(value) {
  if (!isPlainObject(value)) {
    fail("intake.json のルートは object である必要があります");
    return;
  }
  validateFields(value, ROOT_FIELDS, ROOT_FIELDS, "ルート");

  if (value.version !== 1) {
    fail("version は 1 である必要があります");
  }
  validateTasks(value.tasks);
  validateTarget(value.target);
  validateEnum(value.autonomy, AUTONOMY_VALUES, "autonomy");
  validateEnum(value.status, STATUS_VALUES, "status");
  validateSubmittedAt(value.status, value.submitted_at);
}

function validateTasks(value) {
  if (!Array.isArray(value)) {
    fail("tasks は配列である必要があります");
    return;
  }
  const seen = new Set();
  for (const [index, item] of value.entries()) {
    const label = `tasks[${index}]`;
    if (typeof item !== "string" || !TASK_IDS.includes(item)) {
      fail(`${label} は ${TASK_IDS.join(" / ")} のいずれかである必要があります`);
      continue;
    }
    if (seen.has(item)) fail(`tasks に重複があります: ${item}`);
    seen.add(item);
  }
}

function validateTarget(value) {
  if (!isPlainObject(value)) {
    fail("target は object である必要があります");
    return;
  }
  validateFields(value, TARGET_REQUIRED_FIELDS, TARGET_FIELDS, "target");

  const hasDuration = value.duration_s !== null && value.duration_s !== undefined;
  if (hasDuration && !(isFiniteNumber(value.duration_s) && value.duration_s > 0)) {
    fail("target.duration_s は null または正の有限数である必要があります");
  }
  if (hasOwn(value, "keep_length") && typeof value.keep_length !== "boolean") {
    fail("target.keep_length は真偽値である必要があります");
  }
  if (hasDuration && value.keep_length === true) {
    fail("target.duration_s と target.keep_length: true は同時に指定できません（排他）");
  }
  if (hasOwn(value, "taste") && value.taste !== null && typeof value.taste !== "string") {
    fail("target.taste は null または文字列である必要があります");
  }
}

function validateSubmittedAt(status, value) {
  if (status === "submitted") {
    if (typeof value !== "string" || !isIsoDateTime(value)) {
      fail("status が submitted のとき submitted_at は ISO 8601 日時である必要があります");
    }
  } else if (status === "draft") {
    if (value !== null) {
      fail("status が draft のとき submitted_at は null である必要があります");
    }
  }
}

function validateFields(value, required, allowed, label) {
  for (const field of required) {
    if (!hasOwn(value, field)) fail(`${label}.${field} は必須です`);
  }
  for (const field of Object.keys(value)) {
    if (!allowed.includes(field)) fail(`${label}.${field} は未定義のフィールドです`);
  }
}

function validateEnum(value, allowed, label) {
  if (typeof value !== "string" || !allowed.includes(value)) {
    fail(`${label} は ${allowed.join(" / ")} のいずれかである必要があります`);
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

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
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
    console.error(`NG: ${intakePath}`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(`OK: ${intakePath}`);
  process.exit(0);
}
