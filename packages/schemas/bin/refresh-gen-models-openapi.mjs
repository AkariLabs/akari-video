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

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
