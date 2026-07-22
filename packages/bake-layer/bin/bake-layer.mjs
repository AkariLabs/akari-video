#!/usr/bin/env node
// bake-layer CLI — 契約 §1.1（planning/contract-2026-07-22-prerender-rail-and-assets.md）の
// インターフェースをそのまま実装する。
//
//   node bake-layer.mjs --kind telop|fx --preset <id> --params <json> \
//     --duration <sec> --size WxH --fps <n> --out <path.mov>
//
// 出力: アルファ付き ProRes4444 .mov。
//
// --kind fx は 2026-07-22 司令塔裁定でスコープ除外（オーナー判断「FX は使えないものが多いので
// なしでいい」）。インターフェース（--kind の選択肢）は契約どおり telop|fx を残すが、fx の実装は
// 未着手 — 呼び出すと明示的な未対応エラーを返す（将来「厳選少数だけ入れる」判断の余地を残す）。
import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import { launchBakeBrowser, withBakePage } from "../src/browser.mjs"
import { loadTelopPreset, resolveCatalogRoot } from "../src/catalog.mjs"
import { encodePngSeqToProResMov } from "../src/encode.mjs"
import { renderTelopFrames } from "../src/render-session.mjs"

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const tok = argv[i]
    if (!tok.startsWith("--")) continue
    const key = tok.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith("--")) {
      args[key] = true
    } else {
      args[key] = next
      i += 1
    }
  }
  return args
}

function parseSize(sizeStr) {
  const m = /^(\d+)x(\d+)$/i.exec(sizeStr ?? "")
  if (!m) throw new Error(`[bake-layer] --size は WxH 形式で指定してください（例: 1920x1080）: ${sizeStr}`)
  return { w: Number(m[1]), h: Number(m[2]) }
}

/** サイズから ATF の byAspect キー相当を推定する（16:9 / 9:16 / 1:1 のみ判定・それ以外は undefined）。 */
function deriveAspect(size) {
  const ratio = size.w / size.h
  const close = (target) => Math.abs(ratio - target) < 0.02
  if (close(16 / 9)) return undefined // 16:9 は doc のデフォルト stage なので明示不要
  if (close(9 / 16)) return "9:16"
  if (close(1)) return "1:1"
  return undefined
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const kind = args.kind
  const presetId = args.preset
  const out = args.out
  const duration = Number(args.duration ?? 3)
  const fps = Number(args.fps ?? 30)
  const size = parseSize(args.size ?? "1920x1080")
  const params = args.params ? JSON.parse(args.params) : {}
  const catalogRoot = resolveCatalogRoot(args.catalog)

  if (kind !== "telop" && kind !== "fx") {
    throw new Error(`[bake-layer] --kind は telop|fx のいずれか: ${kind}`)
  }
  if (kind === "fx") {
    throw new Error(
      "[bake-layer] --kind fx は未対応です（2026-07-22 司令塔裁定でスコープ除外。" +
        "catalog/fx は作られていません。telop のみ対応）。",
    )
  }
  if (!presetId) throw new Error("[bake-layer] --preset は必須です")
  if (!out) throw new Error("[bake-layer] --out は必須です")

  const startedAt = Date.now()
  await mkdir(dirname(out), { recursive: true })

  const browser = await launchBakeBrowser()
  try {
    const { doc } = await loadTelopPreset(catalogRoot, presetId)
    const aspect = deriveAspect(size)
    const frames = await withBakePage(browser, size, (page) =>
      renderTelopFrames(page, { doc, bindings: params, aspect, size, duration, fps }),
    )

    const { frameCount } = await encodePngSeqToProResMov(frames, { fps, out })
    const elapsedMs = Date.now() - startedAt
    console.log(
      JSON.stringify({
        ok: true,
        kind,
        preset: presetId,
        out,
        frameCount,
        fps,
        size,
        durationSec: duration,
        elapsedMs,
      }),
    )
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error(`[bake-layer] failed: ${err.stack ?? err.message}`)
  process.exitCode = 1
})
