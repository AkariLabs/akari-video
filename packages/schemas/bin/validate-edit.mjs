#!/usr/bin/env node

// edit.json v0/v1 の構造と、JSON Schema 単体では表せない参照・範囲制約を検証する。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const usage = "使い方: node packages/schemas/bin/validate-edit.mjs <edit.json>";
const editArgument = process.argv[2];

if (!editArgument || process.argv.length !== 3) {
  console.error(usage);
  process.exit(2);
}

if (editArgument === "--help" || editArgument === "-h") {
  console.log(usage);
  process.exit(0);
}

const editPath = path.resolve(editArgument);
const schemaPath = fileURLToPath(new URL("../edit.schema.json", import.meta.url));
const errors = [];

if (!isRegularFile(editPath)) {
  fail(`edit.json が見つかりません: ${editPath}`);
  finish();
}

let schema;
try {
  schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
} catch (error) {
  fail(`edit.schema.json を JSON として読めません: ${messageOf(error)}`);
  finish();
}
if (schema.$id !== "urn:akari-video:schema:edit:v1") {
  fail("edit.schema.json の $id が v1 契約と一致しません");
  finish();
}

let edit;
try {
  edit = JSON.parse(fs.readFileSync(editPath, "utf8"));
} catch (error) {
  fail(`edit.json を JSON として読めません: ${messageOf(error)}`);
  finish();
}

validateEdit(edit);
finish();

function validateEdit(value) {
  if (!isPlainObject(value)) {
    fail("edit.json のルートは object である必要があります");
    return;
  }
  if (value.version !== 0 && value.version !== 1) {
    fail("version は 0 または 1 である必要があります");
    return;
  }
  validateOutput(value.output);

  const hasSource = hasOwn(value, "source");
  const hasSources = hasOwn(value, "sources");
  if (hasSource && hasSources) fail("source と sources は排他です");

  if (value.version === 0) {
    if (!hasSource) fail("version 0 では source が必須です");
    if (hasSources) fail("version 0 では sources を使用できません");
    validateSourceV0(value.source);
  } else {
    if (!hasSources) fail("version 1 では sources が必須です");
    if (hasSource) fail("version 1 では source を使用できません");
    validateSourcesV1(value.sources);
  }
  validateCuts(value.cuts, value.version, value.sources);
  validateAudio(value.audio);
}

function validateAudio(value) {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    fail("audio は object である必要があります");
    return;
  }
  validateNarration(value.narration);
  validateBgm(value.bgm);
  validateSfx(value.sfx);
}

function validateBgm(value) {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    fail("audio.bgm は object である必要があります");
    return;
  }
  validateNonEmptyString(value.path, "audio.bgm.path");
  if (hasOwn(value, "gain_db")) {
    if (!isFiniteNumber(value.gain_db) || value.gain_db < -60 || value.gain_db > 12) {
      fail("audio.bgm.gain_db は -60 から 12 の範囲の有限数である必要があります");
    }
  }
  if (hasOwn(value, "ducking") && typeof value.ducking !== "boolean") {
    fail("audio.bgm.ducking は boolean である必要があります");
  }
}

function validateSfx(value) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    fail("audio.sfx は配列である必要があります");
    return;
  }
  for (const [index, item] of value.entries()) {
    const label = `audio.sfx[${index}]`;
    if (!isPlainObject(item)) {
      fail(`${label} は object である必要があります`);
      continue;
    }
    validateNonEmptyString(item.path, `${label}.path`);
    if (!isFiniteNumber(item.t) || item.t < 0) {
      fail(`${label}.t は 0 以上の有限数である必要があります`);
    }
    if (hasOwn(item, "gain_db")) {
      if (!isFiniteNumber(item.gain_db) || item.gain_db < -60 || item.gain_db > 12) {
        fail(`${label}.gain_db は -60 から 12 の範囲の有限数である必要があります`);
      }
    }
  }
}

function validateNarration(value) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    fail("audio.narration は配列である必要があります");
    return;
  }
  const ids = new Set();
  for (const [index, item] of value.entries()) {
    const label = `audio.narration[${index}]`;
    if (!isPlainObject(item)) {
      fail(`${label} は object である必要があります`);
      continue;
    }
    if (typeof item.id !== "string" || !/^n-\d{4}$/.test(item.id)) {
      fail(`${label}.id は n- に続く 4 桁の数字である必要があります`);
    } else if (ids.has(item.id)) {
      fail(`audio.narration[].id が重複しています: ${item.id}`);
    } else {
      ids.add(item.id);
    }
    validateNonEmptyString(item.path, `${label}.path`);
    if (!isFiniteNumber(item.t) || item.t < 0) {
      fail(`${label}.t は 0 以上の有限数である必要があります`);
    }
    if (hasOwn(item, "gain_db")) {
      if (!isFiniteNumber(item.gain_db) || item.gain_db < -60 || item.gain_db > 12) {
        fail(`${label}.gain_db は -60 から 12 の範囲の有限数である必要があります`);
      }
    }
    validateNarrationProvenance(item.provenance, `${label}.provenance`);
  }
}

function validateNarrationProvenance(value, label) {
  if (!isPlainObject(value)) {
    fail(`${label} は object である必要があります`);
    return;
  }
  if (!isNonEmptyString(value.provider)) {
    fail(`${label}.provider は空でない文字列である必要があります`);
    return;
  }
  if (value.provider === "voicevox" && !isNonEmptyString(value.credit)) {
    fail(`${label}.credit は provider が voicevox のとき必須です`);
  }
}

function validateOutput(value) {
  if (!isPlainObject(value)) {
    fail("output は object である必要があります");
    return;
  }
  for (const field of ["width", "height", "fps"]) {
    if (!isFiniteNumber(value[field]) || value[field] <= 0) {
      fail(`output.${field} は 0 より大きい有限数である必要があります`);
    }
  }
}

function validateSourceV0(value) {
  if (!isPlainObject(value)) {
    fail("source は object である必要があります");
    return;
  }
  validateNonEmptyString(value.path, "source.path");
  validateProxy(value.proxy, "source.proxy", false);
}

function validateSourcesV1(value) {
  if (!Array.isArray(value) || value.length === 0) {
    fail("sources は 1 件以上の配列である必要があります");
    return;
  }
  const ids = new Set();
  for (const [index, source] of value.entries()) {
    const label = `sources[${index}]`;
    if (!isPlainObject(source)) {
      fail(`${label} は object である必要があります`);
      continue;
    }
    validateNonEmptyString(source.id, `${label}.id`);
    if (typeof source.id === "string") {
      if (ids.has(source.id)) fail(`sources[].id が重複しています: ${source.id}`);
      ids.add(source.id);
    }
    validateNonEmptyString(source.path, `${label}.path`);
    validateProxy(source.proxy, `${label}.proxy`, true);
  }
}

function validateCuts(value, version, sources) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    fail("cuts は配列である必要があります");
    return;
  }
  const sourceIds = new Set(
    Array.isArray(sources)
      ? sources.filter(isPlainObject).map((source) => source.id).filter(isNonEmptyString)
      : [],
  );
  for (const [index, cut] of value.entries()) {
    const label = `cuts[${index}]`;
    if (!isPlainObject(cut)) {
      fail(`${label} は object である必要があります`);
      continue;
    }
    if (!isFiniteNumber(cut.in) || !isFiniteNumber(cut.out)) {
      fail(`${label}.in/out は有限数である必要があります`);
    } else if (cut.in < 0 || cut.out <= cut.in) {
      fail(`${label} は 0 <= in < out を満たす必要があります`);
    }
    if (version === 0 && hasOwn(cut, "src")) {
      fail(`${label}.src は version 0 では使用できません`);
    }
    if (version === 1) {
      validateNonEmptyString(cut.src, `${label}.src`);
      if (isNonEmptyString(cut.src) && !sourceIds.has(cut.src)) {
        fail(`${label}.src が sources[].id を参照していません: ${cut.src}`);
      }
    }
  }
}

function validateProxy(value, label, required) {
  if (value === undefined && !required) return;
  if (value !== null && !isNonEmptyString(value)) {
    fail(`${label} は null または空でない文字列である必要があります`);
  }
}

function validateNonEmptyString(value, label) {
  if (!isNonEmptyString(value)) fail(`${label} は空でない文字列である必要があります`);
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

function finish() {
  if (errors.length > 0) {
    console.error(`NG: ${editPath}`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(`OK: ${editPath}`);
  process.exit(0);
}
