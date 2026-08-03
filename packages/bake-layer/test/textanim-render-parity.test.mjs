// original 完全スキップを最終 canvas PNG bytes で全36テンプレ実測する。
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { launchBakeBrowser, withBakePage } from "../src/browser.mjs"
import { registerBundledFonts } from "../src/fonts.mjs"
import { loadTelopPreset, resolvePresetsRoot } from "../src/presets.mjs"
import { buildTelopHarness } from "../src/build-harness.mjs"

const PRESETS_ROOT = resolvePresetsRoot()
const ANIMATION_KEYS = new Set(["animIn", "animOut", "animLoop", "animInSec", "animOutSec"])
const indexSource = await readFile(new URL("../../../presets/telop/index.jsonl", import.meta.url), "utf8")
const ALL_CASES = indexSource.trim().split("\n").map((line) => JSON.parse(line).id).sort()

let browser
let bundle

before(async () => {
  browser = await launchBakeBrowser()
  bundle = await buildTelopHarness()
})

after(async () => {
  if (browser) await browser.close()
})

function withoutAnimationDeclarations(doc) {
  return {
    ...structuredClone(doc),
    groups: doc.groups.filter((group) => group.id !== "anim"),
    variables: doc.variables.filter((variable) => !ANIMATION_KEYS.has(variable.key)),
  }
}

async function renderPng(page, doc, t) {
  await page.evaluate(() => { document.body.innerHTML = "" })
  await page.evaluate((docArg) => {
    window.__textanimParityHandle = window.__bakeTelop.init(docArg, {}, undefined)
  }, doc)
  return page.evaluate((w, h, time, duration) => (
    window.__textanimParityHandle.renderFrame(w, h, time, duration)
  ), doc.stage.width, doc.stage.height, t, doc.stage.duration)
}

test("textanim: original は全36テンプレ・代表3時点で canvas PNG bytes が一致する", async () => {
  assert.equal(ALL_CASES.length, 36)
  const first = await loadTelopPreset(PRESETS_ROOT, ALL_CASES[0])
  await withBakePage(browser, { w: first.doc.stage.width, h: first.doc.stage.height }, async (page) => {
    // 全テンプレの fontFamily.options は同じ同梱フォント集合なので、ページごとに 1 回だけ登録する。
    await registerBundledFonts(page, first.doc)
    await page.addScriptTag({ content: bundle })
    for (const id of ALL_CASES) {
      const { doc } = await loadTelopPreset(PRESETS_ROOT, id)
      const baseline = withoutAnimationDeclarations(doc)
      const lastFrame = Math.max(0, doc.stage.duration - 1 / doc.stage.fps)
      for (const t of [0, doc.stage.duration / 2, lastFrame]) {
        const expected = await renderPng(page, baseline, t)
        const actual = await renderPng(page, doc, t)
        assert.equal(actual, expected, `${id}/t=${t}: PNG bytes`)
      }
    }
  })
})
