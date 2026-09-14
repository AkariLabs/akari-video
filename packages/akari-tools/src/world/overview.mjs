import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
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
  const [template, cameraSource, flatRuntimeSource, videos] = await Promise.all([
    readFile(TEMPLATE, "utf8"),
    readFile(CAMERA, "utf8"),
    readOptional(RUNTIME),
    embeddedVideos(projectRoot),
  ]);
  const runtimeSource = map.kind === "flat" ? flatRuntimeSource : null;
  const duration = map.cameraStops.at(-1)?.leave ?? 0;
  const frame = await editFrame(projectRoot);
  const declaration = map.kind === "flat" ? worldSceneDeclaration(map, frame) : { ...map, frame };
  const bands = map.worlds.map((world, index) => {
    const marker = index < map.worlds.length - 1 && map.edges.some((edge) => edge.type !== "move" && map.cameraStops.find((stop) => stop.id === edge.from)?.world === world.id) ? '<i class="edge-marker" data-edge-marker></i>' : "";
    return `<div class="world-band" data-world-band data-world="${escapeHtml(world.id)}" style="flex:1;background:${world.palette?.accent ?? "#8190aa"}">${escapeHtml(world.label)}${marker}</div>`;
  }).join("");
  const videoHtml = videos.length ? videos.map((video) => `<video muted preload="auto" src="data:video/mp4;base64,${video}"></video>`).join("") : "書き出しはまだありません";
  const html = template
    .replace("__FALLBACK_ATTRIBUTE__", runtimeSource ? "" : 'data-fallback="true"')
    .replace("__WORLD_BANDS__", bands)
    .replace("__DURATION__", String(duration))
    .replace("__VIDEOS__", videoHtml)
    .replace("__CAMERA_SOURCE__", `(()=>{${inlineModule(cameraSource)}\nglobalThis.__akariCreateCamera=createCamera;globalThis.AkariWorldCamera={createCamera};})();`)
    .replace("__RUNTIME_SOURCE__", runtimeSource ? `(()=>{${inlineModule(runtimeSource)}})();` : "")
    .replace("__WORLD_MAP__", safeJson(declaration));
  const output = path.join(projectRoot, ".akari", "reports", "world-overview.html");
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, html, "utf8");
  return { output, html, fallback: !runtimeSource };
}

async function editFrame(projectRoot) {
  const edit = JSON.parse(await readFile(path.join(projectRoot, "edit.json"), "utf8"));
  return { width: edit.output?.width ?? 1920, height: edit.output?.height ?? 1080 };
}
async function embeddedVideos(projectRoot) {
  const directory = path.join(projectRoot, "exports");
  let names;
  try { names = (await readdir(directory)).filter((name) => name.toLowerCase().endsWith(".mp4")).sort(); } catch (error) { if (error?.code === "ENOENT") return []; throw error; }
  return Promise.all(names.map(async (name) => (await readFile(path.join(directory, name))).toString("base64")));
}
async function readOptional(file) { try { return await readFile(file, "utf8"); } catch (error) { if (error?.code === "ENOENT") return null; throw error; } }
const inlineModule = (source) => source.replace(/^export\s+/gm, "").replaceAll("</script", "<\\/script");
const safeJson = (value) => JSON.stringify(value).replaceAll("<", "\\u003c");
const escapeHtml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
