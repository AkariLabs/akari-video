import { basename, join, resolve } from "node:path";
import migrate from "../../../edit-store/lib/migrate/index.js";
import { buildPlan } from "../../src/plan.mjs";
import { readRenderEdit } from "../../src/internal-render.mjs";

const { migrateEditToV2 } = migrate;

export function toV2Edit(value) {
  if (value?.version === 2) return structuredClone(value);
  const migrated = migrateEditToV2(value);
  if (!migrated.ok) {
    throw new Error(`retired-format edit fixture could not migrate: ${migrated.blockers.join(" / ")}`);
  }
  return migrated.doc;
}

export function createMigratingWriteFile(rawWriteFile) {
  return async function writeFile(path, data, ...options) {
    return rawWriteFile(path, migrateEditText(path, data), ...options);
  };
}

export function createMigratingWriteFileSync(rawWriteFileSync) {
  return function writeFileSync(path, data, ...options) {
    return rawWriteFileSync(path, migrateEditText(path, data), ...options);
  };
}

export function buildV2Plan(input) {
  const temporaryDirectory = input.temporaryDirectory
    ?? join(input.projectRoot, ".akari", "render-tmp");
  const projected = readRenderEdit(toV2Edit(input.edit), temporaryDirectory);
  const declaredById = new Map((input.capabilities.sourceInputs ?? []).map(source => [source.id, source]));
  const sourceInputs = projected.edit.sources.map(source => ({
    id: source.id,
    path: resolve(input.projectRoot, source.path),
    hasAudio: input.hasSourceAudio ?? true,
    ...(source.chroma_key !== undefined ? { chromaKey: source.chroma_key } : {}),
    ...(declaredById.get(source.id) ?? {}),
  }));
  return buildPlan({
    ...input,
    edit: projected.edit,
    internalEdit: projected.internal,
    temporaryDirectory,
    capabilities: { ...input.capabilities, sourceInputs },
  });
}

export function toRenderEdit(value, temporaryDirectory = "/tmp/render-cut-v2-fixture") {
  return readRenderEdit(toV2Edit(value), temporaryDirectory).edit;
}

function migrateEditText(path, data) {
  if (basename(String(path)) !== "edit.json" || (typeof data !== "string" && !Buffer.isBuffer(data))) {
    return data;
  }
  let parsed;
  try {
    parsed = JSON.parse(String(data));
  } catch {
    return data;
  }
  if (parsed?.version !== 0 && parsed?.version !== 1) return data;
  return `${JSON.stringify(toV2Edit(parsed), null, 2)}\n`;
}
