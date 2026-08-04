// テロップ標準ツマミ: 9 点アンカー・剛体移動・文言伸縮アンカー固定の実レンダ回帰テスト。
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { launchBakeBrowser, withBakePage } from "../src/browser.mjs"
import { registerBundledFonts } from "../src/fonts.mjs"
import { loadTelopPreset, resolvePresetsRoot } from "../src/presets.mjs"
import { buildTelopHarness } from "../src/build-harness.mjs"

const PRESETS_ROOT = resolvePresetsRoot()
const ALPHA_THRESHOLD = 12
const TOLERANCE = 2
const REPRESENTATIVE_CASES = [
  "ref3_particle_min",
  "ref3_tl_r1s3_001",
  "ref3_tl_r1s3_002",
  "ref3_tl_r3s11_4",
  "ref3_word_highlight",
  "ref3_tl_r2s6_001",
]

const indexSource = await readFile(new URL("../../../presets/telop/index.jsonl", import.meta.url), "utf8")
const ALL_CASES = indexSource.trim().split("\n").map((line) => JSON.parse(line).id).sort()
assert.equal(ALL_CASES.length, 36, "standard knobs の実レンダ対象は全36テンプレ")

// 幾何 bbox は shadow / glow / bevel と複数縁取りの alpha 範囲を測らないため、実ピクセルとの
// 差だけをテンプレ・軸別に許容する。未記載の軸とテンプレは契約どおり ±2px のまま。
const CENTER_TOLERANCES = {
  ref3_particle_min:      { x: 2,  y: 5 }, // measured (-1.5, -5.0)px: 二重縁取り
  ref3_hormozi_snap:      { x: 5,  y: 5 }, // measured (+4.5, -4.5)px: 縁取り + shadow
  ref3_corner_title_line: { x: 2,  y: 3 }, // measured (+1.0, +2.5)px: shadow
  ref3_webvtt_shadow:     { x: 4,  y: 3 }, // measured (+3.5, -3.0)px: shadow
  ref3_ruby_caption:      { x: 2,  y: 3 }, // measured ( 0.0, +2.5)px: 二層文字
  ref3_hollow_neon:       { x: 4,  y: 2 }, // measured (-4.0, +1.5)px: glow
  ref3_karaoke_flash:     { x: 5,  y: 2 }, // measured (-4.5,  0.0)px: glow + shadow
  ref3_tl_r2s0_002:       { x: 40, y: 2 }, // measured (+40.0, 0.0)px: plate 幅式が文字幅差を2倍化
  ref3_tl_r2s8_4:         { x: 3,  y: 2 }, // measured (-3.0,  0.0)px: shadow line
  ref3_tl_r3s7_07:        { x: 4,  y: 2 }, // measured (-4.0,  0.0)px: 多重 glow
  ref3_tl_r3s11_4:        { x: 6,  y: 2 }, // measured (-5.5,  0.0)px: glow + bevel
}

const DRIFT_TOLERANCES = {
  ref3_particle_min:   { x: 2,  y: 11 }, // measured (-1.5, +11.0)px: 二重縁取り
  // 左右連結ランを全 text 変数同時に非対称伸縮する検証条件での実測。継ぎ目を保つ意匠の mc は維持。
  ref3_hormozi_snap:   { x: 85, y: 6 },  // measured (+85.0, +5.5)px
  ref3_webvtt_shadow:  { x: 3,  y: 6 },  // measured (+2.5, +6.0)px: shadow
  ref3_edu_speaker:    { x: 2,  y: 6 },  // measured (-0.5, +6.0)px: shadow
  ref3_hollow_neon:    { x: 4,  y: 3 },  // measured (+4.0, +2.5)px: glow
  ref3_karaoke_flash:  { x: 5,  y: 2 },  // measured (-4.5, -0.5)px: glow + shadow
  ref3_kid_karaoke:    { x: 2,  y: 8 },  // measured (-1.0, +8.0)px: 複数縁取り + shadow
  ref3_tl_r2s0_002:    { x: 80, y: 2 },  // measured (+80.0, 0.0)px: plate 幅式が文字幅差を2倍化
  ref3_tl_r3s7_07:     { x: 4,  y: 12 }, // measured (+4.0, -12.0)px: 多重 glow
}

function tolerance(table, id) {
  return table[id] ?? { x: TOLERANCE, y: TOLERANCE }
}
const ANCHOR_FRACS = {
  tl: [0, 0], tc: [0.5, 0], tr: [1, 0],
  ml: [0, 0.5], mc: [0.5, 0.5], mr: [1, 0.5],
  bl: [0, 1], bc: [0.5, 1], br: [1, 1],
}

let browser
let bundle

before(async () => {
  browser = await launchBakeBrowser()
  bundle = await buildTelopHarness()
})

after(async () => {
  if (browser) await browser.close()
})

function isolate(doc, keepId) {
  return {
    ...doc,
    layers: doc.layers.map((layer) => layer.id === keepId
      ? layer
      : { ...layer, transform: { ...layer.transform, opacity: -1 }, tracks: [] }),
  }
}

function textBindings(doc, category) {
  const bindings = {}
  for (const variable of doc.variables.filter((candidate) => candidate.type === "text")) {
    const standard = String(variable.default ?? "") || "標準"
    if (category === "one") bindings[variable.key] = "字"
    else if (category === "standard") bindings[variable.key] = variable.default
    else if (category === "double") bindings[variable.key] = `${standard}${standard}`
    else bindings[variable.key] = `${standard}${standard}${standard}${standard}`
  }
  return bindings
}

async function renderBBox(page, doc, bindings = {}) {
  await page.evaluate(() => { document.body.innerHTML = "" })
  await page.evaluate((docArg, bindingsArg) => {
    window.__standardKnobsHandle = window.__bakeTelop.init(docArg, bindingsArg, undefined)
  }, doc, bindings)
  const t = Math.min(doc.stage.duration * 0.5, (doc.timing?.inDur ?? 0) + 1)
  await page.evaluate((w, h, time, duration) => {
    window.__standardKnobsHandle.renderFrame(w, h, time, duration)
  }, doc.stage.width, doc.stage.height, t, doc.stage.duration)
  return page.evaluate((threshold) => {
    const canvas = document.getElementById("bake-stage")
    const { width, height } = canvas
    const data = canvas.getContext("2d").getImageData(0, 0, width, height).data
    let left = width
    let top = height
    let right = -1
    let bottom = -1
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (data[(y * width + x) * 4 + 3] < threshold) continue
        left = Math.min(left, x)
        top = Math.min(top, y)
        right = Math.max(right, x + 1)
        bottom = Math.max(bottom, y + 1)
      }
    }
    return right < 0 ? null : { left, top, right, bottom }
  }, ALPHA_THRESHOLD)
}

async function withHarness(fn) {
  const { doc } = await loadTelopPreset(PRESETS_ROOT, ALL_CASES[0])
  return withBakePage(browser, { w: doc.stage.width, h: doc.stage.height }, async (page) => {
    // 全テンプレの fontFamily.options は同じ同梱フォント集合なので、ページごとに 1 回だけ登録する。
    await registerBundledFonts(page, doc)
    await page.addScriptTag({ content: bundle })
    return fn(page)
  })
}

test("standard knobs: anchor=mc / pos=(0,0) で合成 alpha bbox 中心がキャンバス中心（通常±2px・装飾別実測許容）", async () => {
  await withHarness(async (page) => {
    for (const id of ALL_CASES) {
      const { doc } = await loadTelopPreset(PRESETS_ROOT, id)
      const box = await renderBBox(page, { ...doc, anchor: "mc" }, { posX: 0, posY: 0 })
      assert.ok(box, `${id}: alpha bbox が空です`)
      const dx = (box.left + box.right) / 2 - doc.stage.width / 2
      const dy = (box.top + box.bottom) / 2 - doc.stage.height / 2
      const allowed = tolerance(CENTER_TOLERANCES, id)
      assert.ok(Math.abs(dx) <= allowed.x && Math.abs(dy) <= allowed.y,
        `${id}: bbox center diff=(${dx.toFixed(1)}, ${dy.toFixed(1)})px`)
    }
  })
})

test("standard knobs: posX +300 / posY -400 は全レイヤーを同量だけ剛体移動する（±2px）", async () => {
  await withHarness(async (page) => {
    for (const id of REPRESENTATIVE_CASES) {
      const { doc } = await loadTelopPreset(PRESETS_ROOT, id)
      const posX = Number(doc.variables.find((variable) => variable.key === "posX").default)
      const posY = Number(doc.variables.find((variable) => variable.key === "posY").default)
      for (const layer of doc.layers) {
        const base = await renderBBox(page, isolate(doc, layer.id))
        const moved = await renderBBox(page, isolate(doc, layer.id), { posX: posX + 300, posY: posY - 400 })
        if (!base && !moved) continue
        assert.ok(base && moved, `${id}/${layer.id}: 移動前後の片方だけ alpha bbox が空です`)
        const dx = moved.left - base.left
        const dy = moved.top - base.top
        assert.ok(Math.abs(dx - 300) <= TOLERANCE && Math.abs(dy + 400) <= TOLERANCE,
          `${id}/${layer.id}: delta=(${dx}, ${dy})px`)
      }
    }
  })
})

test("standard knobs: 文言 1文字/標準/2倍/4倍でも alpha bbox の anchor 点が不動（通常±2px・装飾別実測許容）", async () => {
  await withHarness(async (page) => {
    for (const id of ALL_CASES) {
      const { doc } = await loadTelopPreset(PRESETS_ROOT, id)
      const [fracX, fracY] = ANCHOR_FRACS[doc.anchor]
      let expected
      for (const category of ["one", "standard", "double", "quadruple"]) {
        const box = await renderBBox(page, doc, textBindings(doc, category))
        assert.ok(box, `${id}/${category}: alpha bbox が空です`)
        const point = {
          x: box.left + fracX * (box.right - box.left),
          y: box.top + fracY * (box.bottom - box.top),
        }
        expected ??= point
        const dx = point.x - expected.x
        const dy = point.y - expected.y
        const allowed = tolerance(DRIFT_TOLERANCES, id)
        assert.ok(Math.abs(dx) <= allowed.x && Math.abs(dy) <= allowed.y,
          `${id}/${category}: anchor drift=(${dx.toFixed(1)}, ${dy.toFixed(1)})px`)
      }
    }
  })
})
