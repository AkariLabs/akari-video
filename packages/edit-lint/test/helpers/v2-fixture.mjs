import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import migrate from "../../../edit-store/lib/migrate/index.js";

const { migrateEditToV2 } = migrate;

export async function migrateFixtureTree(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      await migrateFixtureTree(path);
      continue;
    }
    if (entry.name !== "edit.json") continue;
    const raw = JSON.parse(await readFile(path, "utf8"));
    if (raw?.version === 2) continue;
    const result = migrateEditToV2(raw);
    if (!result.ok) continue;
    await writeFile(path, `${JSON.stringify(result.doc, null, 2)}\n`, "utf8");
  }
}

export function createMigratingWriteFile(rawWriteFile) {
  return async function migratedWriteFile(path, data, ...options) {
    if (!String(path).endsWith("/edit.json") || typeof data !== "string") {
      return rawWriteFile(path, data, ...options);
    }
    const raw = JSON.parse(data);
    if (raw?.version === 2) return rawWriteFile(path, data, ...options);
    const result = migrateEditToV2(raw);
    if (!result.ok) throw new Error(result.blockers.join(" / "));
    return rawWriteFile(path, `${JSON.stringify(result.doc, null, 2)}\n`, ...options);
  };
}
