#!/usr/bin/env node
// `akari geo` — 国土地理院の公開タイルから 3D 地形の素材を作り、地点を 3D 座標へ直す。
import path from "node:path";

import { isMainModule } from "../src/common/main-module.mjs";

const terrainUsage = [
  "使い方: akari geo terrain --bbox <西,南,東,北> --out <dir> [--zoom 1-14] [--max-tiles 64] [--cache-dir <dir>] [--json]",
  "",
  "国土地理院の標高タイル（dem_png）と写真タイル（seamlessphoto）を結合し、",
  "heightmap.png・texture.png・terrain.json を出力します。",
  "",
  "  --bbox        西,南,東,北（世界測地系の度）",
  "  --out         出力先ディレクトリ（必須）",
  "  --zoom        タイルのズーム（既定 14）",
  "  --max-tiles   取得するタイル数の上限（既定 64）",
  "  --cache-dir   タイルのキャッシュ先（既定 ~/.akari/cache/geo）",
  "  --json        結果を JSON で出力",
  "",
  "terrain.json の declaration を 3D の terrain 宣言にそのまま貼れます。",
].join("\n");

const pointUsage = [
  "使い方: akari geo point --terrain <terrain.json> --lonlat <経度,緯度>[,高さm] [--json]",
  "",
  "地形の declaration（size・meters・baseline・exaggeration）に合わせて、",
  "経緯度から 3D 座標 [x, y, z] を出力します。高さを省略すると高さマップから引きます。",
  "",
  "  --terrain     akari geo terrain が出力した terrain.json",
  "  --lonlat      経度,緯度（,高さm は任意）",
  "  --json        結果を JSON で出力（既定も JSON 配列）",
  "",
  "出力は lines[].points と data-akari-3d-anchor にそのまま使えます。",
].join("\n");

const usage = [terrainUsage, "", pointUsage, "",
  "生成物を使うときは「出典: 国土地理院（地理院タイル）」を必ず表示してください。"].join("\n");

function parseTerrainArgs(args) {
  const parsed = { json: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") parsed.json = true;
    else if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (["--bbox", "--out", "--zoom", "--max-tiles", "--cache-dir"].includes(arg)) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) return { ok: false, reason: `${arg} の値がありません` };
      parsed[arg.slice(2)] = value;
      index += 1;
    } else if (arg.startsWith("--bbox=")) parsed.bbox = arg.slice(7);
    else if (arg.startsWith("--out=")) parsed.out = arg.slice(6);
    else if (arg.startsWith("--zoom=")) parsed.zoom = arg.slice(7);
    else if (arg.startsWith("--max-tiles=")) parsed["max-tiles"] = arg.slice(12);
    else if (arg.startsWith("--cache-dir=")) parsed["cache-dir"] = arg.slice(12);
    else return { ok: false, reason: `不明な引数です: ${arg}` };
  }
  if (parsed.help) return { ok: true, parsed };
  if (!parsed.bbox) return { ok: false, reason: "--bbox を指定してください" };
  if (!parsed.out) return { ok: false, reason: "--out を指定してください" };
  return { ok: true, parsed };
}

function parsePointArgs(args) {
  const parsed = { json: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") parsed.json = true;
    else if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (["--terrain", "--lonlat"].includes(arg)) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) return { ok: false, reason: `${arg} の値がありません` };
      parsed[arg.slice(2)] = value;
      index += 1;
    } else if (arg.startsWith("--terrain=")) parsed.terrain = arg.slice(10);
    else if (arg.startsWith("--lonlat=")) parsed.lonlat = arg.slice(9);
    else return { ok: false, reason: `不明な引数です: ${arg}` };
  }
  if (parsed.help) return { ok: true, parsed };
  if (!parsed.terrain) return { ok: false, reason: "--terrain を指定してください" };
  if (!parsed.lonlat) return { ok: false, reason: "--lonlat を指定してください" };
  return { ok: true, parsed };
}

async function runTerrain(args, options, log, logError) {
  const parsed = parseTerrainArgs(args);
  if (!parsed.ok) {
    logError(parsed.reason);
    logError(terrainUsage);
    return { exitCode: 2 };
  }
  if (parsed.parsed.help) {
    log(terrainUsage);
    return { exitCode: 0 };
  }
  const build = options.buildTerrain ?? (await import("../src/geo/terrain.mjs")).buildTerrain;
  try {
    const result = await build({
      bbox: parsed.parsed.bbox,
      outDir: path.resolve(parsed.parsed.out),
      zoom: parsed.parsed.zoom,
      maxTiles: parsed.parsed["max-tiles"],
      cacheDir: parsed.parsed["cache-dir"],
      env: options.env,
      log: parsed.parsed.json ? () => {} : log,
    });
    if (parsed.parsed.json) {
      log(JSON.stringify({
        out: result.outDir,
        files: result.files,
        terrain: result.terrain,
        size: result.size,
        tiles: result.tiles,
        missing: result.missing,
        filled: result.filled,
      }));
    } else {
      log(`出力先: ${result.outDir}`);
    }
    return { exitCode: 0 };
  } catch (error) {
    logError(error instanceof Error ? error.message : String(error));
    return { exitCode: 1 };
  }
}

async function runPoint(args, options, log, logError) {
  const parsed = parsePointArgs(args);
  if (!parsed.ok) {
    logError(parsed.reason);
    logError(pointUsage);
    return { exitCode: 2 };
  }
  if (parsed.parsed.help) {
    log(pointUsage);
    return { exitCode: 0 };
  }
  const module = await import("../src/geo/point.mjs");
  const loadTerrainFiles = options.loadTerrainFiles ?? module.loadTerrainFiles;
  const terrainPoint = options.terrainPoint ?? module.terrainPoint;
  const roundPoint = options.roundPoint ?? module.roundPoint;
  const parseLonLat = options.parseLonLat ?? module.parseLonLat;
  try {
    const { lon, lat, height } = parseLonLat(parsed.parsed.lonlat);
    const { terrain, image } = await loadTerrainFiles(parsed.parsed.terrain);
    const point = terrainPoint({ terrain, image, lon, lat, height });
    log(JSON.stringify(roundPoint(point)));
    return { exitCode: 0 };
  } catch (error) {
    logError(error instanceof Error ? error.message : String(error));
    return { exitCode: 1 };
  }
}

export async function runGeoCommand(args, options = {}) {
  const log = options.log ?? console.log;
  const logError = options.logError ?? console.error;
  const subcommand = args[0];
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    log(usage);
    return { exitCode: 0 };
  }
  if (subcommand === "terrain") return runTerrain(args.slice(1), options, log, logError);
  if (subcommand === "point") return runPoint(args.slice(1), options, log, logError);
  logError(`不明な geo サブコマンドです: ${subcommand}`);
  logError(usage);
  return { exitCode: 2 };
}

if (isMainModule(import.meta.url)) {
  const result = await runGeoCommand(process.argv.slice(2));
  process.exitCode = result.exitCode;
}
