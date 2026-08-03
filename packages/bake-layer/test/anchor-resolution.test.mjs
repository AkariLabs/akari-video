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

const measure = (text, _font, size) => ({ width: text.length * size * 0.6, height: size * 1.2 })

function makeDoc(anchor) {
  return {
    format: "atf",
    version: "0.2",
    id: "anchor_probe",
    kind: "caption",
    stage: { width: 1000, height: 600, fps: 30, duration: 2, bg: "transparent" },
    anchor,
    variables: [
      { key: "text", type: "text", label: "本文", default: "標準" },
      { key: "posX", type: "number", label: "X", default: 0 },
      { key: "posY", type: "number", label: "Y", default: 0 },
    ],
    layers: [
      {
        id: "plate",
        type: "shape",
        content: { shape: "rect", fill: "#000000" },
        size: { w: 400, h: 120 },
        transform: { x: 100, y: 200, anchor: { x: 0, y: 0 } },
      },
      {
        id: "text",
        type: "text",
        content: { text: { var: "text" }, size: 40, color: "#ffffff" },
        transform: { x: 140, y: 260, anchor: { x: 0, y: 0.5 } },
      },
    ],
  }
}

function bbox(layers) {
  const boxes = layers.map((layer) => {
    const left = layer.transform.x - layer.transform.anchor.x * layer.size.w
    const top = layer.transform.y - layer.transform.anchor.y * layer.size.h
    return { left, top, right: left + layer.size.w, bottom: top + layer.size.h }
  })
  return {
    left: Math.min(...boxes.map((box) => box.left)),
    top: Math.min(...boxes.map((box) => box.top)),
    right: Math.max(...boxes.map((box) => box.right)),
    bottom: Math.max(...boxes.map((box) => box.bottom)),
  }
}

test("anchor 未宣言の ad-hoc doc は従来座標を一切変更しない", async () => {
  const { resolve } = await resolveModule
  const scene = resolve(makeDoc(undefined), { posX: 300, posY: -400 }, undefined, measure)
  assert.deepEqual(scene.layers.map((layer) => [layer.transform.x, layer.transform.y]), [[100, 200], [140, 260]])
})

test("anchor=mc / pos=(0,0) は自然 bbox 中心を stage 中心へ移す", async () => {
  const { resolve } = await resolveModule
  const scene = resolve(makeDoc("mc"), {}, undefined, measure)
  const box = bbox(scene.layers)
  assert.equal((box.left + box.right) / 2, 500)
  assert.equal((box.top + box.bottom) / 2, 300)
})

test("面積 0 の不可視レイヤーはテンプレート全体のアンカーを歪めない", async () => {
  const { resolve } = await resolveModule
  const doc = makeDoc("mc")
  doc.layers.unshift({
    id: "empty-progress",
    type: "shape",
    content: { shape: "rect", fill: "#ffffff" },
    size: { w: 0, h: 20 },
    transform: { x: 0, y: 0, anchor: { x: 0, y: 0 } },
  })
  const scene = resolve(doc, {}, undefined, measure)
  const visibleBox = bbox(scene.layers.filter((layer) => layer.size.w > 0 && layer.size.h > 0))
  assert.equal((visibleBox.left + visibleBox.right) / 2, 500)
  assert.equal((visibleBox.top + visibleBox.bottom) / 2, 300)
})

test("文字列 binding の posX / posY でも全レイヤーが同じ差分で剛体移動する", async () => {
  const { resolve } = await resolveModule
  const base = resolve(makeDoc("mc"), {}, undefined, measure)
  const moved = resolve(makeDoc("mc"), { posX: "300", posY: "-400" }, undefined, measure)
  for (let index = 0; index < base.layers.length; index += 1) {
    assert.equal(moved.layers[index].transform.x - base.layers[index].transform.x, 300)
    assert.equal(moved.layers[index].transform.y - base.layers[index].transform.y, -400)
  }
})

test("文言が伸びても tl アンカー点は固定される", async () => {
  const { resolve } = await resolveModule
  const doc = makeDoc("tl")
  doc.layers = [doc.layers[1]]
  const shortBox = bbox(resolve(doc, { text: "字" }, undefined, measure).layers)
  const longBox = bbox(resolve(doc, { text: "とても長いテキストです" }, undefined, measure).layers)
  assert.deepEqual([shortBox.left, shortBox.top], [longBox.left, longBox.top])
})
