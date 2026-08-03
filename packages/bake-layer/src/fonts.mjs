// fonts — 同梱フォント（リポルート assets/font）を bake ページの document.fonts へ登録する。
//
// bake は about:blank へのスクリプト注入で canvas 描画するだけなので @font-face を持つ
// ページが存在せず、従来はテンプレの font 指定（'Noto Sans JP' 等）が OS のフォールバック
// フォントで解決されていた（Noto 系が未インストールの環境では字形・字幅が非決定。
// 英数字混じりの実測幅は macOS フォールバック比で 10% 以上ずれる）。
// ここで FontFace 登録して実測（OffscreenCanvas 含む・可視確認済み）と描画の両方を
// 同梱フォントへ固定し、bake をマシン非依存の決定論にする。
//
// doc に family 名が現れるフォントだけ読む（Variable TTF は 1 本 10MB 超のため、
// 全部読むと CDP 転送だけで数秒かかる）。
import { readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"

// packages/bake-layer/src/fonts.mjs から見て ../../../assets/font がリポルートの同梱フォント
const DEFAULT_FONT_ROOT = join(import.meta.dirname, "..", "..", "..", "assets", "font")

// aliases: テンプレ側の表記ゆれ（旧 Google Fonts 名 'Rounded Mplus 1c' 等）。
// フォントスタックの後段に正式名が併記されているが、先頭一致で解決できるよう別名でも登録する。
const FONT_SPECS = [
  {
    family: "Noto Sans JP",
    aliases: [],
    weight: "100 900",
    rel: "noto-sans-jp/NotoSansJP-Variable.ttf",
  },
  {
    family: "Noto Serif JP",
    aliases: [],
    weight: "100 900",
    rel: "noto-serif-jp/NotoSerifJP-Variable.ttf",
  },
  { family: "M PLUS Rounded 1c", aliases: ["Rounded Mplus 1c"], weight: "500", rel: "mplus-rounded-1c/MPLUSRounded1c-Medium.ttf" },
  { family: "M PLUS Rounded 1c", aliases: ["Rounded Mplus 1c"], weight: "800", rel: "mplus-rounded-1c/MPLUSRounded1c-ExtraBold.ttf" },
  { family: "M PLUS Rounded 1c", aliases: ["Rounded Mplus 1c"], weight: "900", rel: "mplus-rounded-1c/MPLUSRounded1c-Black.ttf" },
  // 2026-08-03 拡充（オーナー裁定「全部入れ」・fontFamily ツマミの選択肢）
  { family: "BIZ UDGothic", aliases: [], weight: "400", rel: "biz-udgothic/BIZUDGothic-Regular.ttf" },
  { family: "BIZ UDGothic", aliases: [], weight: "700", rel: "biz-udgothic/BIZUDGothic-Bold.ttf" },
  { family: "Dela Gothic One", aliases: [], weight: "400", rel: "dela-gothic-one/DelaGothicOne-Regular.ttf" },
  { family: "Zen Maru Gothic", aliases: [], weight: "400", rel: "zen-maru-gothic/ZenMaruGothic-Regular.ttf" },
  { family: "Zen Maru Gothic", aliases: [], weight: "700", rel: "zen-maru-gothic/ZenMaruGothic-Bold.ttf" },
  { family: "Shippori Mincho", aliases: [], weight: "400", rel: "shippori-mincho/ShipporiMincho-Regular.ttf" },
  { family: "DotGothic16", aliases: [], weight: "400", rel: "dotgothic16/DotGothic16-Regular.ttf" },
  { family: "Klee One", aliases: [], weight: "400", rel: "klee-one/KleeOne-Regular.ttf" },
]

/** doc（ATF ドキュメント）が参照するフォント family を含む spec だけに絞る */
export function specsForDoc(doc, specs = FONT_SPECS) {
  const haystack = JSON.stringify(doc)
  return specs.filter(
    (spec) => haystack.includes(spec.family) || spec.aliases.some((alias) => haystack.includes(alias)),
  )
}

/**
 * doc が参照する同梱フォントをページへ登録する。
 * フォントファイルが無い環境では警告してスキップ（bake 自体は従来どおり続行）。
 * @returns 登録した family/weight のリスト
 */
export async function registerBundledFonts(page, doc, fontRoot = DEFAULT_FONT_ROOT) {
  const loaded = []
  for (const spec of specsForDoc(doc)) {
    const path = join(fontRoot, spec.rel)
    if (!existsSync(path)) {
      console.warn(`[bake-layer] bundled font not found, falling back to system fonts: ${path}`)
      continue
    }
    const dataB64 = (await readFile(path)).toString("base64")
    const families = [spec.family, ...spec.aliases]
    await page.evaluate(
      async (familiesArg, weight, b64) => {
        const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
        for (const family of familiesArg) {
          const face = new FontFace(family, bin.buffer, { weight })
          await face.load()
          document.fonts.add(face)
        }
      },
      families,
      spec.weight,
      dataB64,
    )
    for (const family of families) loaded.push(`${family} ${spec.weight}`)
  }
  return loaded
}
