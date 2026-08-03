// render-session — harness バンドルをページへ注入し、フレームごとに PNG data URL を取り出す。
// fx 版（renderFxFrames）は 2026-07-22 司令塔裁定でスコープ除外に伴い削除済み。
import { buildTelopHarness } from "./build-harness.mjs"
import { registerBundledFonts } from "./fonts.mjs"

export async function renderTelopFrames(page, { doc, bindings = {}, aspect, size, duration, fps }) {
  const bundle = await buildTelopHarness()
  // 同梱フォントを先に登録する（harness の init は注入直後に実測するため、後からでは効かない）
  await registerBundledFonts(page, doc)
  await page.addScriptTag({ content: bundle })
  await page.evaluate(
    (docArg, bindingsArg, aspectArg) => {
      // @ts-expect-error window.__bakeTelop は harness バンドルが注入する
      window.__bakeHandle = window.__bakeTelop.init(docArg, bindingsArg, aspectArg)
    },
    doc,
    bindings,
    aspect,
  )

  const frameCount = Math.max(1, Math.ceil(duration * fps))
  const frames = []
  for (let i = 0; i < frameCount; i += 1) {
    const t = i / fps
    const dataUrl = await page.evaluate(
      (w, h, tArg, T) => {
        // @ts-expect-error init() が返した handle
        return window.__bakeHandle.renderFrame(w, h, tArg, T)
      },
      size.w,
      size.h,
      t,
      duration,
    )
    frames.push(dataUrl)
  }
  return frames
}
