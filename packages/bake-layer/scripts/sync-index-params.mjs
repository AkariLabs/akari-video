#!/usr/bin/env node
// sync-index-params — presets/telop/index.jsonl の params を各 template.json の variables から
// 再生成する。ツマミ（variables）を追加・変更したときに索引がずれないようにする同期ツール。
//
//   node packages/bake-layer/scripts/sync-index-params.mjs [--check]
//
// - 既存フィールド（name / tags / use_when / source 等）は一切触らない
// - 行の並び順・既存 JSON キー順も維持する（params 差し替え + groups / anchor 追記）
// - --check: 書き込まず、差分があれば exit 1（CI 向け drift 検出）
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..")
const PRESETS_TELOP = join(REPO_ROOT, "presets", "telop")
const INDEX_PATH = join(PRESETS_TELOP, "index.jsonl")

// index.jsonl の params に載せるフィールド（Variable のうち UI に要るものだけ）
const PARAM_FIELDS = ["key", "type", "label", "default", "options", "optional", "group", "role"]

function paramsFromVariables(variables) {
  return (variables ?? []).map((variable) => {
    const param = {}
    for (const field of PARAM_FIELDS) {
      if (variable[field] !== undefined) param[field] = variable[field]
    }
    return param
  })
}

const checkOnly = process.argv.includes("--check")

const raw = await readFile(INDEX_PATH, "utf8")
const lines = raw.split("\n").filter((line) => line.trim())

let changed = 0
const outLines = []
for (const line of lines) {
  const entry = JSON.parse(line)
  const templatePath = join(PRESETS_TELOP, entry.id, "template.json")
  const doc = JSON.parse(await readFile(templatePath, "utf8"))
  const nextParams = paramsFromVariables(doc.variables)
  const nextGroups = doc.groups
  const nextAnchor = doc.anchor
  if (
    JSON.stringify(entry.params) !== JSON.stringify(nextParams) ||
    JSON.stringify(entry.groups) !== JSON.stringify(nextGroups) ||
    entry.anchor !== nextAnchor
  ) {
    changed += 1
    if (checkOnly) console.error(`drift: ${entry.id}`)
  }
  entry.params = nextParams
  entry.groups = nextGroups
  entry.anchor = nextAnchor
  outLines.push(JSON.stringify(entry))
}

if (checkOnly) {
  if (changed > 0) {
    console.error(`[sync-index-params] drift ${changed} 件。node packages/bake-layer/scripts/sync-index-params.mjs で再生成してください`)
    process.exit(1)
  }
  console.log("[sync-index-params] drift なし")
} else {
  await writeFile(INDEX_PATH, outLines.join("\n") + "\n")
  console.log(`[sync-index-params] ${lines.length} エントリ中 ${changed} 件の params/groups/anchor を更新`)
}
