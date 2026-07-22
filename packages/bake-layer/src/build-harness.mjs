// build-harness — telop-entry.ts を esbuild でブラウザ注入用の 1 ファイル IIFE に束ねる。
// dist/ はビルド成果物なので gitignore 対象（毎回オンメモリでビルドし直す。235 件を焼いても
// エントリは 1 種類だけなのでプロセス内キャッシュで十分速い）。
//
// fx-entry.ts は 2026-07-22 司令塔裁定でスコープ除外（FX 移植中止）に伴い削除済み。
import { build } from "esbuild"
import { join } from "node:path"

const HARNESS_DIR = join(import.meta.dirname, "harness")

const cache = new Map()

async function bundle(entryFile) {
  if (cache.has(entryFile)) return cache.get(entryFile)
  const result = await build({
    entryPoints: [join(HARNESS_DIR, entryFile)],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "chrome124",
    logLevel: "silent",
  })
  const code = result.outputFiles[0].text
  cache.set(entryFile, code)
  return code
}

export function buildTelopHarness() {
  return bundle("telop-entry.ts")
}
