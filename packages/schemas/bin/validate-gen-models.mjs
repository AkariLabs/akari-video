#!/usr/bin/env node

// gen-models.json v1 のスキーマと、行をまたぐ意味制約を検証する。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const usage = "使い方: node packages/schemas/bin/validate-gen-models.mjs <gen-models.json>";
const catalogArgument = process.argv[2];

if (!catalogArgument || process.argv.length !== 3) {
  console.error(usage);
  process.exit(2);
}

if (catalogArgument === "--help" || catalogArgument === "-h") {
  console.log(usage);
  process.exit(0);
}

const catalogPath = path.resolve(catalogArgument);
const schemaPath = fileURLToPath(new URL("../gen-models.schema.json", import.meta.url));
const errors = [];

if (!isRegularFile(catalogPath)) {
  fail(`gen-models.json が見つかりません: ${catalogPath}`);
  finish();
}

let schema;
try {
  schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
} catch (error) {
  fail(`gen-models.schema.json を JSON として読めません: ${messageOf(error)}`);
  finish();
}
if (schema.$id !== "urn:akari-video:schema:gen-models:v1") {
  fail("gen-models.schema.json の $id が v1 契約と一致しません");
  finish();
}

let catalog;
try {
  catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
} catch (error) {
  fail(`gen-models.json を JSON として読めません: ${messageOf(error)}`);
  finish();
}

try {
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  if (!validate(catalog)) {
    for (const error of validate.errors ?? []) {
      fail(`スキーマ違反 ${error.instancePath || "/"}: ${error.message}`);
    }
  }
} catch (error) {
  fail(`gen-models.schema.json をコンパイルできません: ${messageOf(error)}`);
  finish();
}

validateCatalog(catalog);
finish();

function validateCatalog(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.models)) return;
  if (value.models.length !== 14) fail(`models は 14 行である必要があります: ${value.models.length}`);

  const ids = new Set();
  for (const [index, model] of value.models.entries()) {
    if (!model || typeof model !== "object" || Array.isArray(model)) continue;
    const label = typeof model.id === "string" ? model.id : `models[${index}]`;
    if (typeof model.id === "string") {
      if (ids.has(model.id)) fail(`id が重複しています: ${model.id}`);
      ids.add(model.id);
    }
    if (model.verified !== "documented") {
      fail(`${label} の verified は documented である必要があります`);
    }
    if (model.price && typeof model.price === "object" && model.price.by_resolution) {
      const resolutions = new Set(Array.isArray(model.resolutions) ? model.resolutions : []);
      for (const resolution of Object.keys(model.price.by_resolution)) {
        if (resolution !== "" && !resolutions.has(resolution)) {
          fail(`${label} の price.by_resolution.${resolution} は resolutions に含まれていません`);
        }
      }
    }
    validateDuration(model.duration, label);
  }
  findForbiddenWord(value);
}

function validateDuration(duration, label) {
  if (!duration || typeof duration !== "object") return;
  if (duration.kind === "range") {
    if (duration.min > duration.max) fail(`${label} の duration.min は max 以下である必要があります`);
    if (duration.default !== null
        && (duration.default < duration.min || duration.default > duration.max
          || (duration.default - duration.min) % duration.step !== 0)) {
      fail(`${label} の duration.default は range 内の step に一致する必要があります`);
    }
  }
  if (duration.kind === "enum" && duration.default !== null && !duration.values.includes(duration.default)) {
    fail(`${label} の duration.default は values に含まれている必要があります`);
  }
}

function findForbiddenWord(value, location = "ルート") {
  if (typeof value === "string") {
    if (value === "cap" + "ability") fail(`${location} に禁止語が値として使われています`);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (key === "cap" + "ability") fail(`${location} に禁止語のキーがあります`);
    findForbiddenWord(child, `${location}.${key}`);
  }
}

function isRegularFile(targetPath) {
  try {
    return fs.statSync(targetPath).isFile();
  } catch {
    return false;
  }
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function fail(message) {
  errors.push(message);
}

function finish() {
  if (errors.length > 0) {
    for (const error of errors) console.error(`ERROR: ${error}`);
    process.exit(1);
  }
  console.log(`OK: ${catalogPath}`);
  process.exit(0);
}
