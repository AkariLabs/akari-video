#!/usr/bin/env node

// <元ファイル名>.meta.json の生成サイドカー v1 を検証する。
// 素材工房の asset-meta.schema.json とは別契約。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const usage = "使い方: node packages/schemas/bin/validate-generation-meta.mjs <元ファイル名.meta.json>";
const argument = process.argv[2];

if (!argument || process.argv.length !== 3) {
  console.error(usage);
  process.exit(2);
}
if (argument === "--help" || argument === "-h") {
  console.log(usage);
  process.exit(0);
}

const metaPath = path.resolve(argument);
const schemaPath = fileURLToPath(new URL("../generation-meta.schema.json", import.meta.url));
let schema;
let meta;

try {
  schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
} catch (error) {
  console.error(`NG: ${metaPath}`);
  console.error(`- generation-meta.schema.json を JSON として読めません: ${messageOf(error)}`);
  process.exit(2);
}
if (schema.$id !== "urn:akari-video:schema:generation-meta:v1") {
  console.error(`NG: ${metaPath}`);
  console.error("- generation-meta.schema.json の $id が v1 契約と一致しません");
  process.exit(2);
}
try {
  meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
} catch (error) {
  console.error(`NG: ${metaPath}`);
  console.error(`- 生成サイドカーを JSON として読めません: ${messageOf(error)}`);
  process.exit(1);
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
ajv.addFormat("date-time", value => typeof value === "string" && Number.isFinite(Date.parse(value)) && /^\d{4}-\d{2}-\d{2}T/.test(value));
const validate = ajv.compile(schema);
if (!validate(meta)) {
  console.error(`NG: ${metaPath}`);
  for (const error of validate.errors ?? []) console.error(`- ${japaneseError(error)}`);
  process.exit(1);
}

console.log(`OK: ${metaPath}`);

function japaneseError(error) {
  const location = error.instancePath || "/";
  switch (error.keyword) {
    case "required": return `${location} に必須キー ${error.params.missingProperty} がありません`;
    case "additionalProperties": return `${location} に未定義キー ${error.params.additionalProperty} があります`;
    case "enum": return `${location} の値が許可された候補と一致しません`;
    case "const": return `${location} は ${JSON.stringify(error.params.allowedValue)} である必要があります`;
    case "type": return `${location} は ${error.params.type} である必要があります`;
    case "format": return `${location} は ${error.params.format} 形式である必要があります`;
    case "pattern": return `${location} の文字列形式が契約と一致しません`;
    default: return `${location} が契約を満たしません（${error.keyword}）`;
  }
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
