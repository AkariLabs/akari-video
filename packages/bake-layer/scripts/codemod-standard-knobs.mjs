#!/usr/bin/env node
// 全テロップを「group × role + 中央基準 9 点アンカー」契約へ一括移行する一回性コードモッド。
// 途中失敗で template.json を半端に更新しないよう、36 件すべてを実測・検証してから書き込む。
import { readdir, readFile, writeFile } from "node:fs/promises"
import { readdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join } from "node:path"
import { build } from "esbuild"
import { launchBakeBrowser } from "../src/browser.mjs"
import { buildTelopHarness } from "../src/build-harness.mjs"
import { registerBundledFonts } from "../src/fonts.mjs"

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..")
const TELOP_ROOT = join(REPO_ROOT, "presets", "telop")
const ATF_ENTRY = join(REPO_ROOT, "packages", "bake-layer", "vendor", "telop", "atf", "index.ts")
const POSITION_TOKEN = /\b(?:posX|posY|xOffset)\b/
const VARIABLE_TOKEN = /\b[A-Za-z_][A-Za-z0-9_]*\b/g
const FONT_ROOT = join(REPO_ROOT, "assets", "font")

const ANCHORS = {
  ref3_bilingual_lesson: "bc",
  ref3_chapter_tag: "tl",
  ref3_corner_title_line: "tl",
  ref3_dual_band: "tl",
  ref3_edu_speaker: "bc",
  ref3_hollow_neon: "mc",
  ref3_hormozi_snap: "mc",
  ref3_karaoke_flash: "mc",
  ref3_kid_karaoke: "bc",
  ref3_linear_h_gradient: "bl",
  ref3_long_shadow: "mc",
  ref3_mincho_flash: "mc",
  ref3_name_rounded: "bl",
  ref3_nhk_ud: "bc",
  ref3_particle_min: "bc",
  ref3_ruby_caption: "bc",
  ref3_tl_r1s0_04: "bc",
  ref3_tl_r1s3_001: "bl",
  ref3_tl_r1s3_002: "tl",
  ref3_tl_r1s3_003: "bl",
  ref3_tl_r1s3_004: "bl",
  ref3_tl_r2s0_002: "tl",
  ref3_tl_r2s4_02: "bl",
  ref3_tl_r2s6_001: "bl",
  ref3_tl_r2s6_002: "bl",
  ref3_tl_r2s6_003: "bl",
  ref3_tl_r2s8_4: "tl",
  ref3_tl_r3s11_4: "bl",
  ref3_tl_r3s6_01: "bl",
  ref3_tl_r3s7_07: "bc",
  ref3_tl_r3s9_002: "bl",
  ref3_tl_r3s9_003: "bl",
  ref3_tl_r3s9_004: "bl",
  ref3_wcag_minimal: "bc",
  ref3_webvtt_shadow: "bc",
  ref3_word_highlight: "mc",
}

const ANCHOR_FRACS = {
  tl: [0, 0], tc: [0.5, 0], tr: [1, 0],
  ml: [0, 0.5], mc: [0.5, 0.5], mr: [1, 0.5],
  bl: [0, 1], bc: [0.5, 1], br: [1, 1],
}

const GROUP_LABELS = {
  main: "本文",
  name: "名前",
  sub: "補足",
  badge: "ラベル・バッジ",
  ruby: "ルビ・ふりがな",
  accent: "強調",
  band: "帯・背景",
  line: "線・装飾",
  global: "全体",
}

function clone(value) {
  return structuredClone(value)
}

const harfbuzzCache = new Map()
function fallbackFontFile(font, weight, text) {
  if (font.includes("Noto Sans JP")) return join(FONT_ROOT, "noto-sans-jp", "NotoSansJP-Variable.ttf")
  if (font.includes("Noto Serif JP")) return join(FONT_ROOT, "noto-serif-jp", "NotoSerifJP-Variable.ttf")
  if (font.includes("M PLUS Rounded") || font.includes("Rounded Mplus")) {
    if ((weight ?? 500) >= 850) return join(FONT_ROOT, "mplus-rounded-1c", "MPLUSRounded1c-Black.ttf")
    if ((weight ?? 500) >= 650) return join(FONT_ROOT, "mplus-rounded-1c", "MPLUSRounded1c-ExtraBold.ttf")
    return join(FONT_ROOT, "mplus-rounded-1c", "MPLUSRounded1c-Medium.ttf")
  }
  if (!/[\u3000-\u30ff\u3400-\u9fff\uf900-\ufaff]/u.test(text) && font.includes("Helvetica Neue")) {
    return "/System/Library/Fonts/HelveticaNeue.ttc"
  }
  const targetWeight = Math.max(0, Math.min(9, Math.round((weight ?? 400) / 100)))
  const family = `ヒラギノ角ゴシック W${targetWeight}`
  const systemName = readdirSync("/System/Library/Fonts").find((name) => name.normalize("NFC").includes(family))
  return systemName ? join("/System/Library/Fonts", systemName) : "/System/Library/Fonts/Hiragino Sans GB.ttc"
}

function harfbuzzMeasure(text, font, size, weight) {
  const fontFile = fallbackFontFile(font, weight, text)
  const cacheKey = JSON.stringify([text, fontFile, size, weight])
  if (harfbuzzCache.has(cacheKey)) return harfbuzzCache.get(cacheKey)
  try {
    const args = [fontFile, text, `--font-size=${size}`, "--output-format=json"]
    if (fontFile.includes("Variable")) args.push(`--variations=wght=${weight ?? 400}`)
    const glyphs = JSON.parse(execFileSync("hb-shape", args, { encoding: "utf8" }))
    const measured = { width: glyphs.reduce((sum, glyph) => sum + Number(glyph.ax ?? 0), 0), height: size * 1.2 }
    harfbuzzCache.set(cacheKey, measured)
    return measured
  } catch {
    return { width: text.length * size * 0.6, height: size * 1.2 }
  }
}

function numericDefault(variable, fallback = 0) {
  if (!variable) return fallback
  const value = typeof variable.default === "number" ? variable.default : parseFloat(String(variable.default))
  return Number.isFinite(value) ? value : fallback
}

function insertBeforeStandardVariables(doc, additions) {
  if (additions.length === 0) return
  const standardIndex = doc.variables.findIndex((v) => ["fontFamily", "fontWeight", "posX", "posY"].includes(v.key))
  doc.variables.splice(standardIndex < 0 ? doc.variables.length : standardIndex, 0, ...additions)
}

function ensurePositionVariables(doc) {
  const xOffset = doc.variables.find((v) => v.key === "xOffset")
  if (!doc.variables.some((v) => v.key === "posX")) {
    const posX = xOffset
      ? { ...clone(xOffset), key: "posX", label: "X位置（中央基準）" }
      : { key: "posX", type: "number", label: "X位置（中央基準）", default: 0 }
    doc.variables.push(posX)
  }
  if (!doc.variables.some((v) => v.key === "posY")) {
    doc.variables.push({ key: "posY", type: "number", label: "Y位置（中央基準）", default: 0 })
  }

  const defaults = Object.fromEntries(
    ["posX", "posY", "xOffset"].map((key) => [key, numericDefault(doc.variables.find((v) => v.key === key), 0)]),
  )

  const replacePositionValues = (value) => {
    if (Array.isArray(value)) return value.map(replacePositionValues)
    if (!value || typeof value !== "object") return value
    if (Object.keys(value).length === 1 && typeof value.var === "string" && value.var in defaults) {
      return defaults[value.var]
    }
    if (typeof value.expr === "string") {
      value.expr = value.expr.replace(/\b(?:posX|posY|xOffset)\b/g, (token) => String(defaults[token]))
    }
    for (const [key, child] of Object.entries(value)) value[key] = replacePositionValues(child)
    return value
  }
  doc.layers = replacePositionValues(doc.layers)
  doc.variables = doc.variables.filter((v) => v.key !== "xOffset")

  const serializedLayers = JSON.stringify(doc.layers)
  if (POSITION_TOKEN.test(serializedLayers)) {
    throw new Error(`${doc.id}: layers[] に位置変数トークンが残っています`)
  }
}

function textGroup(variable) {
  const key = variable.key
  const label = variable.label ?? ""
  if (/emphasis/i.test(key) || /強調/.test(label)) return "accent"
  if (/ruby|furigana/i.test(key) || /ルビ|ふりがな/.test(label)) return "ruby"
  if (/badge|tag|category|labelText|topicLabel|liveLabel|chapterLabel/i.test(key) || /バッジ|タグ|カテゴリ|ラベル/.test(label)) return "badge"
  if (/japanese|subText|affiliation|roleText|text2/i.test(key) || /肩書|所属|補足|日本語訳|2行目/.test(label)) return "sub"
  if (key === "name" || /名前|氏名|出演者/.test(label)) return "name"
  if (key === "title" && /肩書/.test(label)) return "sub"
  return "main"
}

function referencedTextVariable(layer) {
  const text = layer.type === "text" ? layer.content?.text : undefined
  return text && typeof text === "object" && typeof text.var === "string" ? text.var : null
}

function uniqueKey(doc, preferred) {
  const keys = new Set(doc.variables.map((v) => v.key))
  if (!keys.has(preferred)) return preferred
  let suffix = 2
  while (keys.has(`${preferred}${suffix}`)) suffix += 1
  return `${preferred}${suffix}`
}

function addMissingTextSizeVariables(doc) {
  const variablesByKey = new Map(doc.variables.map((v) => [v.key, v]))
  const additions = []
  for (const textVariable of doc.variables.filter((v) => v.type === "text")) {
    const layers = doc.layers.filter((layer) => referencedTextVariable(layer) === textVariable.key)
    if (layers.length === 0) continue
    const hasDeclaredSize = layers.some((layer) => {
      const value = layer.content.size
      if (value && typeof value === "object" && typeof value.var === "string") return variablesByKey.has(value.var)
      if (value && typeof value === "object" && typeof value.expr === "string") {
        return Array.from(value.expr.matchAll(VARIABLE_TOKEN), (match) => match[0]).some((key) => {
          const variable = variablesByKey.get(key)
          return variable?.type === "number" && /size|文字サイズ/i.test(`${variable.key} ${variable.label}`)
        })
      }
      return false
    })
    if (hasDeclaredSize) continue

    const literalLayers = layers.filter((layer) => typeof layer.content.size === "number")
    if (literalLayers.length === 0) {
      throw new Error(`${doc.id}/${textVariable.key}: text グループへ割り当てられる文字サイズ変数がありません`)
    }
    const distinctSizes = [...new Set(literalLayers.map((layer) => layer.content.size))]
    for (const [index, defaultSize] of distinctSizes.entries()) {
      const base = textVariable.key === "text" || textVariable.key === "caption" || textVariable.key === "captionText"
        ? "fontSize"
        : `${textVariable.key}FontSize`
      const key = uniqueKey({ variables: [...doc.variables, ...additions] }, distinctSizes.length === 1 ? base : `${base}${index + 1}`)
      const variable = {
        key,
        type: "number",
        label: `${textVariable.label}文字サイズ`,
        default: defaultSize,
      }
      additions.push(variable)
      variablesByKey.set(key, variable)
      for (const layer of literalLayers) {
        if (layer.content.size === defaultSize) layer.content.size = { var: key }
      }
    }
  }
  insertBeforeStandardVariables(doc, additions)
}

function shapeGroup(layerId) {
  if (/badge|tag|label|category|topic/i.test(layerId)) return "badge"
  if (/line|underline|divider|bar|accent|rule/i.test(layerId)) return "line"
  return "band"
}

function collectVariableReferences(value, out = new Set()) {
  if (Array.isArray(value)) {
    for (const child of value) collectVariableReferences(child, out)
    return out
  }
  if (!value || typeof value !== "object") return out
  if (typeof value.var === "string") out.add(value.var)
  if (typeof value.expr === "string") {
    for (const match of value.expr.matchAll(VARIABLE_TOKEN)) out.add(match[0])
  }
  for (const child of Object.values(value)) collectVariableReferences(child, out)
  return out
}

function colorRole(variable) {
  const text = `${variable.key} ${variable.label}`
  if (/stroke|縁|フチ/i.test(text)) return "color-stroke"
  if (/shadow|glow|影|グロー|にじみ/i.test(text)) return "color-shadow"
  if (/accent|primary|強調|アクセント|キーカラー|ライン|下線|罫線|バー色/i.test(text)) return "color-accent"
  if (/color_bg|背景|帯(?:色|グラデ)|プレート|座布団|紙色|バッジ背景/i.test(text)) return "color-bg"
  return "color"
}

function numberRole(variable, sizeGroups) {
  if (sizeGroups.has(variable.key)) return "size"
  if (variable.key === "fontWeight") return "weight"
  if (variable.key === "posX") return "pos-x"
  if (variable.key === "posY") return "pos-y"
  const text = `${variable.key} ${variable.label}`
  if (/pad|余白/i.test(text)) return "pad"
  if (/radius|角丸/i.test(text)) return "radius"
  if (/progress|進行度/i.test(text)) return "progress"
  if (/stagger|interval|間隔|速度|秒\/文字/i.test(text)) return "interval"
  if (/strength|opacity|strokeWeight|強度|不透明度|太さ/i.test(text)) return "strength"
  if (/fontSize|textSize|文字サイズ/i.test(text)) return "size"
  return "other"
}

function inferredGroup(variable, role, referenceGroups) {
  if (referenceGroups.size === 1) return [...referenceGroups][0]
  if (role === "color-bg") return "band"
  if (role === "color-accent") return "line"
  if (/badge|(?:^|_)tag|tagText|label|category|バッジ|タグ|ラベル|カテゴリ/i.test(`${variable.key} ${variable.label}`)) return "badge"
  if (/band|bar|height|帯|背景|プレート|紙/i.test(`${variable.key} ${variable.label}`)) return "band"
  return "global"
}

function assignGroupsAndRoles(doc) {
  const textVariables = doc.variables.filter((v) => v.type === "text")
  const textGroups = new Map(textVariables.map((v) => [v.key, textGroup(v)]))
  const layerGroups = new Map()
  for (const layer of doc.layers) {
    const textKey = referencedTextVariable(layer)
    layerGroups.set(layer.id, textKey ? textGroups.get(textKey) ?? "main" : shapeGroup(layer.id))
  }

  const references = new Map(doc.variables.map((v) => [v.key, new Set()]))
  const sizeGroups = new Map()
  for (const layer of doc.layers) {
    const group = layerGroups.get(layer.id)
    for (const key of collectVariableReferences(layer)) references.get(key)?.add(group)
    if (layer.type === "text") {
      const size = layer.content.size
      if (size && typeof size === "object" && typeof size.var === "string") sizeGroups.set(size.var, group)
      if (size && typeof size === "object" && typeof size.expr === "string") {
        for (const match of size.expr.matchAll(VARIABLE_TOKEN)) {
          const variable = doc.variables.find((v) => v.key === match[0])
          if (variable?.type === "number" && /size|文字サイズ/i.test(`${variable.key} ${variable.label}`)) {
            sizeGroups.set(variable.key, group)
          }
        }
      }
    }
  }

  const usedGroups = new Set()
  for (const variable of doc.variables) {
    let role
    let group
    if (variable.key === "fontFamily") {
      role = "font"
      group = "global"
    } else if (variable.key === "fontWeight") {
      role = "weight"
      group = "global"
    } else if (variable.key === "posX") {
      role = "pos-x"
      group = "global"
      variable.label = "X位置（中央基準）"
    } else if (variable.key === "posY") {
      role = "pos-y"
      group = "global"
      variable.label = "Y位置（中央基準）"
    } else if (variable.type === "text") {
      role = "text"
      group = textGroups.get(variable.key) ?? "main"
    } else if (variable.type === "color") {
      role = colorRole(variable)
      group = inferredGroup(variable, role, references.get(variable.key) ?? new Set())
    } else if (variable.type === "number") {
      role = numberRole(variable, sizeGroups)
      group = sizeGroups.get(variable.key) ?? inferredGroup(variable, role, references.get(variable.key) ?? new Set())
    } else {
      role = "other"
      group = inferredGroup(variable, role, references.get(variable.key) ?? new Set())
    }
    variable.group = group
    variable.role = role
    usedGroups.add(group)
  }
  usedGroups.add("global")

  const preferredOrder = ["main", "name", "sub", "badge", "ruby", "accent", "band", "line", "global"]
  doc.groups = preferredOrder
    .filter((id) => usedGroups.has(id))
    .map((id) => ({ id, label: GROUP_LABELS[id] }))

  for (const group of new Set(textVariables.map((v) => v.group))) {
    if (!doc.variables.some((v) => v.group === group && v.role === "size")) {
      throw new Error(`${doc.id}/${group}: role=text のグループに role=size がありません`)
    }
  }
}

function bbox(layers) {
  if (layers.length === 0) return null
  const boxes = layers.filter((layer) => layer.size.w > 0 && layer.size.h > 0).map((layer) => {
    const left = layer.transform.x - layer.transform.anchor.x * layer.size.w
    const top = layer.transform.y - layer.transform.anchor.y * layer.size.h
    return { left, top, right: left + layer.size.w, bottom: top + layer.size.h }
  }).filter((box) => Object.values(box).every(Number.isFinite))
  if (boxes.length === 0) return null
  return {
    left: Math.min(...boxes.map((box) => box.left)),
    top: Math.min(...boxes.map((box) => box.top)),
    right: Math.max(...boxes.map((box) => box.right)),
    bottom: Math.max(...boxes.map((box) => box.bottom)),
  }
}

async function resolveInPage(page, doc, bindings = {}) {
  return page.evaluate((docArg, bindingsArg) => {
    return window.__standardKnobsAtf.resolve(docArg, bindingsArg, undefined, window.__standardKnobsAtf.canvasMeasure)
  }, doc, bindings)
}

async function renderInPage(page, doc) {
  await page.evaluate(() => { document.body.innerHTML = "" })
  await page.evaluate((docArg) => {
    window.__standardKnobsHandle = window.__bakeTelop.init(docArg, {}, undefined)
  }, doc)
  return page.evaluate((w, h, t, T) => {
    return window.__standardKnobsHandle.renderFrame(w, h, t, T)
  }, doc.stage.width, doc.stage.height, doc.stage.duration * 0.5, doc.stage.duration)
}

const ids = (await readdir(TELOP_ROOT)).filter((id) => ANCHORS[id]).sort()
if (ids.length !== 36 || Object.keys(ANCHORS).length !== 36) {
  throw new Error(`anchor 対応表またはテンプレート件数が 36 ではありません (templates=${ids.length}, anchors=${Object.keys(ANCHORS).length})`)
}

const originals = new Map()
for (const id of ids) {
  const path = join(TELOP_ROOT, id, "template.json")
  originals.set(id, { path, doc: JSON.parse(await readFile(path, "utf8")) })
}

const outputs = []
const degenerateLayers = []
const allowFallbackMeasure = process.argv.includes("--allow-fallback-measure")
let browser
let page
let resolveDoc
let renderDoc

try {
  if (allowFallbackMeasure) {
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
    resolveDoc = (doc, bindings = {}) => atf.resolve(doc, bindings, undefined, harfbuzzMeasure)
    console.warn("[codemod-standard-knobs] Chrome を起動できない環境向けの HarfBuzz measure を使用します。既定レンダ byte parity は別途 npm test で確認してください")
  } else {
    const resolveBundle = await build({
      entryPoints: [ATF_ENTRY],
      bundle: true,
      write: false,
      format: "iife",
      globalName: "__standardKnobsAtf",
      platform: "browser",
      target: "chrome124",
      logLevel: "silent",
    })
    const renderBundle = await buildTelopHarness()
    browser = await launchBakeBrowser()
    page = await browser.newPage()
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 })
    await registerBundledFonts(page, originals.values().next().value.doc)
    await page.addScriptTag({ content: resolveBundle.outputFiles[0].text })
    await page.addScriptTag({ content: renderBundle })
    resolveDoc = (doc, bindings = {}) => resolveInPage(page, doc, bindings)
    renderDoc = (doc) => renderInPage(page, doc)
  }

  for (const id of ids) {
    const { path, doc: originalDoc } = originals.get(id)
    const baselineFrame = renderDoc ? await renderDoc(originalDoc) : null
    const doc = clone(originalDoc)
    delete doc.anchor
    ensurePositionVariables(doc)
    addMissingTextSizeVariables(doc)
    assignGroupsAndRoles(doc)

    if (POSITION_TOKEN.test(JSON.stringify(doc.layers))) {
      throw new Error(`${id}: コードモッド後の layers[] に位置トークンが残っています`)
    }

    const naturalScene = await resolveDoc(doc)
    for (const layer of naturalScene.layers) {
      if (!(layer.size.w > 0) || !(layer.size.h > 0)) {
        degenerateLayers.push(`${id}/${layer.id} (${layer.size.w}x${layer.size.h})`)
      }
    }
    const naturalBBox = bbox(naturalScene.layers)
    if (!naturalBBox) throw new Error(`${id}: 自然 bbox を計算できません`)
    const anchor = ANCHORS[id]
    const [fracX, fracY] = ANCHOR_FRACS[anchor]
    const naturalAnchorX = naturalBBox.left + fracX * (naturalBBox.right - naturalBBox.left)
    const naturalAnchorY = naturalBBox.top + fracY * (naturalBBox.bottom - naturalBBox.top)
    doc.anchor = anchor
    const cleanNumber = (value) => Math.round(value * 1e9) / 1e9
    doc.variables.find((v) => v.key === "posX").default = cleanNumber(naturalAnchorX - naturalScene.stage.width / 2)
    doc.variables.find((v) => v.key === "posY").default = cleanNumber(naturalAnchorY - naturalScene.stage.height / 2)

    const shiftedScene = await resolveDoc(doc)
    const naturalById = new Map(naturalScene.layers.map((layer) => [layer.id, layer]))
    for (const layer of shiftedScene.layers) {
      const natural = naturalById.get(layer.id)
      if (!natural) throw new Error(`${id}/${layer.id}: 自然座標側にレイヤーがありません`)
      const dx = Math.abs(layer.transform.x - natural.transform.x)
      const dy = Math.abs(layer.transform.y - natural.transform.y)
      if (dx > 0.1 || dy > 0.1) {
        throw new Error(`${id}/${layer.id}: 既定座標パリティ失敗 dx=${dx}, dy=${dy}`)
      }
    }

    if (renderDoc) {
      const migratedFrame = await renderDoc(doc)
      if (migratedFrame !== baselineFrame) {
        throw new Error(`${id}: 既定値レンダリングが移行前とバイト一致しません`)
      }
    }
    outputs.push({ path, doc })
    console.log(`[codemod-standard-knobs] verified ${id} anchor=${anchor}`)
  }
} finally {
  if (page) await page.close()
  if (browser) await browser.close()
}

for (const { path, doc } of outputs) {
  await writeFile(path, `${JSON.stringify(doc, null, 2)}\n`)
}
console.log(
  `[codemod-standard-knobs] PASS ${outputs.length}/36（座標 ±0.1px${renderDoc ? "・既定レンダ byte parity" : "・近似 measure"}）`,
)
console.log(`[codemod-standard-knobs] 既定値の縮退レイヤー ${degenerateLayers.length} 件: ${degenerateLayers.join(", ") || "なし"}`)
