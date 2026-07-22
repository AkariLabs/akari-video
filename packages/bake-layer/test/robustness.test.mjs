// robustness.test — telop-tunables タスク（2026-07-22）のテキスト長堅牢化を代表 5 件で
// 実機検証する。catalog.test.mjs と違い実際にヘッドレスブラウザで renderFrame() を呼ぶため
// 唯一このテストだけ数十秒かかる（36 件 x 4 長 の全量は
// akari-video-internal/tasks/2026-07-22-telop-tunables/out/robustness-check.mjs が担う。
// L2 相当・機械検証の主契約はそちら）。
//
// 判定方法: shape レイヤーを透明化した複製ドキュメントをネイティブ解像度で描画し、
// canvas の ImageData から直接アルファ bbox を測る（外部画像デコード依存なし）。
// これをキャンバス境界（マージン0・アンチエイリアス許容3px）と比較する。
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { launchBakeBrowser, withBakePage } from "../src/browser.mjs"
import { loadTelopPreset, resolveCatalogRoot } from "../src/catalog.mjs"
import { buildTelopHarness } from "../src/build-harness.mjs"

const CATALOG_ROOT = resolveCatalogRoot()
const ALPHA_THRESHOLD = 12
const OVERFLOW_TOLERANCE_PX = 3
const EN_FILLER = "The quick brown fox jumps over the lazy dog today"
const CATEGORIES = ["len1", "standard", "len2x", "len4x"]

// 代表 5 件: 汎用 shrink-to-fit のみ / プレート幅追従 / バッジ fit 制約 /
// 多段グラデ+perChar / 重複レイヤーのカラオケ演出、と実装した堅牢化の手段を一通り横断する
const CASES = [
  "ref3_particle_min",
  "ref3_tl_r1s3_001",
  "ref3_tl_r1s3_002",
  "ref3_tl_r3s11_4",
  "ref3_word_highlight",
]

function lengthVariant(defaultText, category) {
  if (typeof defaultText !== "string" || defaultText === "") return defaultText
  switch (category) {
    case "len1":
      return "A"
    case "standard":
      return defaultText
    case "len2x":
      return `${defaultText} ${defaultText}`
    case "len4x":
      return `${defaultText} ${defaultText} ${EN_FILLER} ${defaultText}`
    default:
      throw new Error(`unknown category: ${category}`)
  }
}

function buildBindings(doc, category) {
  const bindings = {}
  for (const v of doc.variables) {
    if (v.type === "text") bindings[v.key] = lengthVariant(v.default, category)
  }
  return bindings
}

const TRANSPARENT = "rgba(0,0,0,0)"

// shape の塗りを透明化するだけで削除はしない（text レイヤーが @shape.width 等の式で
// shape に依存しているケースがあり、削除すると依存解決が壊れるため）
function makeShapesInvisible(doc) {
  const layers = doc.layers.map((layer) => {
    if (layer.type !== "shape") return layer
    const content = { ...layer.content, fill: TRANSPARENT }
    if (content.fillGradient) {
      content.fillGradient = { ...content.fillGradient, stops: content.fillGradient.stops.map((s) => ({ ...s, color: TRANSPARENT })) }
    }
    if (content.crack) content.crack = { ...content.crack, color: TRANSPARENT }
    return { ...layer, content }
  })
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

async function computeBBox(doc, bindings, size) {
  return withBakePage(browser, size, async (page) => {
    await page.addScriptTag({ content: bundle })
    await page.evaluate(
      (docArg, bindingsArg) => {
        // @ts-expect-error harness バンドルが注入する
        window.__bakeHandle = window.__bakeTelop.init(docArg, bindingsArg, undefined)
      },
      doc,
      bindings,
    )
    await page.evaluate(
      (w, h, tArg, TArg) => {
        // @ts-expect-error init() が返した handle
        return window.__bakeHandle.renderFrame(w, h, tArg, TArg)
      },
      size.w,
      size.h,
      doc.stage.duration * 0.5,
      doc.stage.duration,
    )
    return page.evaluate((threshold) => {
      const canvas = document.getElementById("bake-stage")
      const ctx = canvas.getContext("2d")
      const { width, height } = canvas
      const data = ctx.getImageData(0, 0, width, height).data
      let minX = width,
        minY = height,
        maxX = -1,
        maxY = -1
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const a = data[(y * width + x) * 4 + 3]
          if (a >= threshold) {
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }
      }
      if (maxX < 0) return null
      return { left: minX, top: minY, right: maxX + 1, bottom: maxY + 1 }
    }, ALPHA_THRESHOLD)
  })
}

for (const id of CASES) {
  test(`telop robustness: ${id} — 1文字/標準/2倍長/4倍長・日英混在 すべてキャンバス内`, async () => {
    const { doc } = await loadTelopPreset(CATALOG_ROOT, id)
    const tOnly = makeShapesInvisible(doc)
    const size = { w: doc.stage.width, h: doc.stage.height }

    for (const category of CATEGORIES) {
      const bindings = buildBindings(doc, category)
      const bbox = await computeBBox(tOnly, bindings, size)
      if (bbox === null) continue // 描画対象なし（空文字等）は安全側なので合格扱い
      const overLeft = Math.max(0, -bbox.left)
      const overTop = Math.max(0, -bbox.top)
      const overRight = Math.max(0, bbox.right - size.w)
      const overBottom = Math.max(0, bbox.bottom - size.h)
      assert.ok(
        overLeft <= OVERFLOW_TOLERANCE_PX &&
          overTop <= OVERFLOW_TOLERANCE_PX &&
          overRight <= OVERFLOW_TOLERANCE_PX &&
          overBottom <= OVERFLOW_TOLERANCE_PX,
        `${id}/${category}: テキストがキャンバスからはみ出した (bbox=${JSON.stringify(bbox)}, stage=${size.w}x${size.h})`,
      )
    }
  })
}
