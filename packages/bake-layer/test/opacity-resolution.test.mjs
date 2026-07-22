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

const measure = () => ({ width: 0, height: 0 })

function shape(id, opacity) {
  return {
    id,
    type: "shape",
    content: { shape: "rect", fill: "#ffffff" },
    transform: {
      x: 0,
      y: 0,
      anchor: { x: 0, y: 0 },
      ...(opacity === undefined ? {} : { opacity }),
    },
    size: { w: 100, h: 50 },
  }
}

function docWithLayers(layers) {
  return {
    format: "atf",
    version: "0.2",
    id: "opacity-resolution",
    kind: "free",
    stage: { width: 1920, height: 1080, fps: 30, duration: 1, bg: "transparent" },
    variables: [{ key: "alpha", type: "number", label: "Opacity", default: 0.4 }],
    layers,
  }
}

test("resolve preserves a literal opacity of zero", async () => {
  const { resolve } = await resolveModule
  const scene = resolve(docWithLayers([shape("literal-zero", 0)]), {}, undefined, measure)

  assert.equal(scene.layers[0].transform.opacity, 0)
})

test("resolve defaults an omitted opacity to one", async () => {
  const { resolve } = await resolveModule
  const scene = resolve(docWithLayers([shape("omitted")]), {}, undefined, measure)

  assert.equal(scene.layers[0].transform.opacity, 1)
})

test("resolve continues to support variable and expression opacity Values", async () => {
  const { resolve } = await resolveModule
  const scene = resolve(
    docWithLayers([
      shape("variable", { var: "alpha" }),
      shape("expression", { expr: "@base.width / 200" }),
      shape("base"),
    ]),
    {},
    undefined,
    measure,
  )

  assert.equal(scene.layers.find((layer) => layer.id === "variable").transform.opacity, 0.4)
  assert.equal(scene.layers.find((layer) => layer.id === "expression").transform.opacity, 0.5)
})
