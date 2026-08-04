// telop-entry — bake CLI がヘッドレスブラウザに注入するエントリ。
// vendor/telop（旧 akari-telop の src/atf + src/render をソース同梱）を直接呼び、
// AtfDoc を resolve → drawScene で canvas 2D に焼く。esbuild で 1 ファイルに束ねて
// ページへ注入する（build.mjs 参照）。
import { resolve } from "../../vendor/telop/atf/resolve"
import { canvasMeasure } from "../../vendor/telop/atf/measure"
import { drawScene } from "../../vendor/telop/render/canvas2d"
import type { AtfDoc, ResolvedScene, VariableValue } from "../../vendor/telop/atf/types"

interface BakeTelopHandle {
  renderFrame(w: number, h: number, t: number, T: number): string
}

declare global {
  interface Window {
    __bakeTelop?: {
      init(doc: AtfDoc, bindings: Record<string, VariableValue>, aspect: string | undefined): BakeTelopHandle
      resolve(doc: AtfDoc, bindings: Record<string, VariableValue>, aspect: string | undefined): ResolvedScene
    }
  }
}

function resolveScene(
  doc: AtfDoc,
  bindings: Record<string, VariableValue>,
  aspect: string | undefined,
): ResolvedScene {
  return resolve(doc, bindings, aspect, canvasMeasure)
}

function init(doc: AtfDoc, bindings: Record<string, VariableValue>, aspect: string | undefined): BakeTelopHandle {
  const scene = resolveScene(doc, bindings, aspect)
  // ATF レイヤーは scene.stage.width/height の座標系に絶対配置される（byAspect 解決済み）。
  // --size が doc のネイティブ解像度と異なる場合に備え、ネイティブ解像度で描いてから
  // 出力サイズへ高品質スケールする（旧 telop-prerender.ts のスーパーサンプリング縮小と同じ考え方）。
  const native = document.createElement("canvas")
  native.width = scene.stage.width
  native.height = scene.stage.height
  const nctx = native.getContext("2d", { alpha: true })
  if (!nctx) throw new Error("telop-entry: 2d context unavailable")

  const out = document.createElement("canvas")
  out.id = "bake-stage"
  document.body.appendChild(out)
  const octx = out.getContext("2d", { alpha: true })
  if (!octx) throw new Error("telop-entry: 2d context unavailable")

  return {
    renderFrame(w: number, h: number, t: number, T: number): string {
      nctx.clearRect(0, 0, native.width, native.height)
      drawScene(nctx, scene, t, T)

      if (out.width !== w) out.width = w
      if (out.height !== h) out.height = h
      octx.clearRect(0, 0, w, h)
      if (w === native.width && h === native.height) {
        octx.drawImage(native, 0, 0)
      } else {
        octx.imageSmoothingEnabled = true
        octx.imageSmoothingQuality = "high"
        octx.drawImage(native, 0, 0, w, h)
      }
      return out.toDataURL("image/png")
    },
  }
}

window.__bakeTelop = { init, resolve: resolveScene }
