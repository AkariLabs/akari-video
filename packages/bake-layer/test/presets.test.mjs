// presets.test — プリセット読み込みの軽量ユニットテスト。puppeteer/ffmpeg を使わないため速い。
// 実 bake（ヘッドレスブラウザ + ffmpeg）の検証は scripts/verify-l2.mjs（L2）で行う。
//
// fx 側のテストは 2026-07-22 司令塔裁定でスコープ除外（presets/fx を作らない）に伴い削除済み。
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { loadTelopPreset, resolvePresetsRoot } from "../src/presets.mjs"

const PRESETS_ROOT = resolvePresetsRoot()

test("telop index.jsonl entries are unique and 1:1 with preset directories", async () => {
  // 件数はオーナー選別（2026-07-22 剪定: 235 → 36）で変わるため直書きしない。
  // index とディレクトリ実体の 1:1 と id 一意性だけを不変条件として検証する。
  const raw = await readFile(join(PRESETS_ROOT, "telop", "index.jsonl"), "utf8")
  const lines = raw.trim().split("\n")
  const ids = new Set(lines.map((l) => JSON.parse(l).id))
  assert.equal(ids.size, lines.length)
  const entries = await readdir(join(PRESETS_ROOT, "telop"), { withFileTypes: true })
  const dirs = new Set(entries.filter((e) => e.isDirectory()).map((e) => e.name))
  assert.deepEqual([...ids].sort(), [...dirs].sort())
})

test("loadTelopPreset reads a known AtfDoc", async () => {
  const { doc } = await loadTelopPreset(PRESETS_ROOT, "ref3_name_rounded")
  assert.equal(doc.id, "ref3_name_rounded")
  assert.equal(doc.format, "atf")
  assert.ok(Array.isArray(doc.variables))
})
