// 標準装飾ゲート: 36件既定パリティ、全背景 OFF、各効果 OFF/ON、字間の実測幅。
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { launchBakeBrowser, withBakePage } from "../src/browser.mjs"
import { registerBundledFonts } from "../src/fonts.mjs"
import { loadTelopPreset, resolvePresetsRoot } from "../src/presets.mjs"
import { buildTelopHarness } from "../src/build-harness.mjs"

const PRESETS_ROOT = resolvePresetsRoot()
const FX_KEYS = new Set([
  "bgEnabled", "strokeEnabled", "strokeWidth", "color_stroke", "shadowEnabled",
  "color_shadow", "glowEnabled", "color_glow", "glowStrength", "letterSpacing",
])
const TOGGLE_KEYS = new Set(["bgEnabled", "strokeEnabled", "shadowEnabled", "glowEnabled"])
const indexSource = await readFile(new URL("../../../presets/telop/index.jsonl", import.meta.url), "utf8")
const ALL_CASES = indexSource.trim().split("\n").map((line) => JSON.parse(line).id).sort()
const BACKGROUND_CASES = []
for (const id of ALL_CASES) {
  const { doc } = await loadTelopPreset(PRESETS_ROOT, id)
  if (doc.variables.find((variable) => variable.key === "bgEnabled")?.default === true) {
    BACKGROUND_CASES.push(id)
  }
}
assert.equal(ALL_CASES.length, 36)
assert.equal(BACKGROUND_CASES.length, 28)

let browser
let bundle

before(async () => {
  browser = await launchBakeBrowser()
  bundle = await buildTelopHarness()
})

after(async () => {
  if (browser) await browser.close()
})

function collectVariableReferences(value, out = new Set()) {
  if (Array.isArray(value)) {
    for (const child of value) collectVariableReferences(child, out)
    return out
  }
  if (!value || typeof value !== "object") return out
  if (typeof value.var === "string") out.add(value.var)
  if (typeof value.expr === "string") {
    for (const match of value.expr.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*\b/g)) out.add(match[0])
  }
  for (const child of Object.values(value)) collectVariableReferences(child, out)
  return out
}

function withoutFxDeclarations(doc) {
  const baseline = structuredClone(doc)
  const referenced = collectVariableReferences(baseline.layers)
  baseline.variables = baseline.variables.filter((variable) => (
    !FX_KEYS.has(variable.key)
    || (!TOGGLE_KEYS.has(variable.key) && referenced.has(variable.key))
  ))
  baseline.groups = baseline.groups.filter((group) => group.id !== "fx")
  baseline.layers = baseline.layers.map((layer) => {
    const copy = { ...layer }
    delete copy.fxTag
    return copy
  })
  return baseline
}

function steadyTime(doc) {
  return Math.min(doc.stage.duration * 0.5, (doc.timing?.inDur ?? 0) + 1)
}

async function initAndRender(page, doc, bindings = {}) {
  await page.evaluate(() => { document.body.innerHTML = "" })
  await page.evaluate((docArg, bindingsArg) => {
    window.__fxKnobsHandle = window.__bakeTelop.init(docArg, bindingsArg, undefined)
  }, doc, bindings)
  await page.evaluate((w, h, t, T) => {
    window.__fxKnobsHandle.renderFrame(w, h, t, T)
  }, doc.stage.width, doc.stage.height, steadyTime(doc), doc.stage.duration)
}

async function renderPng(page, doc, bindings = {}) {
  await initAndRender(page, doc, bindings)
  return page.evaluate(() => document.getElementById("bake-stage").toDataURL("image/png"))
}

async function resolvedLayerIds(page, doc, bindings = {}) {
  return page.evaluate((docArg, bindingsArg) => (
    window.__bakeTelop.resolve(docArg, bindingsArg, undefined).layers.map((layer) => layer.id)
  ), doc, bindings)
}

async function pixelDiff(page, doc, beforeBindings, afterBindings) {
  await initAndRender(page, doc, beforeBindings)
  await page.evaluate(() => {
    const canvas = document.getElementById("bake-stage")
    window.__fxBeforePixels = new Uint8ClampedArray(
      canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data,
    )
  })
  await initAndRender(page, doc, afterBindings)
  return page.evaluate(() => {
    const canvas = document.getElementById("bake-stage")
    const after = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data
    const before = window.__fxBeforePixels
    let diffPixels = 0
    let alphaBefore = 0
    let alphaAfter = 0
    for (let index = 0; index < after.length; index += 4) {
      alphaBefore += before[index + 3]
      alphaAfter += after[index + 3]
      if (
        before[index] !== after[index]
        || before[index + 1] !== after[index + 1]
        || before[index + 2] !== after[index + 2]
        || before[index + 3] !== after[index + 3]
      ) diffPixels += 1
    }
    return { diffPixels, alphaBefore, alphaAfter }
  })
}

async function alphaBBox(page, doc, bindings) {
  await initAndRender(page, doc, bindings)
  return page.evaluate(() => {
    const canvas = document.getElementById("bake-stage")
    const { width, height } = canvas
    const data = canvas.getContext("2d").getImageData(0, 0, width, height).data
    let left = width
    let right = -1
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (data[(y * width + x) * 4 + 3] < 12) continue
        left = Math.min(left, x)
        right = Math.max(right, x + 1)
      }
    }
    return right < 0 ? null : { left, right, width: right - left }
  })
}

async function withHarness(fn) {
  const { doc } = await loadTelopPreset(PRESETS_ROOT, ALL_CASES[0])
  return withBakePage(browser, { w: doc.stage.width, h: doc.stage.height }, async (page) => {
    await registerBundledFonts(page, doc)
    await page.addScriptTag({ content: bundle })
    return fn(page)
  })
}

test("fx knobs gate 1: 全36テンプレの既定値レンダは移行前宣言と pixel 一致する", async () => {
  await withHarness(async (page) => {
    for (const id of ALL_CASES) {
      const { doc } = await loadTelopPreset(PRESETS_ROOT, id)
      const expected = await renderPng(page, withoutFxDeclarations(doc))
      const actual = await renderPng(page, doc)
      assert.equal(actual, expected, `${id}: default PNG bytes`)
    }
  })
})

test("fx knobs gate 2/bg: 目視確定28件は OFF で背景レイヤーが除去され、可視27件以上は alpha も減る", async () => {
  await withHarness(async (page) => {
    let pixelVisibleCases = 0
    for (const id of BACKGROUND_CASES) {
      const { doc } = await loadTelopPreset(PRESETS_ROOT, id)
      const backgroundLayerIds = doc.layers
        .filter((layer) => layer.fxTag === "bg")
        .map((layer) => layer.id)
      assert.ok(backgroundLayerIds.length > 0, `${id}: fxTag=bg レイヤーがありません`)

      const defaultLayerIds = new Set(await resolvedLayerIds(page, doc))
      const disabledLayerIds = new Set(await resolvedLayerIds(page, doc, { bgEnabled: false }))
      for (const layerId of backgroundLayerIds) {
        assert.ok(defaultLayerIds.has(layerId), `${id}/${layerId}: 既定 ON の解決結果に背景がありません`)
        assert.ok(!disabledLayerIds.has(layerId), `${id}/${layerId}: OFF の解決結果から背景が除去されていません`)
      }

      const metrics = await pixelDiff(page, doc, {}, { bgEnabled: false })
      assert.ok(metrics.alphaAfter <= metrics.alphaBefore, `${id}: bg OFF で alpha が増えています`)
      if (metrics.alphaAfter < metrics.alphaBefore) {
        assert.ok(metrics.diffPixels > 0, `${id}: bg OFF の alpha 差に対応する画素差がありません`)
        pixelVisibleCases += 1
      }
    }
    assert.ok(
      pixelVisibleCases >= 27,
      `bg OFF の可視効果を確認できたテンプレートが不足しています: ${pixelVisibleCases}/28`,
    )
    const { doc } = await loadTelopPreset(PRESETS_ROOT, "ref3_webvtt_shadow")
    const metrics = await pixelDiff(page, doc, {}, { bgEnabled: true })
    assert.ok(metrics.diffPixels > 0)
    assert.ok(metrics.alphaAfter > metrics.alphaBefore)
  })
})

test("fx knobs gate 2/stroke-shadow-glow: 既存 OFF と標準 ON が pixel で実効する", async () => {
  await withHarness(async (page) => {
    const cases = [
      ["ref3_edu_speaker", {}, { strokeEnabled: false }, "decrease"],
      ["ref3_webvtt_shadow", {}, { strokeEnabled: true }, "increase"],
      ["ref3_webvtt_shadow", {}, { shadowEnabled: false }, "decrease"],
      ["ref3_edu_speaker", {}, { shadowEnabled: true }, "increase"],
      ["ref3_hollow_neon", {}, { glowEnabled: false }, "decrease"],
      ["ref3_webvtt_shadow", {}, { glowEnabled: true }, "increase"],
    ]
    for (const [id, beforeBindings, afterBindings, direction] of cases) {
      const { doc } = await loadTelopPreset(PRESETS_ROOT, id)
      const metrics = await pixelDiff(page, doc, beforeBindings, afterBindings)
      assert.ok(metrics.diffPixels > 0, `${id}/${JSON.stringify(afterBindings)}: 画素差がありません`)
      if (direction === "increase") {
        assert.ok(metrics.alphaAfter > metrics.alphaBefore, `${id}: alpha が増えていません`)
      } else {
        assert.ok(metrics.alphaAfter < metrics.alphaBefore, `${id}: alpha が減っていません`)
      }
    }
  })
})

test("fx knobs gate 3: letterSpacing を増やすと実測 alpha bbox 幅が単調増加する", async () => {
  await withHarness(async (page) => {
    const { doc } = await loadTelopPreset(PRESETS_ROOT, "ref3_webvtt_shadow")
    const widths = []
    for (const letterSpacing of [0, 6, 12]) {
      const box = await alphaBBox(page, doc, {
        bgEnabled: false,
        strokeEnabled: false,
        shadowEnabled: false,
        glowEnabled: false,
        letterSpacing,
      })
      assert.ok(box)
      widths.push(box.width)
    }
    assert.ok(widths[0] < widths[1] && widths[1] < widths[2], `widths=${widths.join(",")}`)
  })
})
