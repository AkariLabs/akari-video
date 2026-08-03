// 標準アニメ 3 スロットの resolve 合成ゲート（original / 47語彙 / reverse / none）。
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"
import { loadTelopPreset, resolvePresetsRoot } from "../src/presets.mjs"
import { TEXTANIM_RECIPE_SLOTS } from "../vendor/telop/atf/textanim-recipes.mjs"

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

const resolveModule = importTs("../vendor/telop/atf/resolve.ts")
const transformModule = importTs("../vendor/telop/render/transform.ts")
const PRESETS_ROOT = resolvePresetsRoot()
const ANIMATION_KEYS = new Set(["animIn", "animOut", "animLoop", "animInSec", "animOutSec"])
const measure = (text, _font, size) => ({ width: text.length * size * 0.6, height: size * 1.2 })

const indexSource = await readFile(new URL("../../../presets/telop/index.jsonl", import.meta.url), "utf8")
const ALL_CASES = indexSource.trim().split("\n").map((line) => JSON.parse(line).id).sort()
const IN_IDS = Object.entries(TEXTANIM_RECIPE_SLOTS).filter(([, slot]) => slot === "in").map(([id]) => id)
const LOOP_IDS = Object.entries(TEXTANIM_RECIPE_SLOTS).filter(([, slot]) => slot === "loop").map(([id]) => id)

function withoutAnimationDeclarations(doc) {
  return {
    ...structuredClone(doc),
    groups: doc.groups.filter((group) => group.id !== "anim"),
    variables: doc.variables.filter((variable) => !ANIMATION_KEYS.has(variable.key)),
  }
}

function withoutBakedAnimation(doc) {
  return {
    ...structuredClone(doc),
    layers: doc.layers.map((layer) => ({
      ...layer,
      tracks: [],
      ...(layer.perChar
        ? { perChar: { ...layer.perChar, tracks: [], loop: undefined } }
        : {}),
    })),
  }
}

function sampled(transform, layer, t, scene) {
  return transform(layer, t, scene.stage.duration, scene.timing)
}

function assertTransformClose(actual, expected, message) {
  const keys = new Set([...Object.keys(actual), ...Object.keys(expected)])
  for (const key of keys) {
    const a = actual[key]
    const b = expected[key]
    if (typeof a === "number" || typeof b === "number") {
      assert.ok(Math.abs(Number(a ?? 0) - Number(b ?? 0)) <= 1e-8,
        `${message}/${key}: ${String(a)} != ${String(b)}`)
    } else {
      assert.deepEqual(a, b, `${message}/${key}`)
    }
  }
}

test("textanim: original は全36テンプレで resolve 結果を一切変えない", async () => {
  const { resolve } = await resolveModule
  assert.equal(ALL_CASES.length, 36)
  for (const id of ALL_CASES) {
    const { doc } = await loadTelopPreset(PRESETS_ROOT, id)
    const baseline = resolve(withoutAnimationDeclarations(doc), {}, undefined, measure)
    const withDefaults = resolve(doc, {}, undefined, measure)
    assert.deepEqual(withDefaults, baseline, `${id}: original resolve parity`)
  }
})

test("textanim: in 38語彙は頭の系列を変化させ、hold では定常値へ戻る", async () => {
  const { resolve } = await resolveModule
  const { sampleLayerTransform } = await transformModule
  const { doc } = await loadTelopPreset(PRESETS_ROOT, "ref3_name_rounded")
  const clean = withoutBakedAnimation(doc)
  const baseline = resolve(withoutAnimationDeclarations(clean), {}, undefined, measure)
  const baseLayer = baseline.layers.find((layer) => layer.size.w > 0 && layer.size.h > 0)
  const baseStable = sampled(sampleLayerTransform, baseLayer, 1, baseline)

  assert.equal(IN_IDS.length, 38)
  for (const id of IN_IDS) {
    const scene = resolve(clean, { animIn: id, animOut: "none", animLoop: "none", animInSec: 0.6 }, undefined, measure)
    const layer = scene.layers.find((candidate) => candidate.id === baseLayer.id)
    const series = [0, 0.12, 0.24, 0.36, 0.48].map((t) => sampled(sampleLayerTransform, layer, t, scene))
    assert.ok(series.some((frame) => JSON.stringify(frame) !== JSON.stringify(baseStable)), `${id}: in 系列が不変です`)
    assertTransformClose(sampled(sampleLayerTransform, layer, 0.9, scene), baseStable, `${id}: hold`)
  }
})

test("textanim: loop 9語彙は hold 内で変化し、1.6秒周期で反復する", async () => {
  const { resolve } = await resolveModule
  const { sampleLayerTransform } = await transformModule
  const { doc } = await loadTelopPreset(PRESETS_ROOT, "ref3_name_rounded")
  const clean = withoutBakedAnimation(doc)

  assert.equal(LOOP_IDS.length, 9)
  for (const id of LOOP_IDS) {
    const scene = resolve(clean, { animIn: "none", animOut: "none", animLoop: id }, undefined, measure)
    const layer = scene.layers.find((candidate) => candidate.size.w > 0 && candidate.size.h > 0)
    const series = [0, 0.32, 0.64, 0.96, 1.28].map((t) => sampled(sampleLayerTransform, layer, t, scene))
    assert.ok(new Set(series.map((frame) => JSON.stringify(frame))).size > 1, `${id}: loop 系列が不変です`)
    assertTransformClose(
      sampled(sampleLayerTransform, layer, 1.6, scene),
      sampled(sampleLayerTransform, layer, 0, scene),
      `${id}: loop period`,
    )
  }
})

test("textanim: out は全 in 語彙で in の厳密な時間反転", async () => {
  const { resolve } = await resolveModule
  const { sampleLayerTransform } = await transformModule
  const { doc } = await loadTelopPreset(PRESETS_ROOT, "ref3_name_rounded")
  const clean = withoutBakedAnimation(doc)
  const duration = 0.6

  for (const id of IN_IDS) {
    const scene = resolve(clean, {
      animIn: id,
      animOut: id,
      animLoop: "none",
      animInSec: duration,
      animOutSec: duration,
    }, undefined, measure)
    const layer = scene.layers.find((candidate) => candidate.size.w > 0 && candidate.size.h > 0)
    for (const localT of [0, 0.12, 0.3, 0.48, 0.6]) {
      const inFrame = sampled(sampleLayerTransform, layer, duration - localT, scene)
      const outFrame = sampled(sampleLayerTransform, layer, scene.stage.duration - duration + localT, scene)
      assertTransformClose(outFrame, inFrame, `${id}/t=${localT}`)
    }
  }
})

test("textanim: none は焼き込み in/out/hold と perChar loop を除去して頭から定常表示", async () => {
  const { resolve } = await resolveModule
  const { sampleLayerTransform } = await transformModule
  const { doc } = await loadTelopPreset(PRESETS_ROOT, "ref3_hormozi_snap")
  const scene = resolve(doc, { animIn: "none", animOut: "none", animLoop: "none" }, undefined, measure)

  for (const layer of scene.layers) {
    assert.equal(layer.tracks?.length ?? 0, 0, `${layer.id}: layer track`)
    assert.equal(layer.perChar?.tracks?.length ?? 0, 0, `${layer.id}: perChar track`)
    assert.equal(layer.perChar?.loop, undefined, `${layer.id}: perChar loop`)
    const atHead = sampled(sampleLayerTransform, layer, 0, scene)
    assert.equal(atHead.x, layer.transform.x)
    assert.equal(atHead.y, layer.transform.y)
    assert.equal(atHead.opacity, layer.transform.opacity)
  }
})
