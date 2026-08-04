import { test } from "node:test"
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

async function importTs(relativePath) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(relativePath, import.meta.url))],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: "node20",
    logLevel: "silent",
  })
  const source = Buffer.from(result.outputFiles[0].contents).toString("base64")
  return import(`data:text/javascript;base64,${source}`)
}

const textRunsModule = importTs("../vendor/telop/atf/text-runs.ts")
const resolveModule = importTs("../vendor/telop/atf/resolve.ts")
const perCharModule = importTs("../vendor/telop/render/perchar.ts")

test("text runs: 複数の **…** を順番どおりパースし、マーカーを除去する", async () => {
  const { parseTextRuns } = await textRunsModule
  assert.deepEqual(parseTextRuns("前**強調1**中**強調2**後"), {
    text: "前強調1中強調2後",
    runs: [
      { start: 0, end: 1, emphasis: false },
      { start: 1, end: 4, emphasis: true },
      { start: 4, end: 5, emphasis: false },
      { start: 5, end: 8, emphasis: true },
      { start: 8, end: 9, emphasis: false },
    ],
    parsed: true,
  })
})

test("text runs: 閉じ忘れは fail-visible で入力全体を素通しする", async () => {
  const { parseTextRuns } = await textRunsModule
  const parsed = parseTextRuns("前**閉じ忘れ")
  assert.equal(parsed.text, "前**閉じ忘れ")
  assert.equal(parsed.parsed, false)
  assert.deepEqual(parsed.runs, [{ start: 0, end: 7, emphasis: false }])
})

function makeDoc({ emphasisStyle = true, perChar = false, text = "A**BC**D" } = {}) {
  const content = {
    text: { var: "text" },
    size: 40,
    font: "system-ui",
    weight: 400,
    color: "#ffffff",
  }
  if (emphasisStyle) {
    content.emphasisStyle = {
      color: { var: "accent" },
      scale: { var: "scale" },
      weight: { var: "weight" },
    }
  }
  const layer = {
    id: "text",
    type: "text",
    content,
    transform: { x: 400, y: 150, anchor: { x: 0.5, y: 0.5 } },
    fit: { maxWidth: 700 },
  }
  if (perChar) layer.perChar = { split: "grapheme", stagger: 0, tracks: [] }
  return {
    format: "atf",
    version: "0.1",
    id: "text_runs_resolution",
    kind: "caption",
    stage: { width: 800, height: 300, fps: 30, duration: 2, bg: "transparent" },
    variables: [
      { key: "text", type: "text", label: "text", default: text },
      { key: "accent", type: "color", label: "accent", default: "#00ff00" },
      { key: "scale", type: "number", label: "scale", default: 1.5 },
      { key: "weight", type: "number", label: "weight", default: 800 },
    ],
    layers: [layer],
  }
}

test("text runs: emphasisStyle の全 Value が解決され、measure に scale/weight が届く", async () => {
  const { resolve } = await resolveModule
  const calls = []
  const measure = (text, font, size, weight) => {
    calls.push({ text, font, size, weight })
    return { width: text.length * size * 0.5, height: size * 1.2 }
  }
  const scene = resolve(makeDoc(), {}, undefined, measure)
  const content = scene.layers[0].content
  assert.equal(content.text, "ABCD")
  assert.deepEqual(content.runs, [
    { start: 0, end: 1, emphasis: false },
    { start: 1, end: 3, emphasis: true },
    { start: 3, end: 4, emphasis: false },
  ])
  assert.deepEqual(content.emphasisStyle, { color: "#00ff00", scale: 1.5, weight: 800 })
  assert.ok(calls.some((call) => call.text === "BC" && call.size === 60 && call.weight === 800))
})

test("text runs: emphasisStyle 未宣言でも対になったマーカーは描画テキストから除去する", async () => {
  const { resolve } = await resolveModule
  const scene = resolve(
    makeDoc({ emphasisStyle: false }),
    {},
    undefined,
    (text, _font, size) => ({ width: text.length * size * 0.5, height: size * 1.2 }),
  )
  assert.equal(scene.layers[0].content.text, "ABCD")
  assert.equal(scene.layers[0].content.runs, undefined)
  assert.equal(scene.layers[0].content.emphasisStyle, undefined)
})

test("text runs: perChar の grapheme / word 両分割で範囲スタイルをグリフへ合成する", async () => {
  const { resolve } = await resolveModule
  const { glyphTransforms } = await perCharModule
  const measure = (text, _font, size) => ({ width: text.length * size * 0.5, height: size * 1.2 })

  const graphemeScene = resolve(makeDoc({ perChar: true }), {}, undefined, measure)
  const graphemes = glyphTransforms(graphemeScene.layers[0], 1, 2)
  assert.deepEqual(graphemes.map((glyph) => glyph.ch), ["A", "B", "C", "D"])
  assert.equal(graphemes[0].fontScale, 1)
  assert.equal(graphemes[1].fontScale, 1.5)
  assert.equal(graphemes[1].color, "#00ff00")
  assert.equal(graphemes[1].weight, 800)

  const wordDoc = makeDoc({ perChar: true, text: "pre**FIX**post" })
  wordDoc.layers[0].perChar.split = "word"
  const wordScene = resolve(wordDoc, {}, undefined, measure)
  const words = glyphTransforms(wordScene.layers[0], 1, 2)
  assert.deepEqual(words.map((glyph) => glyph.ch), ["pre", "FIX", "post"])
  assert.equal(words[1].fontScale, 1.5)
  assert.equal(words[1].emphasis, true)
})

test("text runs: scale>1 の長文も run 実測を使って shrink-to-fit する", async () => {
  const { resolve } = await resolveModule
  const doc = makeDoc({ text: "長い本文**さらに大きな強調範囲**長い本文" })
  doc.layers[0].fit.maxWidth = 260
  doc.layers[0].fit.minScale = 0.1
  const scene = resolve(
    doc,
    {},
    undefined,
    (text, _font, size) => ({ width: Array.from(text).length * size, height: size * 1.2 }),
  )
  const content = scene.layers[0].content
  assert.ok(content.size < 40, `font size が縮小されること: ${content.size}`)
  assert.ok(content.measuredWidth <= 262, `run 込み実測幅が maxWidth 内であること: ${content.measuredWidth}`)
})
