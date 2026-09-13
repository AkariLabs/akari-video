#!/usr/bin/env node

// gen-models.json の fal 行について、明示実行時だけ OpenAPI スナップショットを更新する。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const usage = "使い方: node packages/schemas/bin/refresh-gen-models-openapi.mjs";
const args = process.argv.slice(2);

if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
  console.log(usage);
  process.exit(0);
}
if (args.length !== 0) {
  console.error(usage);
  process.exit(2);
}

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const catalogPath = path.join(packageRoot, "gen-models.json");
const fixtureRoot = path.join(packageRoot, "fixtures", "gen-models", "openapi");

let catalog;
try {
  catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
} catch (error) {
  console.error(`ERROR: gen-models.json を読めません: ${messageOf(error)}`);
  process.exit(1);
}

const models = catalog.models.filter((model) => model.provider === "fal");
fs.mkdirSync(fixtureRoot, { recursive: true });

try {
  for (const model of models) {
    const response = await fetch(model.source_url, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`${model.id}: HTTP ${response.status} ${response.statusText}`);
    const document = await response.json();
    sanitizeDocument(document);
    const outputPath = path.join(fixtureRoot, `${model.id.replaceAll(":", "_")}.json`);
    const temporaryPath = `${outputPath}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    fs.renameSync(temporaryPath, outputPath);
    console.log(`更新: ${model.id} -> ${outputPath}`);
  }
} catch (error) {
  console.error(`ERROR: OpenAPI の更新に失敗しました: ${messageOf(error)}`);
  process.exit(1);
}

console.log(`OK: fal ${models.length} 行の OpenAPI を更新しました`);

function sanitizeDocument(document) {
  // fal のメタデータに含まれる表示用サムネイルは、スナップショットへ保存しない。
  delete document.info?.["x-fal-metadata"]?.thumbnailUrl;

  // 名前マップ直下では同名の property / schema を保護し、それ以外の例示キーを落とす。
  removeExampleKeys(document, []);

  // 構造上必要な配信先だけを残し、説明文などに埋め込まれた URL も固定値へ置換する。
  replaceUrls(document, []);
}

function removeExampleKeys(value, pathParts) {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      removeExampleKeys(value[index], [...pathParts, index]);
    }
    return;
  }
  if (value === null || typeof value !== "object") return;

  const namedMapKeys = new Set(["properties", "schemas", "$defs", "definitions"]);
  const protectedNameMap = namedMapKeys.has(pathParts.at(-1));
  for (const key of Object.keys(value)) {
    if (!protectedNameMap && ["examples", "example", "externalDocs"].includes(key)) {
      delete value[key];
      continue;
    }
    removeExampleKeys(value[key], [...pathParts, key]);
  }
}

function replaceUrls(value, pathParts) {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (typeof value[index] === "string" && !isServerUrl([...pathParts, index])) {
        value[index] = value[index].replace(/https?:\/\/[^\s<>"'`)\]}]+/g, "<url-removed>");
      } else {
        replaceUrls(value[index], [...pathParts, index]);
      }
    }
    return;
  }
  if (value === null || typeof value !== "object") return;

  for (const key of Object.keys(value)) {
    const childPath = [...pathParts, key];
    if (typeof value[key] === "string" && !isServerUrl(childPath)) {
      value[key] = value[key].replace(/https?:\/\/[^\s<>"'`)\]}]+/g, "<url-removed>");
    } else {
      replaceUrls(value[key], childPath);
    }
  }
}

function isServerUrl(pathParts) {
  return pathParts.length === 3
    && pathParts[0] === "servers"
    && Number.isInteger(pathParts[1])
    && pathParts[2] === "url";
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
