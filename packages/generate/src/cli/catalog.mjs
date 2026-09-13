import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_CATALOG = fileURLToPath(new URL("../../../schemas/gen-models.json", import.meta.url));

export async function loadCatalog(repoRoot) {
  const catalogPath = repoRoot
    ? path.join(path.resolve(repoRoot), "packages", "schemas", "gen-models.json")
    : DEFAULT_CATALOG;
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  if (!catalog || catalog.version !== 1 || !Array.isArray(catalog.models)) {
    throw new Error("gen-models.json の形式が不正です");
  }
  return catalog;
}

export function findModel(catalog, id) {
  return catalog?.models?.find((model) => model.id === id) ?? null;
}
