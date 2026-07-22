// robustness.test — telop-tunables タスク（2026-07-22）のテキスト長堅牢化 +
// particle-min-fix タスク（同日）で強化した「プレート内含有」基準を代表 6 件で実機検証する。
// catalog.test.mjs と違い実際にヘッドレスブラウザで renderFrame() を呼ぶため唯一このテスト
// だけ数十秒かかる（36 件 x 4 長 の全量は
// akari-video-internal/tasks/2026-07-22-particle-min-fix/out/audit-v3.mjs が担う。
// L2 相当・機械検証の主契約はそちら）。
//
// 判定基準（2026-07-22 強化。旧版は「キャンバス境界内か」のみを見ており、
// 「プレート/帯/バッジの中に収まっているか」を見ていなかった——オーナーが4倍長ギャラリーで
// 「プレートを突き抜けている」と指摘した通り、これは判定基準の設計ミスだった）:
//   - shape レイヤーを持たないテキスト（自由配置）: キャンバス境界内か
//   - shape レイヤーを持つテキスト: 標準文の時点でそのテキストを内包している shape のうち
//     最もタイトな（面積最小の）ものを「背景プレート」とみなし、そのプレートの
//     bbox + 許容パディング内に収まっているか
//
// レイヤーの可視/不可視は transform.opacity=0 ではなく -1 を使う（vendor エンジンの
// 既知の挙動2つを script 側で回避——(1) opacity トラックを持つレイヤーは
// sampleLayerTransform がトラック値で上書きするため素の 0 指定は効かない→tracks を
// 剥がす、(2) resolve.ts の `layer.transform.opacity ? ... : 1` は JS の truthy 判定で
// リテラル 0 を「未指定」とみなし 1 にフォールバックしてしまう→ -1 を使う。
// どちらも resolve() の式依存・スコープには影響しない）。
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { launchBakeBrowser, withBakePage } from "../src/browser.mjs"
import { loadTelopPreset, resolveCatalogRoot } from "../src/catalog.mjs"
import { buildTelopHarness } from "../src/build-harness.mjs"

const CATALOG_ROOT = resolveCatalogRoot()
const ALPHA_THRESHOLD = 12
const CANVAS_TOLERANCE_PX = 3
const PLATE_TOLERANCE_PX = 6
const ASSOC_TOLERANCE_PX = 4
const EN_FILLER = "The quick brown fox jumps over the lazy dog today"
const CATEGORIES = ["len1", "standard", "len2x", "len4x"]

// 代表 6 件: 汎用 shrink-to-fit のみ / プレート幅追従（複数テキスト共有） /
// バッジ再センタリング fit / 多段グラデ+perChar / 重複レイヤーのカラオケ演出 /
// 独立した帯+再センタリング chip（今回のバグの主因パターン）、を一通り横断する
const CASES = [
  "ref3_particle_min",
  "ref3_tl_r1s3_001",
  "ref3_tl_r1s3_002",
  "ref3_tl_r3s11_4",
  "ref3_word_highlight",
  "ref3_tl_r2s6_001",
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

function isolate(doc, keepId) {
  const layers = doc.layers.map((l) =>
    l.id === keepId ? l : { ...l, transform: { ...l.transform, opacity: -1 }, tracks: [] },
  )
  return { ...doc, layers }
}

function containsWithTolerance(outer, inner, tol) {
  if (outer === null || inner === null) return false
  return (
    outer.left <= inner.left + tol &&
    outer.top <= inner.top + tol &&
    outer.right >= inner.right - tol &&
    outer.bottom >= inner.bottom - tol
  )
}

function judgeCanvas(bbox, stageW, stageH) {
  if (bbox === null) return { pass: true }
  const overLeft = Math.max(0, -bbox.left)
  const overTop = Math.max(0, -bbox.top)
  const overRight = Math.max(0, bbox.right - stageW)
  const overBottom = Math.max(0, bbox.bottom - stageH)
  return {
    pass:
      overLeft <= CANVAS_TOLERANCE_PX &&
      overTop <= CANVAS_TOLERANCE_PX &&
      overRight <= CANVAS_TOLERANCE_PX &&
      overBottom <= CANVAS_TOLERANCE_PX,
    overflow: { left: overLeft, top: overTop, right: overRight, bottom: overBottom },
  }
}

function judgePlate(textBBox, shapeBBox) {
  if (textBBox === null) return { pass: true }
  if (shapeBBox === null) return { pass: false }
  const overLeft = Math.max(0, shapeBBox.left - textBBox.left)
  const overTop = Math.max(0, shapeBBox.top - textBBox.top)
  const overRight = Math.max(0, textBBox.right - shapeBBox.right)
  const overBottom = Math.max(0, textBBox.bottom - shapeBBox.bottom)
  return {
    pass:
      overLeft <= PLATE_TOLERANCE_PX &&
      overTop <= PLATE_TOLERANCE_PX &&
      overRight <= PLATE_TOLERANCE_PX &&
      overBottom <= PLATE_TOLERANCE_PX,
    overflow: { left: overLeft, top: overTop, right: overRight, bottom: overBottom },
  }
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

async function withReusablePage(size, fn) {
  return withBakePage(browser, size, async (page) => {
    await page.addScriptTag({ content: bundle })
    return fn(page)
  })
}

async function renderAndGetBBox(page, doc, bindings, size) {
  await page.evaluate(() => {
    document.body.innerHTML = ""
  })
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
}

for (const id of CASES) {
  test(`telop robustness: ${id} — 1文字/標準/2倍長/4倍長・日英混在 すべてプレート内（or自由配置はキャンバス内）`, async () => {
    const { doc } = await loadTelopPreset(CATALOG_ROOT, id)
    const size = { w: doc.stage.width, h: doc.stage.height }
    const textLayerIds = doc.layers.filter((l) => l.type === "text").map((l) => l.id)
    const shapeLayerIds = doc.layers.filter((l) => l.type === "shape").map((l) => l.id)
    const standardBindings = buildBindings(doc, "standard")

    await withReusablePage(size, async (page) => {
      // 標準文で内包関係（どの shape がどのテキストの背景プレートか）を決定する
      const standardBBox = {}
      for (const layerId of [...textLayerIds, ...shapeLayerIds]) {
        standardBBox[layerId] = await renderAndGetBBox(page, isolate(doc, layerId), standardBindings, size)
      }
      const plateByText = {}
      for (const textId of textLayerIds) {
        const tBox = standardBBox[textId]
        const containing = []
        if (tBox !== null) {
          for (const shapeId of shapeLayerIds) {
            const sBox = standardBBox[shapeId]
            if (sBox !== null && containsWithTolerance(sBox, tBox, ASSOC_TOLERANCE_PX)) {
              containing.push({ shapeId, area: (sBox.right - sBox.left) * (sBox.bottom - sBox.top) })
            }
          }
        }
        containing.sort((a, b) => a.area - b.area)
        plateByText[textId] = containing[0]?.shapeId ?? null
      }

      for (const category of CATEGORIES) {
        const bindings = buildBindings(doc, category)
        for (const textId of textLayerIds) {
          const textBBox = await renderAndGetBBox(page, isolate(doc, textId), bindings, size)
          const plateId = plateByText[textId]
          const judgement =
            plateId === null
              ? judgeCanvas(textBBox, size.w, size.h)
              : judgePlate(textBBox, await renderAndGetBBox(page, isolate(doc, plateId), bindings, size))
          assert.ok(
            judgement.pass,
            `${id}/${category}/${textId}: ${plateId ? `プレート(${plateId})からはみ出した` : "キャンバスからはみ出した"} ` +
              `(text=${JSON.stringify(textBBox)}, overflow=${JSON.stringify(judgement.overflow)})`,
          )
        }
      }
    })
  })
}
