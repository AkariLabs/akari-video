// catalog.test — カタログ読み込みの軽量ユニットテスト。puppeteer/ffmpeg を使わないため速い。
// 実 bake（ヘッドレスブラウザ + ffmpeg）の検証は scripts/verify-l2.mjs（L2）で行う。
//
// fx 側のテストは 2026-07-22 司令塔裁定でスコープ除外（catalog/fx を作らない）に伴い削除済み。
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { loadTelopPreset, resolveCatalogRoot } from "../src/catalog.mjs"

const CATALOG_ROOT = resolveCatalogRoot()

test("telop index.jsonl has 235 entries with unique ids", async () => {
  const raw = await readFile(join(CATALOG_ROOT, "telop", "index.jsonl"), "utf8")
  const lines = raw.trim().split("\n")
  assert.equal(lines.length, 235)
  const ids = new Set(lines.map((l) => JSON.parse(l).id))
  assert.equal(ids.size, 235)
})

test("loadTelopPreset reads a known AtfDoc", async () => {
  const { doc } = await loadTelopPreset(CATALOG_ROOT, "ref3_name_rounded")
  assert.equal(doc.id, "ref3_name_rounded")
  assert.equal(doc.format, "atf")
  assert.ok(Array.isArray(doc.variables))
})
