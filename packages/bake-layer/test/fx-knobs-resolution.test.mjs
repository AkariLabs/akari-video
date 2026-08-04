import { test } from "node:test"
import assert from "node:assert/strict"
import { build } from "esbuild"

const resolveModule = build({
  entryPoints: [new URL("../vendor/telop/atf/resolve.ts", import.meta.url).pathname],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  target: "node20",
  logLevel: "silent",
}).then(async (result) => {
  const source = Buffer.from(result.outputFiles[0].contents).toString("base64")
  return import(`data:text/javascript;base64,${source}`)
})

const measure = (text, _font, size) => ({ width: [...text].length * size * 0.6, height: size * 1.2 })

function fxVariables(overrides = {}) {
  const values = {
    bgEnabled: false,
    strokeEnabled: false,
    strokeWidth: 7,
    color_stroke: "#000000",
    shadowEnabled: false,
    color_shadow: "rgba(0,0,0,0.55)",
    glowEnabled: false,
    color_glow: "#ffffff",
    glowStrength: 1,
    letterSpacing: 0,
    ...overrides,
  }
  const types = {
    bgEnabled: "bool", strokeEnabled: "bool", strokeWidth: "number", color_stroke: "color",
    shadowEnabled: "bool", color_shadow: "color", glowEnabled: "bool", color_glow: "color",
    glowStrength: "number", letterSpacing: "number",
  }
  return Object.entries(values).map(([key, value]) => ({ key, type: types[key], label: key, default: value }))
}

function makeDoc(variableOverrides = {}) {
  return {
    format: "atf",
    version: "0.2",
    id: "fx_probe",
    kind: "caption",
    stage: { width: 1000, height: 600, fps: 30, duration: 2, bg: "transparent" },
    variables: fxVariables(variableOverrides),
    layers: [
      {
        id: "text",
        type: "text",
        content: { text: "装飾", size: 100, color: "#ffffff" },
        transform: { x: 500, y: 300, anchor: { x: 0.5, y: 0.5 } },
      },
    ],
  }
}

test("bool 変数は式スコープで true/false として visibleIf を制御する", async () => {
  const { resolve } = await resolveModule
  const doc = makeDoc()
  doc.layers[0].visibleIf = { expr: "bgEnabled" }
  assert.equal(resolve(doc, {}, undefined, measure).layers.length, 0)
  assert.equal(resolve(doc, { bgEnabled: true }, undefined, measure).layers.length, 2)
  assert.equal(resolve(doc, { bgEnabled: "false" }, undefined, measure).layers.length, 0)
})

test("効果なしテンプレートの ON は fontSize 比の標準レシピを合成する", async () => {
  const { resolve } = await resolveModule
  const scene = resolve(makeDoc(), {
    bgEnabled: true,
    strokeEnabled: true,
    shadowEnabled: true,
    glowEnabled: true,
    glowStrength: 2,
  }, undefined, measure)
  const bg = scene.layers.find((layer) => layer.id === "__fx_bg_text")
  const text = scene.layers.find((layer) => layer.id === "text")
  assert.ok(bg && text)
  assert.ok(Math.abs(text.content.stroke.width - 7) < 1e-9)
  assert.equal(text.content.shadow, undefined)
  assert.equal(text.content.shadows.length, 2)
  const shadow = text.content.shadows.find((value) => value.x !== 0 || value.y !== 0)
  const glow = text.content.shadows.find((value) => value.x === 0 && value.y === 0)
  assert.ok(Math.abs(shadow.blur - 8) < 1e-9)
  assert.ok(Math.abs(shadow.x - Math.sin(135 * Math.PI / 180) * 6) < 1e-9)
  assert.ok(Math.abs(shadow.y + Math.cos(135 * Math.PI / 180) * 6) < 1e-9)
  assert.equal(glow.blur, 50)
  assert.equal(bg.size.w, text.size.w + 70)
  assert.equal(bg.size.h, text.size.h + 70)
  assert.equal(bg.content.cornerRadius, 15)
  assert.equal(bg.content.fill, "rgba(0,0,0,0.62)")
})

test("OFF は多重装飾を含む全 text と fxTag 背景から当該効果を除去する", async () => {
  const { resolve } = await resolveModule
  const doc = makeDoc({ bgEnabled: true, strokeEnabled: true, shadowEnabled: true, glowEnabled: true })
  doc.layers.unshift({
    id: "plate",
    type: "shape",
    fxTag: "bg",
    content: { shape: "rect", fill: "#222222" },
    size: { w: 300, h: 150 },
    transform: { x: 500, y: 300, anchor: { x: 0.5, y: 0.5 } },
  })
  doc.layers[1].content.strokes = [
    { color: "#111111", width: 12 },
    { color: "#eeeeee", width: 4 },
  ]
  doc.layers[1].content.shadows = [
    { color: "#000000", blur: 8, x: 2, y: 3 },
    { color: { var: "color_glow" }, blur: 24, x: 0, y: 0 },
  ]
  doc.layers[1].content.innerShadows = [{ color: "#000000", blur: 4, x: 1, y: 1 }]
  doc.layers[1].content.innerGlow = { color: { var: "color_glow" }, blur: 10 }
  const scene = resolve(doc, {
    bgEnabled: false,
    strokeEnabled: false,
    shadowEnabled: false,
    glowEnabled: false,
  }, undefined, measure)
  assert.deepEqual(scene.layers.map((layer) => layer.id), ["text"])
  const content = scene.layers[0].content
  assert.equal(content.stroke, undefined)
  assert.equal(content.strokes, undefined)
  assert.equal(content.shadow, undefined)
  assert.equal(content.shadows, undefined)
  assert.equal(content.innerShadows, undefined)
  assert.equal(content.innerGlow, undefined)
})

test("enabled=true は既存の多重縁・多重影/グローを既定値で置換しない", async () => {
  const { resolve } = await resolveModule
  const legacy = makeDoc()
  legacy.variables = []
  legacy.layers[0].content.strokes = [
    { color: "#112233", width: 15 },
    { color: "#ffeeaa", width: 3 },
  ]
  legacy.layers[0].content.shadows = [
    { color: "#000000", blur: 4, x: 2, y: 5 },
    { color: "#00ffff", blur: 31, x: 0, y: 0 },
  ]
  const migrated = structuredClone(legacy)
  migrated.variables = fxVariables({
    strokeEnabled: true,
    strokeWidth: 15,
    color_stroke: "#112233",
    shadowEnabled: true,
    color_shadow: "#000000",
    glowEnabled: false,
  })
  // 色キーが glow と明示された元装飾として宣言する。
  migrated.variables.find((variable) => variable.key === "color_glow").default = "#00ffff"
  migrated.variables.find((variable) => variable.key === "glowEnabled").default = true
  migrated.layers[0].content.shadows[1].color = { var: "color_glow" }
  const expected = resolve(legacy, {}, undefined, measure).layers[0].content
  const actual = resolve(migrated, {}, undefined, measure).layers[0].content
  assert.deepEqual(actual.strokes, expected.strokes)
  assert.deepEqual(actual.shadows, expected.shadows)
})

test("shrink-to-fit は strokeEnabled の操作値でなく既定値を使う", async () => {
  const { resolve } = await resolveModule
  const doc = makeDoc({ strokeEnabled: true, strokeWidth: 20 })
  doc.layers[0].content.text = "1234567890"
  doc.layers[0].content.strokes = [{ color: "#000000", width: 20 }]
  doc.layers[0].fit = { maxWidth: { expr: "strokeEnabled * 300 + 100" } }
  const on = resolve(doc, { strokeEnabled: true }, undefined, measure)
  const off = resolve(doc, { strokeEnabled: false }, undefined, measure)
  assert.equal(on.layers[0].content.size, off.layers[0].content.size)
  assert.ok(on.layers[0].content.size < 100)
})
