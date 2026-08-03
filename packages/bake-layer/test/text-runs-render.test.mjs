import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { launchBakeBrowser, withBakePage } from "../src/browser.mjs"
import { buildTelopHarness } from "../src/build-harness.mjs"
import { loadTelopPreset, resolvePresetsRoot } from "../src/presets.mjs"

const SIZE = { w: 800, h: 300 }
let browser
let bundle

before(async () => {
  browser = await launchBakeBrowser()
  bundle = await buildTelopHarness()
})

after(async () => {
  await browser?.close()
})

function makeDoc({ perChar = false, emphasisStyle = true, text = "BASE**RANGE**END" } = {}) {
  const content = {
    text,
    size: 52,
    font: "system-ui",
    weight: 400,
    color: "#ff0000",
    align: "center",
  }
  if (emphasisStyle) content.emphasisStyle = { color: "#00ff00", scale: 1.5, weight: 800 }
  const layer = {
    id: "probe",
    type: "text",
    content,
    transform: { x: SIZE.w / 2, y: SIZE.h / 2, anchor: { x: 0.5, y: 0.5 } },
    fit: { maxWidth: 720 },
  }
  if (perChar) layer.perChar = { split: "grapheme", stagger: 0, tracks: [] }
  return {
    format: "atf",
    version: "0.1",
    id: "text_runs_render",
    kind: "caption",
    stage: { width: SIZE.w, height: SIZE.h, fps: 30, duration: 2, bg: "transparent" },
    variables: [],
    layers: [layer],
  }
}

async function render(page, doc, size = SIZE) {
  await page.evaluate(() => { document.body.innerHTML = "" })
  await page.evaluate((docArg) => {
    window.__textRunsHandle = window.__bakeTelop.init(docArg, {}, undefined)
  }, doc)
  const dataUrl = await page.evaluate(
    (w, h) => window.__textRunsHandle.renderFrame(w, h, 1, 2),
    size.w,
    size.h,
  )
  const stats = await page.evaluate(() => {
    const canvas = document.getElementById("bake-stage")
    const { width, height } = canvas
    const data = canvas.getContext("2d").getImageData(0, 0, width, height).data
    const boxes = {
      alpha: { left: width, top: height, right: -1, bottom: -1, count: 0 },
      red: { left: width, top: height, right: -1, bottom: -1, count: 0 },
      green: { left: width, top: height, right: -1, bottom: -1, count: 0 },
    }
    const add = (box, x, y) => {
      box.left = Math.min(box.left, x); box.top = Math.min(box.top, y)
      box.right = Math.max(box.right, x + 1); box.bottom = Math.max(box.bottom, y + 1); box.count += 1
    }
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const at = (y * width + x) * 4
        const r = data[at]
        const g = data[at + 1]
        const b = data[at + 2]
        const a = data[at + 3]
        if (a >= 12) add(boxes.alpha, x, y)
        if (a >= 160 && r >= 180 && g <= 80 && b <= 80) add(boxes.red, x, y)
        if (a >= 160 && g >= 180 && r <= 80 && b <= 80) add(boxes.green, x, y)
      }
    }
    return boxes
  })
  return { dataUrl, stats }
}

for (const perChar of [false, true]) {
  test(`text runs render: ${perChar ? "perChar" : "plain"} 経路で範囲だけ色・サイズ・太さが変わる`, async () => {
    await withBakePage(browser, SIZE, async (page) => {
      await page.addScriptTag({ content: bundle })
      const { stats } = await render(page, makeDoc({ perChar }))
      assert.ok(stats.red.count > 100, "通常ランが赤で描かれること")
      assert.ok(stats.green.count > 100, "強調ランが緑で描かれること")
      const redHeight = stats.red.bottom - stats.red.top
      const greenHeight = stats.green.bottom - stats.green.top
      assert.ok(greenHeight >= redHeight + 8, `強調ランだけ高くなること: red=${redHeight}, green=${greenHeight}`)
    })
  })
}

test("text runs render: emphasisStyle 未宣言では ** が消え、マーカー無し文言と pixel 同一", async () => {
  await withBakePage(browser, SIZE, async (page) => {
    await page.addScriptTag({ content: bundle })
    const marked = await render(page, makeDoc({ emphasisStyle: false, text: "BASE**RANGE**END" }))
    const plain = await render(page, makeDoc({ emphasisStyle: false, text: "BASERANGEEND" }))
    assert.equal(marked.dataUrl, plain.dataUrl)
  })
})

test("text runs render: emphasis を含む plain / perChar の縦位置が一致する（±1.5px）", async () => {
  await withBakePage(browser, SIZE, async (page) => {
    await page.addScriptTag({ content: bundle })
    const plain = await render(page, makeDoc())
    const perChar = await render(page, makeDoc({ perChar: true }))
    assert.ok(Math.abs(plain.stats.alpha.top - perChar.stats.alpha.top) <= 1.5)
    assert.ok(Math.abs(plain.stats.alpha.bottom - perChar.stats.alpha.bottom) <= 1.5)
  })
})

test("text runs render: scale>1 の長文が指定幅からはみ出さない", async () => {
  await withBakePage(browser, SIZE, async (page) => {
    await page.addScriptTag({ content: bundle })
    const doc = makeDoc({ text: "LONG TEXT **VERY LARGE EMPHASIS RANGE** LONG TEXT" })
    doc.layers[0].fit.maxWidth = 400
    doc.layers[0].fit.minScale = 0.1
    const { stats } = await render(page, doc)
    assert.ok(stats.alpha.right - stats.alpha.left <= 404)
  })
})

function legacyHormoziDoc(current) {
  const track = structuredClone(current.layers[0].tracks)
  const common = {
    font: { var: "fontFamily" },
    align: "left",
    shadow: { color: { var: "color_shadow" }, blur: 8, x: 3, y: 3 },
  }
  return {
    ...structuredClone(current),
    variables: [
      { key: "normalText", type: "text", label: "通常", default: "この動画を見れば" },
      { key: "emphasisText", type: "text", label: "強調", default: "全部わかる" },
      { key: "color_text", type: "color", label: "通常色", default: "#ffffff" },
      { key: "color_accent", type: "color", label: "強調色", default: "#ffd400" },
      { key: "color_stroke", type: "color", label: "縁", default: "#000000" },
      { key: "color_shadow", type: "color", label: "影", default: "rgba(0,0,0,0.75)" },
      { key: "fontFamily", type: "font", label: "font", default: "system-ui" },
      { key: "fontWeight", type: "number", label: "weight", default: 900 },
      { key: "posX", type: "number", label: "x", default: -110 },
      { key: "posY", type: "number", label: "y", default: 160 },
    ],
    layers: [
      {
        id: "legacy_normal", type: "text",
        content: { ...common, text: { var: "normalText" }, size: 108, weight: 900, color: { var: "color_text" }, strokes: [{ color: { var: "color_stroke" }, width: 12 }] },
        transform: { x: 940, y: 700, anchor: { x: 1, y: 0.5 } }, tracks: track,
      },
      {
        id: "legacy_emphasis", type: "text",
        content: { ...common, text: { var: "emphasisText" }, size: 128, weight: { var: "fontWeight" }, color: { var: "color_accent" }, strokes: [{ color: { var: "color_stroke" }, width: 14 }] },
        transform: { x: 980, y: 700, anchor: { x: 0, y: 0.5 } }, tracks: track,
      },
    ],
  }
}

test("text runs render: hormozi_snap 単一 text 化後の alpha bbox は旧 2 レイヤーから ±3px", async () => {
  const { doc } = await loadTelopPreset(resolvePresetsRoot(), "ref3_hormozi_snap")
  const size = { w: doc.stage.width, h: doc.stage.height }
  await withBakePage(browser, size, async (page) => {
    await page.addScriptTag({ content: bundle })
    const legacy = await render(page, legacyHormoziDoc(doc), size)
    const current = await render(page, doc, size)
    for (const edge of ["left", "top", "right", "bottom"]) {
      const delta = current.stats.alpha[edge] - legacy.stats.alpha[edge]
      assert.ok(Math.abs(delta) <= 3, `${edge} delta=${delta}px`)
    }
  })
})
