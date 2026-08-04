// text-centering.test — plain テキスト経路の縦センタリング回帰テスト（2026-08-03）。
// ストア字幕棚で発覚した「全テンプレの文字が座布団に対して約 0.1×size 上ずれ」の根本原因
// （drawText が em ボックスを box 上端に張り付けて描いていた）の再発防止。
//
// 検証 2 点:
//   (1) 帯 shape の中心に anchor 0.5 で置いた text の実測 bbox 中心が帯中心と一致する
//       （旧実装では size=64 で約 6.4px 上ずれ → 許容 3px で FAIL していた）
//   (2) 同一テキストを plain 経路と perChar 経路で描いたとき縦位置が一致する
//       （補正は perChar 側に元からあり、plain 側だけ抜けていた非一貫性の再発防止）
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { launchBakeBrowser, withBakePage } from "../src/browser.mjs"
import { buildTelopHarness } from "../src/build-harness.mjs"

const ALPHA_THRESHOLD = 12
const SIZE = { w: 1280, h: 720 }
const BAND_CY = 360
const FONT_SIZE = 64

function makeDoc({ perChar } = {}) {
  const textLayer = {
    id: "probe_text",
    type: "text",
    content: {
      text: "株式会社テスト計測",
      size: FONT_SIZE,
      font: "'Noto Sans JP', sans-serif",
      weight: 700,
      color: "#ffffff",
      align: "center",
    },
    transform: { x: SIZE.w / 2, y: BAND_CY, anchor: { x: 0.5, y: 0.5 } },
  }
  if (perChar) textLayer.perChar = perChar
  return {
    format: "atf",
    version: "0.1",
    id: "probe_doc",
    kind: "caption",
    stage: { width: SIZE.w, height: SIZE.h, fps: 30, duration: 2, bg: "transparent" },
    variables: [],
    layers: [
      {
        id: "probe_band",
        type: "shape",
        content: { shape: "rect", fill: "#204060", cornerRadius: 0 },
        size: { w: 900, h: 120 },
        transform: { x: SIZE.w / 2, y: BAND_CY, anchor: { x: 0.5, y: 0.5 } },
      },
      textLayer,
    ],
  }
}

/** 指定レイヤーだけ可視にした doc を返す（robustness.test と同じ opacity=-1 方式） */
function isolate(doc, keepId) {
  const layers = doc.layers.map((l) =>
    l.id === keepId ? l : { ...l, transform: { ...l.transform, opacity: -1 }, tracks: [] },
  )
  return { ...doc, layers }
}

let browser
let bundle

before(async () => {
  browser = await launchBakeBrowser()
  bundle = await buildTelopHarness()
})

after(async () => {
  await browser.close()
})

async function renderBBox(page, doc) {
  await page.evaluate(() => {
    document.body.innerHTML = ""
  })
  await page.evaluate(
    (docArg) => {
      // @ts-expect-error harness バンドルが注入する
      window.__bakeHandle = window.__bakeTelop.init(docArg, {}, undefined)
    },
    doc,
  )
  await page.evaluate(
    (w, h) => window.__bakeHandle.renderFrame(w, h, 1, 2),
    SIZE.w,
    SIZE.h,
  )
  return page.evaluate((threshold) => {
    const canvas = document.getElementById("bake-stage")
    const ctx = canvas.getContext("2d")
    const { width, height } = canvas
    const data = ctx.getImageData(0, 0, width, height).data
    let minX = width
    let minY = height
    let maxX = -1
    let maxY = -1
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] >= threshold) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    if (maxX < 0) return null
    return { top: minY, bottom: maxY + 1, cy: (minY + maxY + 1) / 2 }
  }, ALPHA_THRESHOLD)
}

test("text-centering: anchor 中央の plain テキストは帯中心に一致する（±3px）", async () => {
  await withBakePage(browser, SIZE, async (page) => {
    await page.addScriptTag({ content: bundle })
    const doc = makeDoc()
    const bandBox = await renderBBox(page, isolate(doc, "probe_band"))
    const textBox = await renderBBox(page, isolate(doc, "probe_text"))
    assert.ok(bandBox && textBox, "帯とテキストの両方が描画されること")
    const dCy = textBox.cy - bandBox.cy
    assert.ok(
      Math.abs(dCy) <= 3,
      `テキスト実測中心が帯中心から ${dCy.toFixed(1)}px ずれている（許容 ±3px。` +
        `旧バグでは約 -${(FONT_SIZE * 0.1).toFixed(1)}px 上ずれ）`,
    )
  })
})

test("text-centering: plain 経路と perChar 経路の縦位置が一致する（±1.5px）", async () => {
  await withBakePage(browser, SIZE, async (page) => {
    await page.addScriptTag({ content: bundle })
    const plainBox = await renderBBox(page, isolate(makeDoc(), "probe_text"))
    const perCharBox = await renderBBox(page, isolate(makeDoc({ perChar: { tracks: [] } }), "probe_text"))
    assert.ok(plainBox && perCharBox, "両経路ともテキストが描画されること")
    const dTop = perCharBox.top - plainBox.top
    assert.ok(
      Math.abs(dTop) <= 1.5,
      `perChar 経路と plain 経路でテキスト上端が ${dTop.toFixed(1)}px ずれている（許容 ±1.5px）`,
    )
  })
})
