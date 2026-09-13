import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { openProject } from "@akari-video/edit-store/lib/project";
import { snapshot } from "@akari-video/edit-store/lib/history-store";
import { insertItem, nextTrackId } from "@akari-video/edit-store/lib/tree-ops";

const exists = (path) => access(path).then(() => true, () => false);

export function firstVisualTrack(edit) {
  return edit.tracks.find((track) => track.lane === "visual");
}

export function endOfTrack(track) {
  return Math.max(0, ...(track?.items ?? []).map((item) => item.at + item.duration));
}

export function hasGeneratedId(edit, id) {
  const generatedId = `gen-${id}`;
  if ((edit.sources ?? []).some((source) => source.id === generatedId)) return true;
  const visit = (items) => items.some((item) => item.id === generatedId || visit(item.children ?? []));
  return (edit.tracks ?? []).some((track) => visit(track.items ?? []));
}

export async function readEditForPlan(projectDir) {
  try {
    return JSON.parse(await readFile(join(projectDir, "edit.json"), "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return {
      version: 2,
      output: { width: 1920, height: 1080, fps: 30 },
      sources: [],
      tracks: [{ id: "v1", lane: "visual", items: [] }],
    };
  }
}

async function ensureProject(projectDir) {
  const editPath = join(projectDir, "edit.json");
  if (!(await exists(editPath))) {
    await mkdir(projectDir, { recursive: true });
    await writeFile(editPath, `${JSON.stringify({
      version: 2,
      output: { width: 1920, height: 1080, fps: 30 },
      sources: [],
      tracks: [{ id: "v1", lane: "visual", items: [] }],
    }, null, 2)}\n`, "utf8");
  }
}

export async function insertGeneratedStills({
  projectDir,
  beats,
  open = openProject,
  takeSnapshot = snapshot,
  insert = insertItem,
}) {
  if (beats.length === 0) return { inserted: 0, snapshotCount: 0 };
  await ensureProject(projectDir);
  const project = await open(projectDir);
  let track = firstVisualTrack(project.edit);
  await takeSnapshot({ projectDir, label: `generate still: ${beats.length} 枚` });
  project.edit.sources ??= [];
  if (!track) {
    track = { id: nextTrackId(project.edit, "visual"), lane: "visual", items: [] };
    project.edit.tracks.push(track);
  }
  let at = endOfTrack(track);
  for (const beat of beats) {
    const sourceId = `gen-${beat.id}`;
    project.edit.sources.push({ id: sourceId, path: beat.path, proxy: null });
    const item = {
      id: sourceId,
      ...(beat.name ? { name: beat.name } : {}),
      at,
      duration: beat.frames,
      source: { kind: "media", src: sourceId, in: 0, out: beat.duration_s },
    };
    insert(project.edit, track.id, item);
    at += beat.frames;
  }
  await project.save();
  return { inserted: beats.length, snapshotCount: 1 };
}
