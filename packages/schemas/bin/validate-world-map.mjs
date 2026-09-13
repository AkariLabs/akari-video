#!/usr/bin/env node

// ワールドマップ v3 の構造と不変条件を、Node.js 組み込み機能だけで検証する。

import fs from "node:fs";
import path from "node:path";
import { normalizeWorldMap } from "../../akari-tools/src/world/normalize.mjs";
import { checkWorldMap } from "../../akari-tools/src/world/invariants.mjs";

const usage = "使い方: node packages/schemas/bin/validate-world-map.mjs <project-root or world-map.json> [--strict] [--migrate] [--json]";
const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(usage);
  process.exit(0);
}
const flags = new Set(args.filter((arg) => arg.startsWith("-")));
const positions = args.filter((arg) => !arg.startsWith("-"));
if (positions.length !== 1 || [...flags].some((flag) => !["--strict", "--migrate", "--json"].includes(flag))) {
  console.error(usage);
  process.exit(2);
}

const strict = flags.has("--strict");
const migrate = flags.has("--migrate");
const jsonOutput = flags.has("--json");
let file = path.resolve(positions[0]);
if (directory(file)) {
  const planned = path.join(file, "planning", "world-map.json");
  const direct = path.join(file, "world-map.json");
  file = regular(planned) ? planned : direct;
}

if (!regular(file)) finishFailure(`world-map.json が見つかりません: ${file}`);

let input;
try {
  input = JSON.parse(fs.readFileSync(file, "utf8"));
} catch (cause) {
  finishFailure(`world-map.json を JSON として読めません: ${cause instanceof Error ? cause.message : String(cause)}`);
}

if (!object(input)) finishFailure("ルートは object である必要があります");
if (typeof input.schemaVersion === "number" && input.schemaVersion > 3) {
  finishFailure(`schemaVersion ${input.schemaVersion} は新しすぎるため検証できません。このファイルは新しい形式です。スキル / アプリを更新してください`);
}

const schemaVersionIn = input.schemaVersion ?? null;
const normalized = input.schemaVersion === 3 ? { map: input, notes: [] } : normalizeWorldMap(input);
const map = normalized.map;
const schemaErrors = validateSchema(map);
const checked = checkWorldMap(map, { strict });
const errors = [...schemaErrors, ...checked.errors];
const warnings = checked.warnings;
const result = { ok: errors.length === 0, file, schemaVersionIn, notes: normalized.notes, errors, warnings };
if (migrate && jsonOutput) result.map = map;

if (jsonOutput) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else if (migrate) {
  process.stdout.write(`${JSON.stringify(map, null, 2)}\n`);
  reportHuman(process.stderr);
} else {
  reportHuman(process.stdout);
  if (!result.ok) for (const finding of errors) process.stderr.write(`[${finding.code}] ${finding.message}\n`);
}
process.exit(result.ok ? 0 : 1);

function reportHuman(output) {
  if (result.ok) output.write(`OK: ${file}（world ${map.worlds?.length ?? 0} / stop ${map.cameraStops?.length ?? 0} / edge ${map.edges?.length ?? 0}・warning ${warnings.length} 件）\n`);
  else output.write(`NG: ${file}\n`);
  for (const finding of errors) output.write(`[${finding.code}] ${finding.message}\n`);
  for (const finding of warnings) output.write(`[${finding.code}] ${finding.message}\n`);
}

function validateSchema(value) {
  const findings = [];
  const fail = (message) => findings.push({ code: "SCHEMA", message });
  if (!object(value)) return [{ code: "SCHEMA", message: "ルートは object である必要があります" }];
  exact(value, ["schemaVersion", "kind", "worlds", "zones", "cameraStops", "edges", "retainedNodes"], ["schemaVersion", "kind", "worlds", "zones", "cameraStops", "edges", "retainedNodes", "inventory"], "ルート", fail);
  if (value.schemaVersion !== 3) fail("schemaVersion は 3 である必要があります");
  if (!oneOf(value.kind, ["flat", "spatial"])) fail("kind は flat / spatial のいずれかである必要があります");
  if (!Array.isArray(value.worlds) || value.worlds.length < 1) fail("worlds は 1 件以上の配列である必要があります");
  for (const [index, world] of entries(value.worlds)) {
    exact(world, ["id", "label", value.kind], ["id", "label", "palette", "flat", "spatial"], `worlds[${index}]`, fail);
    string(world?.id, `worlds[${index}].id`, fail);
    string(world?.label, `worlds[${index}].label`, fail);
    if (world?.palette !== undefined) {
      exact(world.palette, ["background", "dots", "accent"], ["background", "dots", "accent", "haze"], `worlds[${index}].palette`, fail);
      for (const [key, color] of Object.entries(world.palette ?? {})) if (!/^#[0-9a-fA-F]{6}$/.test(color)) fail(`worlds[${index}].palette.${key} は 6 桁 hex である必要があります`);
    }
    if (value.kind === "flat") {
      exact(world?.flat, ["bounds", "pattern"], ["bounds", "pattern", "far"], `worlds[${index}].flat`, fail);
      vector(world?.flat?.bounds, 4, `worlds[${index}].flat.bounds`, fail);
      if (!oneOf(world?.flat?.pattern, ["dots", "grid", "none"])) fail(`worlds[${index}].flat.pattern が未定義です`);
      if (world?.flat?.far !== undefined) for (const [farIndex, far] of entries(world.flat.far)) {
        exact(far, ["z", "color"], ["z", "color"], `worlds[${index}].flat.far[${farIndex}]`, fail);
        if (!number(far?.z) || far.z < 0 || far.z > 1) fail(`worlds[${index}].flat.far[${farIndex}].z は 0 以上 1 以下です`);
        if (!/^#[0-9a-fA-F]{6}$/.test(far?.color)) fail(`worlds[${index}].flat.far[${farIndex}].color は 6 桁 hex です`);
      }
    } else {
      exact(world?.spatial, ["c"], ["c", "floor", "background", "haze"], `worlds[${index}].spatial`, fail);
      vector(world?.spatial?.c, 3, `worlds[${index}].spatial.c`, fail);
      if (world?.spatial?.floor !== undefined) {
        exact(world.spatial.floor, ["center", "size"], ["center", "size"], `worlds[${index}].spatial.floor`, fail);
        vector(world.spatial.floor.center, 3, `worlds[${index}].spatial.floor.center`, fail);
        vector(world.spatial.floor.size, 2, `worlds[${index}].spatial.floor.size`, fail);
      }
      for (const key of ["background", "haze"]) if (world?.spatial?.[key] !== undefined && !numberArray(world.spatial[key])) fail(`worlds[${index}].spatial.${key} は number 配列です`);
    }
  }
  if (!Array.isArray(value.zones)) fail("zones は配列である必要があります");
  for (const [index, zone] of entries(value.zones)) {
    exact(zone, ["id", "world", "c"], ["id", "label", "world", "c"], `zones[${index}]`, fail);
    string(zone?.id, `zones[${index}].id`, fail); string(zone?.world, `zones[${index}].world`, fail);
    if (zone?.label !== undefined) string(zone.label, `zones[${index}].label`, fail);
    vector(zone?.c, value.kind === "flat" ? 2 : 3, `zones[${index}].c`, fail);
  }
  if (!Array.isArray(value.cameraStops)) fail("cameraStops は配列である必要があります");
  for (const [index, stop] of entries(value.cameraStops)) {
    const needed = value.kind === "flat" ? ["id", "world", "at", "leave", "c"] : ["id", "world", "at", "leave", "eye", "target"];
    exact(stop, needed, ["id", "label", "world", "at", "leave", "c", "eye", "target"], `cameraStops[${index}]`, fail);
    string(stop?.id, `cameraStops[${index}].id`, fail); string(stop?.world, `cameraStops[${index}].world`, fail);
    if (!number(stop?.at) || !number(stop?.leave)) fail(`cameraStops[${index}] の at / leave は number です`);
    if (value.kind === "flat") vector(stop?.c, 3, `cameraStops[${index}].c`, fail);
    else { vector(stop?.eye, 3, `cameraStops[${index}].eye`, fail); vector(stop?.target, 3, `cameraStops[${index}].target`, fail); }
  }
  if (!Array.isArray(value.edges)) fail("edges は配列である必要があります");
  for (const [index, edge] of entries(value.edges)) {
    exact(edge, ["id", "from", "to", "type", "t0", "t1", "transition"], ["id", "from", "to", "type", "t0", "t1", "switchTime", "transition", "via", "carry", "easing"], `edges[${index}]`, fail);
    for (const key of ["id", "from", "to"]) string(edge?.[key], `edges[${index}].${key}`, fail);
    if (!oneOf(edge?.type, ["move", "portal", "cut"])) fail(`edges[${index}].type が未定義です`);
    for (const key of ["t0", "t1"]) if (!number(edge?.[key])) fail(`edges[${index}].${key} は number です`);
    if (edge?.switchTime !== undefined && !number(edge.switchTime)) fail(`edges[${index}].switchTime は number です`);
    exact(edge?.transition, ["kind", "cover"], ["kind", "cover"], `edges[${index}].transition`, fail);
    if (!oneOf(edge?.transition?.kind, ["none", "dive", "mist", "occluder", "fade", "push"])) fail(`edges[${index}].transition.kind が未定義です`);
    if (edge?.transition?.cover !== null && !number(edge?.transition?.cover)) fail(`edges[${index}].transition.cover は number または null です`);
    if (edge?.via !== undefined) string(edge.via, `edges[${index}].via`, fail);
    if (edge?.carry !== undefined && !stringArray(edge.carry)) fail(`edges[${index}].carry は string 配列です`);
    if (edge?.easing !== undefined && !oneOf(edge.easing, ["ease-in-out", "linear"])) fail(`edges[${index}].easing が未定義です`);
  }
  if (!stringArray(value.retainedNodes)) fail("retainedNodes は string 配列である必要があります");
  if (value.inventory !== undefined && !Array.isArray(value.inventory)) fail("inventory は配列である必要があります");
  return findings;
}

function exact(value, required, allowed, label, fail) {
  if (!object(value)) { fail(`${label} は object である必要があります`); return; }
  for (const key of required) if (!Object.hasOwn(value, key)) fail(`${label} に必須キー ${key} がありません`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${label}.${key} は未定義です`);
}
function vector(value, length, label, fail) { if (!Array.isArray(value) || value.length !== length || !value.every(number)) fail(`${label} は number ${length} 要素です`); }
function entries(value) { return Array.isArray(value) ? value.entries() : []; }
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function number(value) { return typeof value === "number" && Number.isFinite(value); }
function string(value, label, fail) { if (typeof value !== "string" || value.length === 0) fail(`${label} は空でない string です`); }
function oneOf(value, choices) { return choices.includes(value); }
function stringArray(value) { return Array.isArray(value) && value.every((item) => typeof item === "string"); }
function numberArray(value) { return Array.isArray(value) && value.every(number); }
function regular(target) { try { return fs.statSync(target).isFile(); } catch { return false; } }
function directory(target) { try { return fs.statSync(target).isDirectory(); } catch { return false; } }
function finishFailure(message) {
  const result = { ok: false, file, schemaVersionIn: null, notes: [], errors: [{ code: "IO", message }], warnings: [] };
  if (jsonOutput) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else if (migrate) console.error(`NG: ${file}\n[IO] ${message}`);
  else {
    console.log(`NG: ${file}`);
    console.error(`[IO] ${message}`);
  }
  process.exit(1);
}
