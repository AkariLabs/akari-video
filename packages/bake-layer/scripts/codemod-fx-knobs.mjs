#!/usr/bin/env node
// 全テロップへ標準装飾 10 キーと座布団レイヤー宣言を一括追加する一回性コードモッド。
// 36 件すべてをメモリ上で変換・既定 resolve パリティ検証してから書き込む。
import { readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { build } from "esbuild"

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..")
const TELOP_ROOT = join(REPO_ROOT, "presets", "telop")
const ATF_ENTRY = join(REPO_ROOT, "packages", "bake-layer", "vendor", "telop", "atf", "index.ts")

// 全 shape を目視し、文字の座布団/帯として確定できるものだけを列挙。
// 罫線・下線・アクセント・区切り線・進捗バーは安全側で含めない。
const BACKGROUND_LAYERS = {
  ref3_bilingual_lesson: ["ref3_bilingual_lesson_band", "ref3_bilingual_lesson_band_highlight"],
  ref3_chapter_tag: ["ref3_chapter_tag_badge"],
  ref3_dual_band: ["ref3_dual_band_left_band", "ref3_dual_band_right_band"],
  ref3_linear_h_gradient: ["ref3_linear_h_gradient_band"],
  ref3_long_shadow: ["ref3_long_shadow_plate"],
  ref3_mincho_flash: ["ref3_mincho_flash_bg"],
  ref3_name_rounded: ["ref3_name_rounded_band"],
  ref3_nhk_ud: ["ref3_nhk_ud_plate"],
  ref3_ruby_caption: ["ref3_ruby_caption_plate"],
  ref3_tl_r1s0_04: ["ref3_tl_r1s0_04_paper"],
  ref3_tl_r1s3_001: ["ref3_tl_r1s3_001_band"],
  ref3_tl_r1s3_002: ["ref3_tl_r1s3_002_band", "ref3_tl_r1s3_002_badge_bg"],
  ref3_tl_r1s3_003: ["ref3_tl_r1s3_003_band"],
  ref3_tl_r1s3_004: ["ref3_tl_r1s3_004_badge_bg", "ref3_tl_r1s3_004_location_band"],
  ref3_tl_r2s0_002: ["ref3_tl_r2s0_002_badge_bg", "ref3_tl_r2s0_002_plate"],
  ref3_tl_r2s4_02: ["ref3_tl_r2s4_02_paper"],
  ref3_tl_r2s6_001: ["ref3_tl_r2s6_001_band", "ref3_tl_r2s6_001_tag_bg"],
  ref3_tl_r2s6_002: ["ref3_tl_r2s6_002_band", "ref3_tl_r2s6_002_cat_bg"],
  ref3_tl_r2s6_003: ["ref3_tl_r2s6_003_band"],
  ref3_tl_r2s8_4: ["ref3_tl_r2s8_4_bg", "ref3_tl_r2s8_4_shadow_line"],
  ref3_tl_r3s11_4: ["ref3_tl_r3s11_4_plate"],
  ref3_tl_r3s6_01: ["ref3_tl_r3s6_01_plate"],
  ref3_tl_r3s7_07: ["ref3_tl_r3s7_07_plate"],
  ref3_tl_r3s9_002: ["ref3_tl_r3s9_002_label_band", "ref3_tl_r3s9_002_main_band"],
  ref3_tl_r3s9_003: ["ref3_tl_r3s9_003_main_band"],
  ref3_tl_r3s9_004: ["ref3_tl_r3s9_004_base_band", "ref3_tl_r3s9_004_label_band"],
  ref3_wcag_minimal: ["ref3_wcag_minimal_background"],
  ref3_word_highlight: ["ref3_word_highlight_plate"],
}

const STANDARD = [
  ["bgEnabled", "bool", "座布団", "toggle"],
  ["strokeEnabled", "bool", "縁取り", "toggle"],
  ["strokeWidth", "number", "縁取り太さ", "stroke-width"],
  ["color_stroke", "color", "縁取り色", "color-stroke"],
  ["shadowEnabled", "bool", "影", "toggle"],
  ["color_shadow", "color", "影色", "color-shadow"],
  ["glowEnabled", "bool", "グロー", "toggle"],
  ["color_glow", "color", "グロー色", "color-glow"],
  ["glowStrength", "number", "グロー強度", "strength"],
  ["letterSpacing", "number", "字間", "spacing"],
]
const STANDARD_KEYS = new Set(STANDARD.map(([key]) => key))

function clone(value) {
  return structuredClone(value)
}

function cleanNumber(value) {
  return typeof value === "number" ? Math.round(value * 1e9) / 1e9 : value
}

function variableMap(doc) {
  return new Map(doc.variables.map((variable) => [variable.key, variable]))
}

function valueAtDefaults(doc, value, fallback = 0) {
  if (typeof value === "number") return value
  if (typeof value === "boolean") return value ? 1 : 0
  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  if (value && typeof value === "object" && typeof value.var === "string") {
    return valueAtDefaults(doc, variableMap(doc).get(value.var)?.default, fallback)
  }
  return fallback
}

function stringAtDefaults(doc, value, fallback) {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (value && typeof value === "object" && typeof value.var === "string") {
    const resolved = variableMap(doc).get(value.var)?.default
    return resolved === undefined ? fallback : String(resolved)
  }
  return fallback
}

function textSize(doc, layer) {
  return valueAtDefaults(doc, layer.content.size, 0)
}

function textStrokes(layer) {
  return [...(layer.content.stroke ? [layer.content.stroke] : []), ...(layer.content.strokes ?? [])]
}

function textShadows(layer) {
  return [...(layer.content.shadow ? [layer.content.shadow] : []), ...(layer.content.shadows ?? [])]
}

function isGlowShadow(doc, layer, shadow) {
  const colorKey = shadow.color && typeof shadow.color === "object" ? shadow.color.var : undefined
  if (colorKey && /glow/i.test(colorKey)) return true
  if (/glow/i.test(layer.id)) return true
  const hasGlowLayer = doc.layers.some((candidate) => /glow/i.test(candidate.id))
  return hasGlowLayer
    && valueAtDefaults(doc, shadow.x) === 0
    && valueAtDefaults(doc, shadow.y) === 0
    && valueAtDefaults(doc, shadow.blur) > 0
}

function primaryEffect(doc, collect) {
  return doc.layers
    .filter((layer) => layer.type === "text")
    .map((layer) => ({ layer, values: collect(layer) }))
    .filter(({ values }) => values.length > 0)
    .sort((a, b) => textSize(doc, b.layer) - textSize(doc, a.layer))[0]
}

function primaryText(doc) {
  return doc.layers
    .filter((layer) => layer.type === "text")
    .sort((a, b) => textSize(doc, b) - textSize(doc, a))[0]
}

function inferredDefaults(doc) {
  const existing = variableMap(doc)
  const mainText = primaryText(doc)
  const stroke = primaryEffect(doc, textStrokes)
  const shadow = primaryEffect(doc, (layer) => textShadows(layer).filter((value) => !isGlowShadow(doc, layer, value)))
  const glow = primaryEffect(doc, (layer) => textShadows(layer).filter((value) => isGlowShadow(doc, layer, value)))
  const mainSize = mainText ? textSize(doc, mainText) : 48
  const mainSpacing = mainText?.content.letterSpacing === undefined
    ? 0
    : valueAtDefaults(doc, mainText.content.letterSpacing, 0)
  const mainColor = mainText ? stringAtDefaults(doc, mainText.content.color, "#ffffff") : "#ffffff"
  const strokeValue = stroke?.values[0]
  const shadowValue = shadow?.values[0]
  const glowValue = glow?.values[0]
  const prior = (key, fallback) => existing.has(key) ? existing.get(key).default : fallback
  return {
    bgEnabled: (BACKGROUND_LAYERS[doc.id]?.length ?? 0) > 0,
    strokeEnabled: !!stroke,
    strokeWidth: prior("strokeWidth", strokeValue ? valueAtDefaults(doc, strokeValue.width, mainSize * 0.07) : mainSize * 0.07),
    color_stroke: prior("color_stroke", strokeValue ? stringAtDefaults(doc, strokeValue.color, "#000000") : "#000000"),
    shadowEnabled: !!shadow || doc.layers.some((layer) => layer.type === "text" && (layer.content.innerShadows?.length ?? 0) > 0),
    color_shadow: prior("color_shadow", shadowValue ? stringAtDefaults(doc, shadowValue.color, "rgba(0,0,0,0.55)") : "rgba(0,0,0,0.55)"),
    glowEnabled: !!glow || doc.layers.some((layer) => layer.type === "text" && !!layer.content.innerGlow),
    color_glow: prior("color_glow", glowValue ? stringAtDefaults(doc, glowValue.color, mainColor) : mainColor),
    glowStrength: prior("glowStrength", 1),
    letterSpacing: prior("letterSpacing", mainSpacing),
  }
}

function migrate(doc) {
  const defaults = inferredDefaults(doc)
  const existing = variableMap(doc)

  // 要素別の副系は元 group に残すが、追加された意味語彙 color-glow は副系にも正しく付ける。
  for (const variable of doc.variables) {
    if (/^color_glow(?:_\d+)?$/.test(variable.key)) variable.role = "color-glow"
  }

  // 既存の {var:letterSpacing} をその既定リテラルへ戻し、エンジンの共通差分適用へ一本化する。
  for (const layer of doc.layers.filter((candidate) => candidate.type === "text")) {
    const spacing = layer.content.letterSpacing
    if (spacing && typeof spacing === "object" && spacing.var === "letterSpacing") {
      layer.content.letterSpacing = Number(defaults.letterSpacing)
    } else if (spacing && typeof spacing === "object" && JSON.stringify(spacing).includes("letterSpacing")) {
      throw new Error(`${doc.id}/${layer.id}: letterSpacing 式は自動移行できません`)
    }
  }

  const fxVariables = STANDARD.map(([key, type, label, role]) => {
    const variable = existing.get(key) ? clone(existing.get(key)) : { key }
    return {
      ...variable,
      key,
      type,
      label,
      default: cleanNumber(defaults[key]),
      group: "fx",
      role,
    }
  })
  const remainder = doc.variables.filter((variable) => !STANDARD_KEYS.has(variable.key))
  const animationIndex = remainder.findIndex((variable) => variable.group === "anim")
  remainder.splice(animationIndex < 0 ? remainder.length : animationIndex, 0, ...fxVariables)
  doc.variables = remainder

  doc.groups = (doc.groups ?? []).filter((group) => group.id !== "fx")
  const animGroupIndex = doc.groups.findIndex((group) => group.id === "anim")
  doc.groups.splice(animGroupIndex < 0 ? doc.groups.length : animGroupIndex, 0, { id: "fx", label: "装飾" })

  const tagged = new Set(BACKGROUND_LAYERS[doc.id] ?? [])
  for (const layer of doc.layers) {
    if (tagged.has(layer.id)) {
      if (layer.type !== "shape") throw new Error(`${doc.id}/${layer.id}: bg 対象が shape ではありません`)
      layer.fxTag = "bg"
      tagged.delete(layer.id)
    } else if (layer.fxTag === "bg") {
      delete layer.fxTag
    }
  }
  if (tagged.size > 0) throw new Error(`${doc.id}: bg 対象レイヤーが見つかりません: ${[...tagged].join(", ")}`)
  return doc
}

const entries = (await readdir(TELOP_ROOT, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .sort((a, b) => a.name.localeCompare(b.name))
const originals = []
for (const entry of entries) {
  const path = join(TELOP_ROOT, entry.name, "template.json")
  try {
    originals.push({ path, doc: JSON.parse(await readFile(path, "utf8")) })
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
  }
}
if (originals.length !== 36) throw new Error(`テンプレート件数 ${originals.length}（期待 36）`)
if (Object.keys(BACKGROUND_LAYERS).length !== 28) throw new Error("bg 対応表は目視確定 28 テンプレ必須です")

const result = await build({
  entryPoints: [ATF_ENTRY],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  target: "node20",
  logLevel: "silent",
})
const source = Buffer.from(result.outputFiles[0].contents).toString("base64")
const atf = await import(`data:text/javascript;base64,${source}`)
const measure = (text, _font, size) => ({ width: [...text].length * size * 0.6, height: size * 1.2 })
const outputs = []
for (const { path, doc: sourceDoc } of originals) {
  const expected = atf.resolve(sourceDoc, {}, undefined, measure)
  const migrated = migrate(clone(sourceDoc))
  const actual = atf.resolve(migrated, {}, undefined, measure)
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${sourceDoc.id}: 既定 resolve パリティ失敗`)
  }
  outputs.push({ path, doc: migrated })
  console.log(`[codemod-fx-knobs] verified ${sourceDoc.id}`)
}

for (const { path, doc } of outputs) {
  await writeFile(path, `${JSON.stringify(doc, null, 2)}\n`)
}
console.log(`[codemod-fx-knobs] PASS ${outputs.length}/36（既定 resolve parity・bg 28/28）`)
