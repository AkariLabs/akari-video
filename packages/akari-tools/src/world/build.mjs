import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolve as resolveAssetDefault } from "../../../asset-resolver/src/resolve.mjs";
import { openProject as openProjectDefault } from "../../../edit-store/lib/project.js";
import { checkWorldMap } from "./invariants.mjs";
import { readWorldItems } from "./items.mjs";
import { normalizeWorldMap } from "./normalize.mjs";

export class SpatialWorldBuildError extends Error {
  constructor() {
    super("spatial の build は次票（GLB 焼き）で対応します");
    this.exitCode = 2;
  }
}

export async function readCheckedWorldMap(projectRoot) {
  const file = path.join(projectRoot, "planning", "world-map.json");
  const source = JSON.parse(await readFile(file, "utf8"));
  if (typeof source?.schemaVersion === "number" && source.schemaVersion > 3) throw new Error(`schemaVersion ${source.schemaVersion} は新しすぎます`);
  const map = source?.schemaVersion === 3 ? source : normalizeWorldMap(source).map;
  const checked = checkWorldMap(map, { strict: false });
  if (checked.errors.length) throw new Error(checked.errors.map((finding) => `[${finding.code}] ${finding.message}`).join("\n"));
  return { map, file };
}

export async function buildWorld(projectRoot, options = {}) {
  projectRoot = path.resolve(projectRoot);
  const { map } = await readCheckedWorldMap(projectRoot);
  if (map.kind !== "flat") throw new SpatialWorldBuildError();
  const items = await readWorldItems(projectRoot);
  const edit = await readEdit(projectRoot);
  const frame = { width: edit.output?.width ?? 1920, height: edit.output?.height ?? 1080 };
  const resolveAsset = options.resolveAsset ?? resolveAssetDefault;
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
  for (const item of items) {
    if (!itemsByZone.has(item.zone)) throw new Error(`world item ${item.id} が未定義の zone を参照しています: ${item.zone}`);
    itemsByZone.get(item.zone).push(item);
  }
  const sheets = map.worlds.map((world) => {
    const [, , width, height] = world.flat.bounds;
    const zones = map.zones.filter((zone) => zone.world === world.id).map((zone) => {
      const contents = itemsByZone.get(zone.id).map((item) => {
        const [dx, dy] = item.offset ?? [0, 0];
        const vars = Object.entries(item.vars ?? {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => `${key.startsWith("--") ? "" : "--"}${cssName(key)}:${cssValue(value)}`).join(";");
        const style = [`left:${number(dx)}px`, `top:${number(dy)}px`, `--akari-item-scale:${number(item.scale ?? 1)}`, vars].filter(Boolean).join(";");
        return `<div class="akari-world-item" data-item="${attribute(item.id)}" style="${attribute(style)}">${fragments.get(item.id)}</div>`;
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
