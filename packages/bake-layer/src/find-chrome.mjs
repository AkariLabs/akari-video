// find-chrome — puppeteer の pin バージョン(25.1.0 → chrome 150.x)が未ダウンロードでも、
// 既に ~/.cache/puppeteer/chrome/ にキャッシュ済みの近傍バージョンがあればそれを使う。
// 本 CLI はネットワークのない実行環境でも動く必要があるため、pin 厳密一致を要求しない
// （ATF/FxRuntime は canvas2d / WebGL2 の標準機能のみに依存し、Chrome の細かいバージョン
// 差では出力に実質差が出ない）。
import { existsSync, readdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const CACHE_ROOT = join(homedir(), ".cache", "puppeteer", "chrome")

/** インストール済み Chrome for Testing の実行ファイルパスを返す。無ければ null。 */
export function findCachedChrome() {
  if (!existsSync(CACHE_ROOT)) return null
  const versions = readdirSync(CACHE_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort() // "mac_arm-149.0.7827.22" 形式。文字列 sort で概ね昇順になる
  for (const versionDir of versions.reverse()) {
    const candidates = [
      join(CACHE_ROOT, versionDir, "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
      join(CACHE_ROOT, versionDir, "chrome-mac-x64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
      join(CACHE_ROOT, versionDir, "chrome-linux64", "chrome"),
      join(CACHE_ROOT, versionDir, "chrome-win64", "chrome.exe"),
    ]
    for (const c of candidates) {
      if (existsSync(c)) return c
    }
  }
  return null
}

/** puppeteer 既定の pin バージョンを優先しつつ、無ければキャッシュ済み近傍版へフォールバックする。 */
export async function resolveExecutablePath(puppeteer) {
  try {
    const pinned = await puppeteer.executablePath()
    if (pinned && existsSync(pinned)) return pinned
  } catch {
    // pin バージョン解決失敗は無視してフォールバックへ
  }
  const cached = findCachedChrome()
  if (cached) return cached
  throw new Error(
    "[bake-layer] Chrome for Testing が見つかりません。`npx puppeteer browsers install chrome` を実行してください。",
  )
}
