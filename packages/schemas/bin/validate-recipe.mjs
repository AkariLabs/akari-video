#!/usr/bin/env node

// recipe.json v0（レシピ凍結と好みの記憶）の構造を検証する。
// docs/contract-2026-07-25-recipe-v0.md 参照。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const usage = "使い方: node packages/schemas/bin/validate-recipe.mjs <recipe.json>";
const recipeArgument = process.argv[2];

if (!recipeArgument || process.argv.length !== 3) {
  console.error(usage);
  process.exit(2);
}

if (recipeArgument === "--help" || recipeArgument === "-h") {
  console.log(usage);
  process.exit(0);
}

const recipePath = path.resolve(recipeArgument);
const schemaPath = fileURLToPath(new URL("../recipe.schema.json", import.meta.url));
const errors = [];

const WORKFLOWS = new Set(["edit", "research"]);
const ASPECTS = new Set(["16:9", "9:16", "1:1"]);
const CONFIRMED_BY = new Set(["intake", "structure-confirm", "edit-approval", "render-approval"]);
const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

if (!isRegularFile(recipePath)) {
  fail(`recipe.json が見つかりません: ${recipePath}`);
  finish();
}

let schema;
try {
  schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
} catch (error) {
  fail(`recipe.schema.json を JSON として読めません: ${messageOf(error)}`);
  finish();
}
if (schema.$id !== "urn:akari-video:schema:recipe:v0") {
  fail("recipe.schema.json の $id が v0 契約と一致しません");
  finish();
}

let recipe;
try {
  recipe = JSON.parse(fs.readFileSync(recipePath, "utf8"));
} catch (error) {
  fail(`recipe.json を JSON として読めません: ${messageOf(error)}`);
  finish();
}

validateRecipe(recipe);
finish();

function validateRecipe(value) {
  if (!isPlainObject(value)) {
    fail("recipe.json のルートは object である必要があります");
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
  if (!hasOwn(value, "name")) {
    fail("name は必須です");
  } else if (!isNonEmptyString(value.name) || !NAME_PATTERN.test(value.name)) {
    fail(`name は kebab-case（小文字英数字とハイフンのみ）の空でない文字列である必要があります: ${JSON.stringify(value.name)}`);
  }
  if (!hasOwn(value, "frozen_at")) {
    fail("frozen_at は必須です");
  } else if (typeof value.frozen_at !== "string" || !isIsoDateTime(value.frozen_at)) {
    fail("frozen_at は ISO 8601 日時の文字列である必要があります");
  }
  if (!hasOwn(value, "source_project")) {
    fail("source_project は必須です");
  } else if (!isNonEmptyString(value.source_project)) {
    fail("source_project は空でない文字列である必要があります");
  } else if (value.source_project.includes("/") || value.source_project.includes("\\")) {
    fail(
      `source_project はパスではなく「プロジェクト名 + 日付」の名前を書く必要があります（プロジェクト移動で壊れる参照を持たない契約。§6）: ${value.source_project}`,
    );
  }
  if (!hasOwn(value, "workflow")) {
    fail("workflow は必須です");
  } else if (!WORKFLOWS.has(value.workflow)) {
    fail("workflow は edit / research のいずれかである必要があります");
  }
  let confirmedKeys = null;
  if (!hasOwn(value, "confirmed")) {
    fail("confirmed は必須です");
  } else {
    confirmedKeys = validateConfirmed(value.confirmed);
  }
  if (!hasOwn(value, "provenance")) {
    fail("provenance は必須です");
  } else {
    validateProvenance(value.provenance, confirmedKeys);
  }
}

function validateConfirmed(value) {
  if (!isPlainObject(value)) {
    fail("confirmed は object である必要があります");
    return null;
  }
  const keys = Object.keys(value);
  if (keys.length === 0) {
    fail(
      "confirmed は少なくとも 1 件の確認済みフィールドを持つ必要があります（確認済みのみ記録する契約のため、空なら freeze しない）",
    );
  }
  if (hasOwn(value, "aspect") && !ASPECTS.has(value.aspect)) {
    fail("confirmed.aspect は 16:9 / 9:16 / 1:1 のいずれかである必要があります");
  }
  if (hasOwn(value, "target_duration_band") && !isNonEmptyString(value.target_duration_band)) {
    fail("confirmed.target_duration_band は空でない文字列である必要があります");
  }
  if (hasOwn(value, "caption_style_ref") && !isNonEmptyString(value.caption_style_ref)) {
    fail("confirmed.caption_style_ref は空でない文字列である必要があります");
  }
  if (hasOwn(value, "bgm_profile") && !isNonEmptyString(value.bgm_profile)) {
    fail("confirmed.bgm_profile は空でない文字列である必要があります");
  }
  if (hasOwn(value, "overlay_kinds")) {
    validateOverlayKinds(value.overlay_kinds);
  }
  if (hasOwn(value, "narration")) {
    validateNarration(value.narration);
  }
  return new Set(keys);
}

function validateOverlayKinds(value) {
  if (!Array.isArray(value)) {
    fail("confirmed.overlay_kinds は配列である必要があります");
    return;
  }
  if (value.length === 0) {
    fail("confirmed.overlay_kinds は最低 1 件の要素が必要です");
    return;
  }
  const seen = new Set();
  for (const [index, kind] of value.entries()) {
    const label = `confirmed.overlay_kinds[${index}]`;
    if (!isNonEmptyString(kind)) {
      fail(`${label} は空でない文字列である必要があります`);
      continue;
    }
    if (seen.has(kind)) {
      fail(`confirmed.overlay_kinds に重複した値があります: ${kind}`);
    } else {
      seen.add(kind);
    }
  }
}

function validateNarration(value) {
  if (!isPlainObject(value)) {
    fail("confirmed.narration は object である必要があります");
    return;
  }
  const keys = Object.keys(value);
  if (keys.length === 0) {
    fail("confirmed.narration は engine または voice のうち少なくとも 1 件を持つ必要があります");
  }
  if (hasOwn(value, "engine") && !isNonEmptyString(value.engine)) {
    fail("confirmed.narration.engine は空でない文字列である必要があります");
  }
  if (hasOwn(value, "voice") && !isNonEmptyString(value.voice)) {
    fail("confirmed.narration.voice は空でない文字列である必要があります");
  }
}

function validateProvenance(value, confirmedKeys) {
  if (!isPlainObject(value)) {
    fail("provenance は object である必要があります");
    return;
  }
  const provenanceKeys = new Set(Object.keys(value));
  if (provenanceKeys.size === 0) {
    fail("provenance は少なくとも 1 件のエントリを持つ必要があります");
  }
  if (confirmedKeys) {
    for (const key of confirmedKeys) {
      if (!provenanceKeys.has(key)) {
        fail(`provenance.${key} が欠けています（confirmed.${key} には出所（confirmed_by, at）の対応エントリが必要です）`);
      }
    }
    for (const key of provenanceKeys) {
      if (!confirmedKeys.has(key)) {
        fail(`provenance.${key} に対応する confirmed.${key} がありません（存在しない確認値の出所は記録できません）`);
      }
    }
  }
  for (const [key, entry] of Object.entries(value)) {
    const label = `provenance.${key}`;
    if (!isPlainObject(entry)) {
      fail(`${label} は object である必要があります`);
      continue;
    }
    if (!hasOwn(entry, "confirmed_by")) {
      fail(`${label}.confirmed_by は必須です`);
    } else if (!CONFIRMED_BY.has(entry.confirmed_by)) {
      fail(`${label}.confirmed_by は intake / structure-confirm / edit-approval / render-approval のいずれかである必要があります`);
    }
    if (!hasOwn(entry, "at")) {
      fail(`${label}.at は必須です`);
    } else if (typeof entry.at !== "string" || !isIsoDateTime(entry.at)) {
      fail(`${label}.at は ISO 8601 日時の文字列である必要があります`);
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
    console.error(`NG: ${recipePath}`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(`OK: ${recipePath}`);
  process.exit(0);
}
