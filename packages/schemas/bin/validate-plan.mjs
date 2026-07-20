#!/usr/bin/env node

// plan.json v0（仮枠タイムライン）の構造と、JSON Schema 単体では表せない
// 参照・範囲・整合制約を検証する。confidence の整合（filled なのに media 全 null 等）は
// 助言レベルのため warning（stderr）に出し、exit code は errors のみで決定する。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const usage = "使い方: node packages/schemas/bin/validate-plan.mjs <plan.json>";
const planArgument = process.argv[2];

if (!planArgument || process.argv.length !== 3) {
  console.error(usage);
  process.exit(2);
}

if (planArgument === "--help" || planArgument === "-h") {
  console.log(usage);
  process.exit(0);
}

const EPSILON = 1e-6;
const planPath = path.resolve(planArgument);
const planDirectory = path.dirname(planPath);
const schemaPath = fileURLToPath(new URL("../plan.schema.json", import.meta.url));
const errors = [];
const warnings = [];

const CONFIDENCES = new Set(["proposed", "locked", "filled"]);
const FILL_METHODS = new Set(["generate", "record", "import"]);
const CONSTRAINT_KINDS = new Set(["duration_max", "duration_exact", "note"]);

if (!isRegularFile(planPath)) {
  fail(`plan.json が見つかりません: ${planPath}`);
  finish();
}

let schema;
try {
  schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
} catch (error) {
  fail(`plan.schema.json を JSON として読めません: ${messageOf(error)}`);
  finish();
}
if (schema.$id !== "urn:akari-video:schema:plan:v0") {
  fail("plan.schema.json の $id が v0 契約と一致しません");
  finish();
}

let plan;
try {
  plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
} catch (error) {
  fail(`plan.json を JSON として読めません: ${messageOf(error)}`);
  finish();
}

validatePlan(plan);
finish();

function validatePlan(value) {
  if (!isPlainObject(value)) {
    fail("plan.json のルートは object である必要があります");
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
  const slots = validateSlots(value.slots);
  validateConstraints(value.constraints, slots);
}

function validateSlots(value) {
  const slots = new Map();
  if (value === undefined) return slots;
  if (!Array.isArray(value)) {
    fail("slots は配列である必要があります");
    return slots;
  }
  for (const [index, slot] of value.entries()) {
    const label = `slots[${index}]`;
    if (!isPlainObject(slot)) {
      fail(`${label} は object である必要があります`);
      continue;
    }
    for (const field of [
      "id",
      "label",
      "script",
      "target_duration_seconds",
      "confidence",
      "fill",
      "media",
      "provenance",
    ]) {
      if (!hasOwn(slot, field)) {
        fail(`${label}.${field} は必須です（値は null 許容でもキーは省略しない）`);
      }
    }
    if (!isNonEmptyString(slot.id)) {
      fail(`${label}.id は空でない文字列である必要があります`);
    } else if (slots.has(slot.id)) {
      fail(`slots[].id が重複しています: ${slot.id}`);
    } else {
      slots.set(slot.id, slot);
    }
    if (hasOwn(slot, "label") && !isNonEmptyString(slot.label)) {
      fail(`${label}.label は空でない文字列である必要があります`);
    }
    validateNullableNonEmptyString(slot.script, `${label}.script`);
    if (
      hasOwn(slot, "target_duration_seconds") &&
      (!isFiniteNumber(slot.target_duration_seconds) || slot.target_duration_seconds <= 0)
    ) {
      fail(`${label}.target_duration_seconds は 0 より大きい有限数（秒）である必要があります`);
    }
    if (hasOwn(slot, "confidence") && !CONFIDENCES.has(slot.confidence)) {
      fail(`${label}.confidence は proposed / locked / filled のいずれかである必要があります`);
    }
    validateFill(slot.fill, label);
    const media = validateMedia(slot.media, label);
    validateProvenance(slot.provenance, label);

    if (slot.confidence === "filled" && media !== null && mediaAllNull(media) ) {
      warn(`${label} は confidence filled ですが media がすべて null です`);
    }
    if (
      CONFIDENCES.has(slot.confidence) &&
      slot.confidence !== "proposed" &&
      isPlainObject(slot.fill) &&
      slot.fill.method === null
    ) {
      warn(`${label} は confidence ${slot.confidence} ですが fill.method が未決（null）です`);
    }
  }
  return slots;
}

function validateFill(value, label) {
  if (!hasOwn({ fill: value }, "fill") || value === undefined) return;
  if (!isPlainObject(value) || !hasOwn(value, "method")) {
    fail(`${label}.fill は { method } を持つ object である必要があります`);
    return;
  }
  if (value.method !== null && !FILL_METHODS.has(value.method)) {
    fail(`${label}.fill.method は generate / record / import または null である必要があります`);
    return;
  }
  validateNullableNonEmptyString(value.prompt, `${label}.fill.prompt`);
  validateNullableNonEmptyString(value.asset_path, `${label}.fill.asset_path`);
  if (isNonEmptyString(value.asset_path)) {
    requireRegularFile(value.asset_path, `${label}.fill.asset_path`);
  }
  if (value.method === "import" && !isNonEmptyString(value.asset_path)) {
    warn(`${label}.fill は method import ですが asset_path がありません`);
  }
}

function validateMedia(value, label) {
  if (value === undefined) return null;
  if (!isPlainObject(value)) {
    fail(`${label}.media は object である必要があります`);
    return null;
  }
  for (const field of ["image_path", "audio_path", "text_card"]) {
    if (!hasOwn(value, field)) {
      fail(`${label}.media.${field} は必須です（値は null 許容でもキーは省略しない）`);
    }
  }
  validateNullableNonEmptyString(value.image_path, `${label}.media.image_path`);
  validateNullableNonEmptyString(value.audio_path, `${label}.media.audio_path`);
  if (value.text_card !== undefined && value.text_card !== null && typeof value.text_card !== "string") {
    fail(`${label}.media.text_card は null または文字列である必要があります`);
  }
  for (const field of ["image_path", "audio_path"]) {
    if (isNonEmptyString(value[field])) {
      requireRegularFile(value[field], `${label}.media.${field}`);
    }
  }
  return value;
}

function validateProvenance(value, label) {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    fail(`${label}.provenance は object である必要があります`);
    return;
  }
  for (const field of ["tool", "created_at", "note"]) {
    if (!hasOwn(value, field)) {
      fail(`${label}.provenance.${field} は必須です（値は null 許容でもキーは省略しない）`);
    }
  }
  validateNullableNonEmptyString(value.tool, `${label}.provenance.tool`);
  if (value.created_at !== undefined && value.created_at !== null && typeof value.created_at !== "string") {
    fail(`${label}.provenance.created_at は null または ISO-8601 文字列である必要があります`);
  }
  if (value.note !== undefined && value.note !== null && typeof value.note !== "string") {
    fail(`${label}.provenance.note は null または文字列である必要があります`);
  }
}

function validateConstraints(value, slots) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    fail("constraints は配列である必要があります");
    return;
  }
  const ids = new Set();
  const slotDurationSum = [...slots.values()].reduce(
    (sum, slot) =>
      isFiniteNumber(slot.target_duration_seconds) && slot.target_duration_seconds > 0
        ? sum + slot.target_duration_seconds
        : sum,
    0,
  );
  for (const [index, constraint] of value.entries()) {
    const label = `constraints[${index}]`;
    if (!isPlainObject(constraint)) {
      fail(`${label} は object である必要があります`);
      continue;
    }
    for (const field of ["id", "kind", "applies_to", "value", "note"]) {
      if (!hasOwn(constraint, field)) {
        fail(`${label}.${field} は必須です（値は null 許容でもキーは省略しない）`);
      }
    }
    if (!isNonEmptyString(constraint.id)) {
      fail(`${label}.id は空でない文字列である必要があります`);
    } else if (ids.has(constraint.id)) {
      fail(`constraints[].id が重複しています: ${constraint.id}`);
    } else {
      ids.add(constraint.id);
    }
    if (!CONSTRAINT_KINDS.has(constraint.kind)) {
      fail(`${label}.kind は duration_max / duration_exact / note のいずれかである必要があります`);
      continue;
    }
    if (constraint.applies_to !== null && constraint.applies_to !== undefined) {
      if (!isNonEmptyString(constraint.applies_to)) {
        fail(`${label}.applies_to は null または slot id である必要があります`);
      } else if (!slots.has(constraint.applies_to)) {
        fail(`${label}.applies_to が slots[].id を参照していません: ${constraint.applies_to}`);
        continue;
      }
    }
    if (constraint.kind === "note") {
      if (constraint.value !== null && constraint.value !== undefined) {
        fail(`${label} は kind note のため value は null である必要があります`);
      }
      if (!isNonEmptyString(constraint.note)) {
        fail(`${label} は kind note のため note に空でない文字列が必要です`);
      }
      continue;
    }
    if (!isFiniteNumber(constraint.value) || constraint.value <= 0) {
      fail(`${label}.value は 0 より大きい有限数（秒）である必要があります`);
      continue;
    }
    const scopedDuration = isNonEmptyString(constraint.applies_to)
      ? slots.get(constraint.applies_to)?.target_duration_seconds
      : slotDurationSum;
    if (!isFiniteNumber(scopedDuration)) continue;
    const scopeLabel = isNonEmptyString(constraint.applies_to)
      ? `slot ${constraint.applies_to}`
      : "slots 合計";
    if (constraint.kind === "duration_max" && scopedDuration > constraint.value + EPSILON) {
      fail(
        `${label}: ${scopeLabel}の尺 ${formatNumber(scopedDuration)}s が duration_max ${formatNumber(constraint.value)}s を超えています`,
      );
    }
    if (
      constraint.kind === "duration_exact" &&
      Math.abs(scopedDuration - constraint.value) > EPSILON
    ) {
      warn(
        `${label}: ${scopeLabel}の尺 ${formatNumber(scopedDuration)}s が duration_exact ${formatNumber(constraint.value)}s と一致していません（目標尺への収束は仮枠 QA の対象）`,
      );
    }
  }
}

function requireRegularFile(reference, label) {
  const filePath = path.isAbsolute(reference)
    ? reference
    : path.resolve(planDirectory, reference);
  if (!isRegularFile(filePath)) {
    fail(`${label} が実ファイルに解決できません: ${reference}`);
  }
}

function validateNullableNonEmptyString(value, label) {
  if (value === undefined || value === null) return;
  if (!isNonEmptyString(value)) {
    fail(`${label} は null または空でない文字列である必要があります`);
  }
}

function mediaAllNull(media) {
  return (
    (media.image_path === null || media.image_path === undefined) &&
    (media.audio_path === null || media.audio_path === undefined) &&
    (media.text_card === null || media.text_card === undefined)
  );
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

function formatNumber(value) {
  return Number.isFinite(value) ? String(Number(value.toFixed(6))) : String(value);
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
    console.error(`NG: ${planPath}`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(`OK: ${planPath}${warnings.length > 0 ? ` (${warnings.length} warnings)` : ""}`);
  process.exit(0);
}
