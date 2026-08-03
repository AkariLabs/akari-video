#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..")
const TELOP_ROOT = join(REPO_ROOT, "presets", "telop")
const TEXTANIM_INDEX = join(REPO_ROOT, "presets", "textanim", "index.jsonl")
const ROLES = new Set([
  "text", "size", "weight", "font", "color", "color-bg", "color-stroke", "color-shadow",
  "color-accent", "pos-x", "pos-y", "pad", "radius", "progress", "interval", "strength", "other",
  "anim-in", "anim-out", "anim-loop", "anim-duration",
])
const ANCHORS = new Set(["tl", "tc", "tr", "ml", "mc", "mr", "bl", "bc", "br"])
const STANDARD = new Map([
  ["fontFamily", "font"],
  ["fontWeight", "number"],
  ["posX", "number"],
  ["posY", "number"],
  ["animIn", "select"],
  ["animOut", "select"],
  ["animLoop", "select"],
  ["animInSec", "number"],
  ["animOutSec", "number"],
])
const textanimCatalog = (await readFile(TEXTANIM_INDEX, "utf8"))
  .trim().split("\n").map((line) => JSON.parse(line))
const IN_OPTIONS = ["original", "none", ...textanimCatalog.filter((entry) => entry.slot === "in").map((entry) => entry.id)]
const LOOP_OPTIONS = ["original", "none", ...textanimCatalog.filter((entry) => entry.slot === "loop").map((entry) => entry.id)]
const ANIMATION_STANDARD = new Map([
  ["animIn", { default: "original", role: "anim-in", options: IN_OPTIONS }],
  ["animOut", { default: "original", role: "anim-out", options: IN_OPTIONS }],
  ["animLoop", { default: "original", role: "anim-loop", options: LOOP_OPTIONS }],
  ["animInSec", { default: 0.6, role: "anim-duration" }],
  ["animOutSec", { default: 0.6, role: "anim-duration" }],
])

const errors = []
let checked = 0
const entries = await readdir(TELOP_ROOT, { withFileTypes: true })
for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
  const path = join(TELOP_ROOT, entry.name, "template.json")
  let doc
  try {
    doc = JSON.parse(await readFile(path, "utf8"))
  } catch (error) {
    if (error?.code === "ENOENT") continue
    errors.push(`${entry.name}: template.json を読めません (${error.message})`)
    continue
  }
  checked += 1
  const variables = doc.variables ?? []
  const groups = doc.groups ?? []
  const groupIds = new Set(groups.map((group) => group.id))

  for (const [key, type] of STANDARD) {
    const variable = variables.find((candidate) => candidate.key === key)
    if (!variable) errors.push(`${doc.id}: 必須キー ${key} がありません`)
    else if (variable.type !== type) errors.push(`${doc.id}/${key}: type=${variable.type}（期待 ${type}）`)
  }
  for (const [key, expected] of ANIMATION_STANDARD) {
    const variable = variables.find((candidate) => candidate.key === key)
    if (!variable) continue
    if (variable.group !== "anim") errors.push(`${doc.id}/${key}: group=${variable.group}（期待 anim）`)
    if (variable.role !== expected.role) errors.push(`${doc.id}/${key}: role=${variable.role}（期待 ${expected.role}）`)
    if (variable.default !== expected.default) errors.push(`${doc.id}/${key}: default=${variable.default}（期待 ${expected.default}）`)
    if (expected.options && JSON.stringify(variable.options) !== JSON.stringify(expected.options)) {
      errors.push(`${doc.id}/${key}: options が textanim 語彙と一致しません`)
    }
  }
  if (!Array.isArray(doc.groups)) errors.push(`${doc.id}: groups がありません`)
  if (!groupIds.has("global")) errors.push(`${doc.id}: groups に global がありません`)
  if (!groupIds.has("anim")) errors.push(`${doc.id}: groups に anim がありません`)
  if (groups.find((group) => group.id === "anim")?.label !== "アニメ") {
    errors.push(`${doc.id}: group anim の label は「アニメ」必須です`)
  }
  for (const group of groups) {
    if (!/^[a-z]+$/.test(group.id)) errors.push(`${doc.id}/groups/${group.id}: id は latin 小文字のみです`)
  }

  for (const variable of variables) {
    if (!variable.group) errors.push(`${doc.id}/${variable.key}: group がありません`)
    else if (!groupIds.has(variable.group)) errors.push(`${doc.id}/${variable.key}: 未宣言 group=${variable.group}`)
    if (!variable.role) errors.push(`${doc.id}/${variable.key}: role がありません`)
    else if (!ROLES.has(variable.role)) errors.push(`${doc.id}/${variable.key}: 未知 role=${variable.role}`)
    if (variable.type === "text" && variable.role !== "text") {
      errors.push(`${doc.id}/${variable.key}: type=text は role=text 必須です`)
    }
    if (variable.type === "select" && (!Array.isArray(variable.options) || variable.options.length === 0)) {
      errors.push(`${doc.id}/${variable.key}: type=select は options 必須です`)
    }
  }
  const textGroups = new Set(variables.filter((variable) => variable.role === "text").map((variable) => variable.group))
  for (const group of textGroups) {
    if (!variables.some((variable) => variable.group === group && variable.role === "size")) {
      errors.push(`${doc.id}/${group}: text グループに role=size がありません`)
    }
  }
  if (!ANCHORS.has(doc.anchor)) errors.push(`${doc.id}: anchor=${JSON.stringify(doc.anchor)} は 9 点語彙外です`)
}

if (checked !== 36) errors.push(`テンプレート件数が ${checked} 件です（期待 36）`)
if (errors.length > 0) {
  for (const error of errors) console.error(`[lint-standard-knobs] ${error}`)
  console.error(`[lint-standard-knobs] FAIL ${errors.length} 件`)
  process.exitCode = 1
} else {
  console.log(`[lint-standard-knobs] PASS ${checked}/36`)
}
