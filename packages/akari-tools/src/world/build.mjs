import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolve as resolveAssetDefault } from "../../../asset-resolver/src/resolve.mjs";
import { openProject as openProjectDefault } from "../../../edit-store/lib/project.js";
import { checkWorldMap } from "./invariants.mjs";
import { readWorldItems } from "./items.mjs";
import { normalizeWorldMap } from "./normalize.mjs";
import { buildSpatialGlb, renderSpatialWorldHtml } from "./spatial-glb.mjs";

export async function readCheckedWorldMap(projectRoot, options = {}) {
  const file = path.join(projectRoot, "planning", "world-map.json");
  const source = JSON.parse(await readFile(file, "utf8"));
  if (typeof source?.schemaVersion === "number" && source.schemaVersion > 3) throw new Error(`schemaVersion ${source.schemaVersion} は新しすぎます`);
  const map = source?.schemaVersion === 3 ? source : normalizeWorldMap(source).map;
  const checked = checkWorldMap(map, { strict: false });
  const ignored = new Set(options.ignoreCodes ?? []);
  const errors = checked.errors.filter((finding) => !ignored.has(finding.code));
  if (errors.length) throw new Error(errors.map((finding) => `[${finding.code}] ${finding.message}`).join("\n"));
  return { map, file, check: checked };
}

export async function buildWorld(projectRoot, options = {}) {
  projectRoot = path.resolve(projectRoot);
  const { map } = await readCheckedWorldMap(projectRoot);
  const items = await readWorldItems(projectRoot);
  const edit = await readEdit(projectRoot);
  if (edit.version !== 2) throw new Error("world build は edit.json version 2 が必要です。先に akari migrate <project-root> を実行してください");
  const frame = { width: edit.output?.width ?? 1920, height: edit.output?.height ?? 1080 };
  const resolveAsset = options.resolveAsset ?? resolveAssetDefault;
  if (map.kind === "spatial") {
    const spatialItems = await resolveSpatialItems(projectRoot, map, items.items, resolveAsset);
    const built = buildSpatialGlb(map, spatialItems);
    const glbPath = path.join(projectRoot, "assets", "world", "world.glb");
    const overlayPath = path.join(projectRoot, "overlays", "world.html");
    const html = renderSpatialWorldHtml(map);
    await Promise.all([mkdir(path.dirname(glbPath), { recursive: true }), mkdir(path.dirname(overlayPath), { recursive: true })]);
    await Promise.all([writeFile(glbPath, built.buffer), writeFile(overlayPath, html, "utf8")]);
    await upsertWorldItem(projectRoot, map, options);
    return { map, html, overlayPath, glbPath, glb: built.buffer, gltf: built.json };
  }
  const fragments = new Map();
  const zoneIds = new Set(map.zones.map((zone) => zone.id));
  for (const item of items.items) {
    if (!zoneIds.has(item.zone)) throw new Error(`world item ${item.id} が未定義の zone を参照しています: ${item.zone}`);
    const assetId = item.asset.slice("overlay/".length);
    const resolved = await resolveAsset(assetId, { project: projectRoot });
    if (resolved?.category && resolved.category !== "overlay") throw new Error(`素材 ${item.asset} は overlay ではありません`);
    const directory = resolved?.projectDir ?? resolved?.dir;
    if (!directory) throw new Error(`素材 ${item.asset} の配置先を解決できません`);
    fragments.set(item.id, await readFile(path.join(directory, "fragment.html"), "utf8"));
  }
  const html = renderWorldHtml(map, items.items, fragments, frame);
  const overlayPath = path.join(projectRoot, "overlays", "world.html");
  await mkdir(path.dirname(overlayPath), { recursive: true });
  await writeFile(overlayPath, html, "utf8");
  await upsertWorldItem(projectRoot, map, options);
  return { map, html, overlayPath };
}

async function resolveSpatialItems(projectRoot, map, items, resolveAsset) {
  const zoneById = new Map(map.zones.map((zone) => [zone.id, zone]));
  const result = [];
  for (const item of items) {
    const zone = zoneById.get(item.zone);
    if (!zone) throw new Error(`world item ${item.id} が未定義の zone を参照しています: ${item.zone}`);
    const assetId = item.asset.includes("/") ? item.asset.slice(item.asset.indexOf("/") + 1) : item.asset;
    const resolved = await resolveAsset(assetId, { project: projectRoot });
    const directory = resolved?.projectDir ?? resolved?.dir;
    if (!directory) throw new Error(`素材 ${item.asset} の配置先を解決できません`);
    const model = await findGlb(directory);
    if (!model) continue;
    result.push({ ...item, zone, buffer: await readFile(model) });
  }
  return result;
}

async function findGlb(directory) {
  try {
    const fragment = await readFile(path.join(directory, "fragment.html"), "utf8");
    const match = /<script\b[^>]*\bdata-akari-3d-scene\b[^>]*>([\s\S]*?)<\/script>/i.exec(fragment);
    if (match) {
      const model = JSON.parse(match[1]).model;
      const candidate = typeof model === "string" ? path.resolve(directory, model) : null;
      if (candidate && candidate.startsWith(`${path.resolve(directory)}${path.sep}`) && candidate.toLowerCase().endsWith(".glb")) {
        await readFile(candidate);
        return candidate;
      }
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  const names = entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".glb"))
    .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name)).sort();
  return names[0] ?? null;
}

export function worldSceneDeclaration(map, frame) {
  return {
    schemaVersion: 1,
    kind: "flat",
    frame,
    worlds: map.worlds,
    zones: map.zones,
    cameraStops: map.cameraStops,
    edges: map.edges,
    retainedNodes: map.retainedNodes,
    render: { dotStep: 90, margin: 0.25, hazeAlpha: 0.92 },
  };
}

export function renderWorldHtml(map, items, fragments, frame) {
  const declaration = JSON.stringify(worldSceneDeclaration(map, frame)).replaceAll("</script", "<\\/script");
  const itemsByZone = new Map(map.zones.map((zone) => [zone.id, []]));
  const stopsById = new Map(map.cameraStops.map((stop) => [stop.id, stop]));
  for (const item of items) {
    if (!itemsByZone.has(item.zone)) throw new Error(`world item ${item.id} が未定義の zone を参照しています: ${item.zone}`);
    itemsByZone.get(item.zone).push(item);
  }
  const sheets = map.worlds.map((world) => {
    const [, , width, height] = world.flat.bounds;
    const zones = map.zones.filter((zone) => zone.world === world.id).map((zone) => {
      const contents = itemsByZone.get(zone.id).map((item) => {
        const [dx, dy] = item.offset ?? [0, 0];
        const stop = stopsById.get(zone.id);
        const start = stop ? stop.at + (item.delay ?? 0) : 0;
        const background = item.role === "background" || (item.role === undefined && Object.keys(item.vars ?? {}).some((key) => ["world-width", "world-height"].includes(cssName(key).replace(/^--/, ""))));
        const vars = Object.entries(item.vars ?? {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => `${key.startsWith("--") ? "" : "--"}${cssName(key)}:${cssValue(value)}`).join(";");
        const style = [`left:${number(dx)}px`, `top:${number(dy)}px`, `--akari-item-scale:${number(item.scale ?? 1)}`, vars].filter(Boolean).join(";");
        return `<div class="akari-world-item" data-item="${attribute(item.id)}" data-akari-item-start="${number(start)}"${background ? ' data-akari-role="background"' : ""} style="${attribute(style)}">${fragments.get(item.id)}</div>`;
      }).join("");
      return `<div class="akari-world-zone" data-zone="${attribute(zone.id)}" style="left:${number(zone.c[0])}px; top:${number(zone.c[1])}px">${contents}</div>`;
    }).join("");
    return `<div class="akari-world-sheet" data-world="${attribute(world.id)}" style="left:0px; top:0px; width:${number(width)}px; height:${number(height)}px">${zones}</div>`;
  }).join("\n");
  return `<div class="akari-world-scene"><style>.akari-world-scene{position:absolute;inset:0}.akari-world-sheet,.akari-world-zone,.akari-world-item{position:absolute}.akari-world-sheet{transform-origin:0 0}.akari-world-item{scale:var(--akari-item-scale,1);transform-origin:0 0}</style><script type="application/json" data-akari-world-scene>${declaration}</script>\n${sheets}</div>\n`;
}

async function upsertWorldItem(projectRoot, map, options) {
  const openProject = options.openProject ?? openProjectDefault;
  const project = await openProject(projectRoot);
  const fps = project.edit.output?.fps ?? 30;
  const duration = Math.round(map.cameraStops.at(-1).leave * fps);
  const existing = project.edit.find("world");
  if (existing) {
    project.edit.update("world", { duration, source: { kind: "html", path: "overlays/world.html" } });
  } else {
    let track = project.edit.tracks.find((candidate) => candidate.lane === "visual");
    if (!track) {
      track = { id: "world-visual", lane: "visual", items: [] };
      project.edit.tracks.push(track);
    }
    project.edit.insert(track.id, { id: "world", at: 0, duration, source: { kind: "html", path: "overlays/world.html" } });
  }
  await project.save();
}

async function readEdit(projectRoot) {
  return JSON.parse(await readFile(path.join(projectRoot, "edit.json"), "utf8"));
}

const number = (value) => Number(value).toString();
const attribute = (value) => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
const cssName = (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, "-");
const cssValue = (value) => String(value).replace(/[;{}]/g, "");
