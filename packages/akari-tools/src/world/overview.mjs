import { readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readCheckedWorldMap, worldSceneDeclaration } from "./build.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.join(HERE, "overview-template.html");
const CAMERA = path.join(HERE, "camera.mjs");
const RUNTIME = path.resolve(HERE, "../../../overlay-runtime/src/world-runtime.js");

export async function buildWorldOverview(projectRoot) {
  projectRoot = path.resolve(projectRoot);
  const { map } = await readCheckedWorldMap(projectRoot);
  const [template, cameraSource, runtimeSource, fragment, video, proof] = await Promise.all([
    readFile(TEMPLATE, "utf8"), readFile(CAMERA, "utf8"), readFile(RUNTIME, "utf8"),
    readOptional(path.join(projectRoot, "overlays", "world.html")), newestVideo(projectRoot),
    readJsonOptional(path.join(projectRoot, ".akari", "reports", "world-preview", "camera-proof.json")),
  ]);
  const frame = await editFrame(projectRoot);
  const declaration = map.kind === "flat" ? worldSceneDeclaration(map, frame) : { ...map, frame };
  const duration = map.cameraStops.at(-1)?.leave ?? 0;
  const atlas = map.kind === "flat" && Boolean(fragment);
  const iframeDocument = atlas ? makeIframeDocument(fragment, cameraSource, runtimeSource) : "";
  const stopById = new Map(map.cameraStops.map(stop => [stop.id, stop]));
  const bands = map.worlds.map((world, index) => {
    const nextWorld = map.worlds[index + 1];
    const edge = nextWorld && map.edges.find(candidate => candidate.type !== "move" && stopById.get(candidate.from)?.world === world.id && stopById.get(candidate.to)?.world === nextWorld.id);
    const marker = edge ? `<i class="edge-marker" data-edge-marker="${escapeHtml(edge.id)}" title="${escapeHtml(`${edge.type} / ${edge.transition?.kind ?? "none"} / cover ${Number(edge.transition?.cover ?? 0)}s`)}"></i>` : "";
    const stops = map.cameraStops.filter(stop => stop.world === world.id);
    const range = stops.length ? ` (${Math.min(...stops.map(stop => stop.at))}–${Math.max(...stops.map(stop => stop.leave))}s)` : "";
    return `<div class="world-band" data-world-band data-world="${escapeHtml(world.id)}" title="${escapeHtml(`${world.label}${range}`)}" style="flex:1;background:${escapeHtml(world.palette?.accent ?? "#8190aa")}">${escapeHtml(world.label)}${marker}</div>`;
  }).join("");
  const edges = map.edges.map(edge => `<button class="edge-chip" data-edge-jump="${escapeHtml(edge.id)}">${escapeHtml(edge.type)} · ${escapeHtml(edge.transition?.kind ?? "none")} · ${Number(edge.transition?.cover ?? 0)}s</button>`).join("");
  const videoHtml = video ? `<video muted preload="auto" src="data:video/mp4;base64,${video}"></video>` : "書き出しはまだありません";
  const html = template
    .replace("__FALLBACK_ATTRIBUTE__", atlas ? "" : 'data-fallback="true"')
    .replace("__WORLD_BANDS__", bands).replace("__EDGE_CHIPS__", edges)
    .replace("__DURATION__", String(duration)).replace("__VIDEOS__", videoHtml)
    .replace("__CAMERA_SOURCE__", `(()=>{${inlineModule(cameraSource)}\nglobalThis.__akariCreateCamera=createCamera;globalThis.AkariWorldCamera={createCamera};})();`)
    .replace("__RUNTIME_SOURCE__", atlas ? "" : `(()=>{${inlineModule(runtimeSource)}})();`)
    .replace("__WORLD_MAP__", safeJson(declaration)).replace("__CAMERA_PROOF__", safeJson(proof?.frames ?? []))
    .replace("__ATLAS_DOCUMENT__", JSON.stringify(Buffer.from(iframeDocument).toString("base64")))
    .replace("__ATLAS_ENABLED__", String(atlas));
  const output = path.join(projectRoot, ".akari", "reports", "world-overview.html");
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, html, "utf8");
  return { output, html, fallback: !atlas, atlas };
}

function makeIframeDocument(fragment, cameraSource, runtimeSource) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}#akari-atlas-stage{position:absolute;inset:0;overflow:visible}</style></head><body><div id="akari-atlas-stage">${fragment}</div><script>${inlineModule(cameraSource)}\nglobalThis.AkariWorldCamera={createCamera};<\/script><script>${runtimeSource.replaceAll("</script", "<\\/script")}<\/script><script>(()=>{const scene=document.querySelector('.akari-world-scene')||document.getElementById('akari-atlas-stage');window.akariAtlasRender=(seconds,view)=>window.akari.worldRuntime.render(scene,seconds,{overview:view});window.akariAtlasInspect=()=>window.akari.worldRuntime.inspect(scene);window.akariAtlasReady=true;})();<\/script></body></html>`;
}

async function editFrame(projectRoot) {
  const edit = JSON.parse(await readFile(path.join(projectRoot, "edit.json"), "utf8"));
  return { width: edit.output?.width ?? 1920, height: edit.output?.height ?? 1080 };
}
async function newestVideo(projectRoot) {
  for (const relative of [path.join(".akari", "out"), "exports"]) {
    const directory = path.join(projectRoot, relative);
    let names;
    try { names = (await readdir(directory)).filter(name => name.toLowerCase().endsWith(".mp4")); }
    catch (error) { if (error?.code === "ENOENT") continue; throw error; }
    const files = await Promise.all(names.map(async name => ({ name, time: (await stat(path.join(directory, name))).mtimeMs })));
    const newest = files.sort((a, b) => b.time - a.time)[0];
    if (newest) return (await readFile(path.join(directory, newest.name))).toString("base64");
  }
  return null;
}
async function readOptional(file) { try { return await readFile(file, "utf8"); } catch (error) { if (error?.code === "ENOENT") return null; throw error; } }
async function readJsonOptional(file) { const source = await readOptional(file); return source ? JSON.parse(source) : null; }
const inlineModule = source => source.replace(/^export\s+/gm, "").replaceAll("</script", "<\\/script");
const safeJson = value => JSON.stringify(value).replaceAll("<", "\\u003c");
const escapeHtml = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
