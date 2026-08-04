// fonts.test — 同梱フォント登録（2026-08-03 追加）の検証。
// (1) specsForDoc が doc の参照 family だけに絞ること
// (2) registerBundledFonts で document.fonts に loaded 状態の FontFace が入り、
//     実測幅がフォールバックフォントから変わること（= 実測・描画へ実際に効いている）
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { launchBakeBrowser, withBakePage } from "../src/browser.mjs"
import { registerBundledFonts, specsForDoc } from "../src/fonts.mjs"

let browser

before(async () => {
  browser = await launchBakeBrowser()
})

after(async () => {
  await browser.close()
})

test("specsForDoc: doc が参照する family だけに絞る（別名 'Rounded Mplus 1c' も解決）", () => {
  const notoOnly = specsForDoc({ layers: [{ content: { font: "'Noto Sans JP', sans-serif" } }] })
  assert.deepEqual([...new Set(notoOnly.map((s) => s.family))], ["Noto Sans JP"])

  const aliasDoc = specsForDoc({ layers: [{ content: { font: "'Rounded Mplus 1c', sans-serif" } }] })
  assert.deepEqual([...new Set(aliasDoc.map((s) => s.family))], ["M PLUS Rounded 1c"])

  const none = specsForDoc({ layers: [{ content: { font: "system-ui" } }] })
  assert.equal(none.length, 0)
})

test("registerBundledFonts: FontFace が loaded で入り実測幅が変わる", async () => {
  await withBakePage(browser, { w: 200, h: 100 }, async (page) => {
    const probeWidth = () =>
      page.evaluate(() => {
        const ctx = document.createElement("canvas").getContext("2d")
        ctx.font = "700 48px 'Noto Sans JP', sans-serif"
        return ctx.measureText("特集ABCWji123").width
      })

    const before_ = await probeWidth()
    const loaded = await registerBundledFonts(page, {
      layers: [{ content: { font: "'Noto Sans JP', sans-serif" } }],
    })
    assert.deepEqual(loaded, ["Noto Sans JP 100 900"])

    const status = await page.evaluate(() =>
      [...document.fonts].map((f) => ({ family: f.family, status: f.status })),
    )
    assert.ok(
      status.some((f) => f.family.includes("Noto Sans JP") && f.status === "loaded"),
      `Noto Sans JP が loaded で登録されていること: ${JSON.stringify(status)}`,
    )

    const after_ = await probeWidth()
    // フォールバックと同梱 Noto は英数字の字幅が明確に異なる（macOS 実測で約 11% 差）。
    // 同梱フォントが実測に効いていれば幅が変わる
    assert.notEqual(before_, after_, "登録後に実測幅が変わること（同梱フォントが効いている）")
  })
})
