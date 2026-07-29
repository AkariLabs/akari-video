// presets — presets/telop/<id>/template.json を読む。
// index.jsonl は「AI が読む」層（契約 §1.3）で bake CLI は読まない。ここで読むのは本体のみ。
//
// presets/fx は 2026-07-22 司令塔裁定でスコープ除外（オーナー判断「FX は使えないものが
// 多いのでなしでいい」）。fx 対応は将来枠として bin/bake-layer.mjs 側で未実装エラーを返す。
//
// 置き場所は 2026-07-29 に catalog/telop → presets/telop へ移した。テロップテンプレは
// 素材ライブラリの meta.json を持たず、コードが id でファイルを引く参照表であるため
// （docs/contract-2026-07-13-asset-library.md の「presets/ — コードが id で引く参照表」）。
import { readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"

// packages/bake-layer/src/presets.mjs から見て ../../../presets がリポルート直下の presets/
const DEFAULT_PRESETS_ROOT = join(import.meta.dirname, "..", "..", "..", "presets")

export function resolvePresetsRoot(override) {
  if (override) return override
  return DEFAULT_PRESETS_ROOT
}

export async function loadTelopPreset(presetsRoot, id) {
  const dir = join(presetsRoot, "telop", id)
  const path = join(dir, "template.json")
  if (!existsSync(path)) {
    throw new Error(`[bake-layer] telop preset not found: ${id} (${path})`)
  }
  const doc = JSON.parse(await readFile(path, "utf8"))
  return { doc }
}
