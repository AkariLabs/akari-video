#!/usr/bin/env node
// 全 telop template.json へ標準アニメ 5 キーと anim group を決定論的に追加する。
import { readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..")
const TELOP_ROOT = join(REPO_ROOT, "presets", "telop")
const TEXTANIM_INDEX = join(REPO_ROOT, "presets", "textanim", "index.jsonl")

const catalog = (await readFile(TEXTANIM_INDEX, "utf8"))
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line))
const inOptions = ["original", "none", ...catalog.filter((entry) => entry.slot === "in").map((entry) => entry.id)]
const loopOptions = ["original", "none", ...catalog.filter((entry) => entry.slot === "loop").map((entry) => entry.id)]
const animationVariables = [
  { key: "animIn", type: "select", label: "入りアニメ", default: "original", options: inOptions, group: "anim", role: "anim-in" },
  { key: "animOut", type: "select", label: "抜けアニメ", default: "original", options: inOptions, group: "anim", role: "anim-out" },
  { key: "animLoop", type: "select", label: "ループアニメ", default: "original", options: loopOptions, group: "anim", role: "anim-loop" },
  { key: "animInSec", type: "number", label: "入り時間（秒）", default: 0.6, group: "anim", role: "anim-duration" },
  { key: "animOutSec", type: "number", label: "抜け時間（秒）", default: 0.6, group: "anim", role: "anim-duration" },
]
const animationKeys = new Set(animationVariables.map((variable) => variable.key))

let changed = 0
const entries = await readdir(TELOP_ROOT, { withFileTypes: true })
for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
  const templatePath = join(TELOP_ROOT, entry.name, "template.json")
  let source
  try {
    source = await readFile(templatePath, "utf8")
  } catch (error) {
    if (error?.code === "ENOENT") continue
    throw error
  }
  const doc = JSON.parse(source)
  doc.groups = [...(doc.groups ?? []).filter((group) => group.id !== "anim"), { id: "anim", label: "アニメ" }]
  doc.variables = [
    ...(doc.variables ?? []).filter((variable) => !animationKeys.has(variable.key)),
    ...structuredClone(animationVariables),
  ]
  const next = `${JSON.stringify(doc, null, 2)}\n`
  if (next === source) continue
  await writeFile(templatePath, next)
  changed += 1
}

console.log(`[codemod-animation-knobs] ${changed} 件を更新`)
