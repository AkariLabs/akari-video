// catalog — catalog/telop/<id>/template.json を読む。
// index.jsonl は「AI が読む」層（契約 §1.3）で bake CLI は読まない。ここで読むのは本体のみ。
//
// catalog/fx は 2026-07-22 司令塔裁定でスコープ除外（オーナー判断「FX は使えないものが
// 多いのでなしでいい」）。fx 対応は将来枠として bin/bake-layer.mjs 側で未実装エラーを返す。
import { readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"

// packages/bake-layer/src/catalog.mjs から見て ../../../catalog がリポルート直下の catalog/
const DEFAULT_CATALOG_ROOT = join(import.meta.dirname, "..", "..", "..", "catalog")

export function resolveCatalogRoot(override) {
  if (override) return override
  return DEFAULT_CATALOG_ROOT
}

export async function loadTelopPreset(catalogRoot, id) {
  const dir = join(catalogRoot, "telop", id)
  const path = join(dir, "template.json")
  if (!existsSync(path)) {
    throw new Error(`[bake-layer] telop preset not found: ${id} (${path})`)
  }
  const doc = JSON.parse(await readFile(path, "utf8"))
  return { doc }
}
