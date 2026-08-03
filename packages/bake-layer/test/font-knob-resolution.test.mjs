// font-knob-resolution.test — fontFamily / fontWeight ツマミ（2026-08-03 vendor 拡張）の解決検証。
// TextContent.font / weight の Value 化が resolve で正しく実測・出力に伝わることを、
// ブラウザなし（スパイ measure）で確認する。
import { test } from "node:test"
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

const resolveModule = build({
  entryPoints: [fileURLToPath(new URL("../vendor/telop/atf/resolve.ts", import.meta.url))],
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

function docWithFontKnobs() {
  return {
    format: "atf",
    version: "0.1",
    id: "font_knob_doc",
    kind: "caption",
    stage: { width: 1280, height: 720, fps: 30, duration: 2, bg: "transparent" },
    variables: [
      {
        key: "fontFamily",
        type: "font",
        label: "フォント",
        default: "'Noto Sans JP', sans-serif",
        options: ["'Noto Sans JP', sans-serif", "'Noto Serif JP', serif"],
      },
      { key: "fontWeight", type: "number", label: "太さ（100〜900）", default: 700 },
    ],
    layers: [
      {
        id: "probe",
        type: "text",
        content: {
          text: "テスト",
          size: 48,
          font: { var: "fontFamily" },
          weight: { var: "fontWeight" },
          color: "#ffffff",
        },
        transform: { x: 640, y: 360, anchor: { x: 0.5, y: 0.5 } },
      },
    ],
  }
}

function spyMeasure(calls) {
  return (text, font, sizePx, weight) => {
    calls.push({ text, font, sizePx, weight })
    return { width: text.length * sizePx, height: sizePx * 1.2 }
  }
}

test("font/weight は既定値で解決され、実測（measure）にも渡る", async () => {
  const { resolve } = await resolveModule
  const calls = []
  const scene = resolve(docWithFontKnobs(), {}, undefined, spyMeasure(calls))
  const content = scene.layers[0].content
  assert.equal(content.font, "'Noto Sans JP', sans-serif")
  assert.equal(content.weight, 700)
  assert.ok(calls.length > 0)
  assert.equal(calls[0].font, "'Noto Sans JP', sans-serif")
  assert.equal(calls[0].weight, 700)
})

test("bindings で fontFamily / fontWeight を上書きできる（文字列 weight も数値化）", async () => {
  const { resolve } = await resolveModule
  const calls = []
  const scene = resolve(
    docWithFontKnobs(),
    { fontFamily: "'Noto Serif JP', serif", fontWeight: "300" },
    undefined,
    spyMeasure(calls),
  )
  const content = scene.layers[0].content
  assert.equal(content.font, "'Noto Serif JP', serif")
  assert.equal(content.weight, 300)
  assert.equal(calls[0].font, "'Noto Serif JP', serif")
  assert.equal(calls[0].weight, 300)
})

test("不正な weight（0 以下・非数値）は undefined に落ちる", async () => {
  const { resolve } = await resolveModule
  const scene = resolve(docWithFontKnobs(), { fontWeight: "bold" }, undefined, spyMeasure([]))
  assert.equal(scene.layers[0].content.weight, undefined)
})

test("素の string font / number weight（旧形式）は従来どおり通る", async () => {
  const { resolve } = await resolveModule
  const doc = docWithFontKnobs()
  doc.variables = []
  doc.layers[0].content.font = "'M PLUS Rounded 1c', sans-serif"
  doc.layers[0].content.weight = 800
  const scene = resolve(doc, {}, undefined, spyMeasure([]))
  assert.equal(scene.layers[0].content.font, "'M PLUS Rounded 1c', sans-serif")
  assert.equal(scene.layers[0].content.weight, 800)
})
