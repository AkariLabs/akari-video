#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const usage = "使い方: node bin/expand-template.mjs <template.json> <script.json> --out planning/world-map.json";
const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
if (args.length !== 4 || outIndex !== 2 || !args[3]) fail(usage);

const templatePath = path.resolve(args[0]);
const scriptPath = path.resolve(args[1]);
const outPath = path.resolve(args[3]);

try {
  const template = JSON.parse(await readFile(templatePath, "utf8"));
  const script = JSON.parse(await readFile(scriptPath, "utf8"));
  const map = expand(template, script);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(map, null, 2)}\n`, "utf8");
  process.stdout.write(`${outPath}\n`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

export function expand(template, script) {
  if (!record(template) || template.schemaVersion !== 1 || template.for !== "world-map") throw new Error("template は schemaVersion: 1 / for: world-map である必要があります");
  if (!Array.isArray(template.worlds) || !Array.isArray(template.stops) || !Array.isArray(template.edges)) throw new Error("template に worlds / stops / edges が必要です");
  if (!record(template.layout)) throw new Error("template.layout が必要です");
  if (!record(script) || !Array.isArray(script.stops)) throw new Error("script.stops が必要です");
  if (script.stops.length !== template.stops.length) throw new Error("script.stops は template.stops と同じ件数・順序にしてください");
  if (template.edges.length !== Math.max(0, template.stops.length - 1)) throw new Error("template.edges は stops - 1 件必要です");

  const layout = normalizeLayout(template.layout);
  const worldIds = new Set();
  for (const world of template.worlds) {
    if (!string(world?.id) || worldIds.has(world.id)) throw new Error("template.worlds の id は空でない一意な文字列です");
    worldIds.add(world.id);
  }

  const pairedStops = template.stops.map((stop, index) => {
    const authored = script.stops[index];
    if (!record(stop) || !record(authored) || authored.id !== stop.id) throw new Error(`script.stops[${index}].id は ${stop?.id} にしてください`);
    if (!worldIds.has(stop.world)) throw new Error(`stop ${stop.id} が未定義の world を参照しています`);
    if (!string(authored.label) || !positive(authored.dwell) || !string(authored.asset)) throw new Error(`script stop ${stop.id} には label / 正の dwell / asset が必要です`);
    const scale = stop.scale ?? 1.1;
    if (!finite(scale) || scale < 1 || scale > 1.3) throw new Error(`stop ${stop.id} の scale は 1.0〜1.3 です`);
    return { skeleton: stop, authored, scale };
  });

  const stopsByWorld = new Map(template.worlds.map((world) => [world.id, []]));
  for (const pair of pairedStops) stopsByWorld.get(pair.skeleton.world).push(pair);
  for (const [worldId, stops] of stopsByWorld) if (stops.length < 2) throw new Error(`world ${worldId} には stop が 2 件以上必要です`);

  let worldX = layout.origin[0];
  const boundsByWorld = new Map();
  const worlds = template.worlds.map((world) => {
    const count = stopsByWorld.get(world.id).length;
    const width = Math.max(layout.worldWidth, layout.padding * 2 + layout.stopSpacing * (count - 1));
    const bounds = [worldX, layout.origin[1], width, layout.worldHeight];
    boundsByWorld.set(world.id, bounds);
    worldX += width + layout.worldGap;
    const override = record(script.worlds?.[world.id]) ? script.worlds[world.id] : {};
    const palette = { ...world.palette, ...(record(override.palette) ? override.palette : {}) };
    validatePalette(palette, world.id);
    return {
      id: world.id,
      label: string(override.label) ? override.label : world.label,
      palette,
      flat: { bounds, pattern: world.pattern }
    };
  });

  const zoneCoordinates = new Map();
  for (const world of template.worlds) {
    const bounds = boundsByWorld.get(world.id);
    stopsByWorld.get(world.id).forEach((pair, index) => {
      const x = bounds[0] + layout.padding + layout.stopSpacing * index;
      const y = bounds[1] + bounds[3] / 2 + (index % 2 === 0 ? -layout.stopOffsetY : layout.stopOffsetY);
      zoneCoordinates.set(pair.skeleton.id, [x, y]);
    });
  }

  const zones = pairedStops.map(({ skeleton, authored }) => ({
    id: skeleton.id,
    label: authored.label,
    world: skeleton.world,
    c: zoneCoordinates.get(skeleton.id)
  }));

  let clockMs = 0;
  const cameraStops = pairedStops.map(({ skeleton, authored, scale }, index) => {
    const at = clockMs;
    const leave = at + milliseconds(authored.dwell, `stop ${skeleton.id} dwell`);
    clockMs = leave;
    if (index < template.edges.length) clockMs += edgeDuration(template.edges[index].type);
    const [x, y] = zoneCoordinates.get(skeleton.id);
    return { id: skeleton.id, world: skeleton.world, at: seconds(at), leave: seconds(leave), c: [x, y, scale] };
  });

  const carry = uniqueStrings(script.carry);
  const edges = template.edges.map((edge, index) => {
    const from = cameraStops[index];
    const to = cameraStops[index + 1];
    if (!record(edge) || !["move", "portal", "cut"].includes(edge.type)) throw new Error(`template.edges[${index}].type が未定義です`);
    const crossesWorld = from.world !== to.world;
    if (!crossesWorld && edge.type !== "move") throw new Error(`同じ world の edge ${index} は move にしてください`);
    if (crossesWorld && edge.type === "move") throw new Error(`世界をまたぐ edge ${index} は portal または cut にしてください`);
    if (crossesWorld && carry.length === 0) throw new Error("世界をまたぐ辺には script.carry が 1 件以上必要です");
    // build / preview の宣言は有限の cover を要求する。ここでは build 可能な暫定値を置き、
    // preview --measure の実測値で置き換える。
    const cover = transitionCover(edge, index);
    const result = {
      id: `${from.id}-to-${to.id}`,
      from: from.id,
      to: to.id,
      type: edge.type,
      t0: from.leave,
      t1: to.at,
      transition: edge.type === "move" ? { kind: "none", cover } : { kind: edge.type === "cut" ? "mist" : "dive", cover }
    };
    if (edge.type !== "move") {
      if (!string(edge.via)) throw new Error(`edge ${index} の via が必要です`);
      result.via = edge.via;
      result.switchTime = seconds(Math.round((milliseconds(from.leave) + milliseconds(to.at)) / 2));
    }
    if (crossesWorld) result.carry = carry;
    return result;
  });

  return {
    schemaVersion: 3,
    kind: "flat",
    worlds,
    zones,
    cameraStops,
    edges,
    retainedNodes: carry,
    inventory: pairedStops.map(({ skeleton, authored }) => ({ id: `${skeleton.id}-asset`, zone: skeleton.id, asset: `overlay/${authored.asset}` }))
  };
}

function normalizeLayout(value) {
  const result = {
    origin: value.origin,
    worldWidth: value.worldWidth,
    worldHeight: value.worldHeight,
    worldGap: value.worldGap,
    stopSpacing: value.stopSpacing,
    padding: value.padding,
    stopOffsetY: value.stopOffsetY ?? 48
  };
  if (!Array.isArray(result.origin) || result.origin.length !== 2 || !result.origin.every(finite)) throw new Error("layout.origin は数値 2 要素です");
  for (const key of ["worldWidth", "worldHeight", "worldGap", "stopSpacing", "padding"]) if (!positive(result[key])) throw new Error(`layout.${key} は正の数です`);
  if (!finite(result.stopOffsetY) || result.stopOffsetY < 0) throw new Error("layout.stopOffsetY は 0 以上です");
  return result;
}

function validatePalette(palette, worldId) {
  for (const key of ["background", "dots", "accent"]) if (!/^#[0-9a-fA-F]{6}$/.test(palette?.[key])) throw new Error(`world ${worldId} の palette.${key} は 6 桁 hex です`);
  if (palette.haze !== undefined && !/^#[0-9a-fA-F]{6}$/.test(palette.haze)) throw new Error(`world ${worldId} の palette.haze は 6 桁 hex です`);
}

function edgeDuration(type) {
  if (type === "move") return 750;
  if (type === "portal") return 1200;
  if (type === "cut") return 800;
  throw new Error(`edge type が未定義です: ${type}`);
}

function transitionCover(edge, index) {
  const fallback = edge.type === "move" ? 0 : edge.type === "portal" ? 0.18 : 0.24;
  if (edge.cover === undefined) return fallback;
  if (!finite(edge.cover) || edge.cover < 0 || edge.cover > 0.4) {
    throw new Error(`template.edges[${index}].cover は 0 以上 0.4 以下の有限数です`);
  }
  if (edge.type === "move" && edge.cover !== 0) {
    throw new Error(`template.edges[${index}].cover は move では 0 にしてください`);
  }
  return edge.cover;
}

function milliseconds(value, label = "time") {
  if (!finite(value)) throw new Error(`${label} は有限数です`);
  return Math.round(value * 1000 / 50) * 50;
}

function seconds(value) { return value / 1000; }
function finite(value) { return typeof value === "number" && Number.isFinite(value); }
function positive(value) { return finite(value) && value > 0; }
function string(value) { return typeof value === "string" && value.length > 0; }
function record(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function uniqueStrings(value) { return Array.isArray(value) ? [...new Set(value.filter(string))] : []; }

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}
