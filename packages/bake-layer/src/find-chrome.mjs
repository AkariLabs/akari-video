// find-chrome — puppeteer の pin バージョン(25.1.0 → chrome 150.x)が未ダウンロードでも、
// 既に ~/.cache/puppeteer/chrome/ にキャッシュ済みの近傍バージョンがあればそれを使う。
// 本 CLI はネットワークのない実行環境でも動く必要があるため、pin 厳密一致を要求しない
// （ATF/FxRuntime は canvas2d / WebGL2 の標準機能のみに依存し、Chrome の細かいバージョン
// 差では出力に実質差が出ない）。
//
// フォールバック順: puppeteer pin 一致 → 近傍キャッシュ(上記) → playwright キャッシュ →
// システム Chrome（`akari chrome install` を一度も走らせていない配布先でも
// bake が完走するようにするため）。playwright / システム Chrome の候補列挙は
// packages/render-cut/src/render-cut.mjs の chromePathCandidates / defaultChromeSystemCandidates
// と同じアルゴリズムをここに複製したもの（bake-layer が render-cut に依存する向きを避けるため。
// 両者を同時に直す必要が出た場合は呼び出し元の report で申告する）。
import { constants as fsConstants, existsSync, readdirSync } from "node:fs"
import { access, readdir } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

/**
 * インストール済み Chrome for Testing の実行ファイルパスを返す。無ければ null。
 * `homeDirectory` は L0 検証（空の HOME を作って「配布先で見つからない」状態を再現する）のための
 * 差し替え口。既定は実際の `$HOME` なので本番の挙動は変わらない。
 */
export function findCachedChrome({ homeDirectory = homedir() } = {}) {
  const cacheRoot = join(homeDirectory, ".cache", "puppeteer", "chrome")
  if (!existsSync(cacheRoot)) return null
  const versions = readdirSync(cacheRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort() // "mac_arm-149.0.7827.22" 形式。文字列 sort で概ね昇順になる
  for (const versionDir of versions.reverse()) {
    const candidates = [
      join(cacheRoot, versionDir, "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
      join(cacheRoot, versionDir, "chrome-mac-x64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
      join(cacheRoot, versionDir, "chrome-linux64", "chrome"),
      join(cacheRoot, versionDir, "chrome-win64", "chrome.exe"),
    ]
    for (const c of candidates) {
      if (existsSync(c)) return c
    }
  }
  return null
}

// packages/render-cut/src/render-cut.mjs の defaultChromeSystemCandidates を複製。
function systemChromeCandidates({ env = process.env, platform = process.platform } = {}) {
  if (platform === "win32") {
    const programFiles = env.ProgramFiles || "C:\\Program Files"
    const programFilesX86 = env["ProgramFiles(x86)"] || "C:\\Program Files (x86)"
    const localAppData = env.LOCALAPPDATA
    const candidates = [
      join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
    ]
    if (localAppData) candidates.push(join(localAppData, "Google", "Chrome", "Application", "chrome.exe"))
    return candidates
  }
  return [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ]
}

// packages/render-cut/src/render-cut.mjs の versionedNestedCandidates を複製。
async function versionedNestedCandidates({ roots, versionPrefix = "", binaryPaths }) {
  const versions = []
  for (const root of roots) {
    for (const name of await directoryNames(root, (entry) => entry.startsWith(versionPrefix))) {
      versions.push({ root, name })
    }
  }
  const candidates = []
  for (const version of versions.sort((left, right) => right.name.localeCompare(left.name))) {
    const versionPath = join(version.root, version.name)
    for (const [directoryPattern, ...binaryPath] of binaryPaths) {
      const directories = await directoryNames(versionPath, (entry) => directoryPattern.test(entry))
      for (const directory of directories.sort((left, right) => right.localeCompare(left))) {
        candidates.push(join(versionPath, directory, ...binaryPath))
      }
    }
  }
  return candidates
}

async function directoryNames(path, matches) {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && matches(entry.name))
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

async function isExecutable(path) {
  try {
    await access(path, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

/** playwright キャッシュ配下の chromium-headless-shell 候補を列挙する（新しいバージョン優先）。 */
async function playwrightChromeCandidates({ env = process.env, homeDirectory = homedir(), platform = process.platform } = {}) {
  const playwrightRoot = platform === "win32"
    ? join(env.LOCALAPPDATA || join(homeDirectory, "AppData", "Local"), "ms-playwright")
    : platform === "darwin"
      ? join(homeDirectory, "Library", "Caches", "ms-playwright")
      : join(homeDirectory, ".cache", "ms-playwright")
  return versionedNestedCandidates({
    roots: [playwrightRoot],
    versionPrefix: "chromium_headless_shell-",
    binaryPaths: platform === "win32"
      ? [[/^chrome-headless-shell-win/u, "chrome-headless-shell.exe"]]
      : platform === "darwin"
        ? [[/^chrome-headless-shell-mac-/u, "chrome-headless-shell"]]
        : [[/^chrome-headless-shell-linux/u, "chrome-headless-shell"]],
  })
}

/**
 * puppeteer 既定の pin バージョンを優先しつつ、無ければ
 * 近傍キャッシュ → playwright キャッシュ → システム Chrome の順にフォールバックする。
 * どこにも見つからなければ、探索した候補を全部列挙したエラーを投げる。
 *
 * 第二引数は L0 検証専用の差し替え口（`homeDirectory` / `platform` / `env` / `systemCandidates`）。
 * すべて既定値は実環境（`homedir()` / `process.platform` / `process.env`）なので、
 * 呼び出し元（browser.mjs）を変更しない限り本番の挙動は変わらない。
 */
export async function resolveExecutablePath(
  puppeteer,
  { homeDirectory = homedir(), platform = process.platform, env = process.env, systemCandidates } = {},
) {
  const searched = []

  let pinned = null
  try {
    pinned = await puppeteer.executablePath()
  } catch {
    // pin バージョン解決失敗は無視してフォールバックへ
  }
  if (pinned) {
    searched.push(`${pinned} (puppeteer pin)`)
    if (existsSync(pinned)) return pinned
  }

  const cacheRoot = join(homeDirectory, ".cache", "puppeteer", "chrome")
  searched.push(`${cacheRoot}/<version>/... (近傍キャッシュ)`)
  const cached = findCachedChrome({ homeDirectory })
  if (cached) return cached

  const playwright = await playwrightChromeCandidates({ env, homeDirectory, platform })
  for (const candidate of playwright) {
    searched.push(`${candidate} (playwright cache)`)
    if (await isExecutable(candidate)) return candidate
  }
  if (playwright.length === 0) searched.push("(playwright cache: 候補なし)")

  const system = systemCandidates ?? systemChromeCandidates({ env, platform })
  for (const candidate of system) {
    searched.push(`${candidate} (system Chrome)`)
    if (await isExecutable(candidate)) return candidate
  }

  throw new Error(
    [
      "Chrome for Testing / Chromium / システム Chrome のいずれも見つかりません。",
      "以下を探しましたが見つかりませんでした:",
      ...searched.map((entry) => `  - ${entry}`),
      "`akari chrome install` を実行するか、システムに Google Chrome をインストールしてください。",
      "システムの node がある場合は `npx puppeteer browsers install chrome` でも導入できます。",
    ].join("\n"),
  )
}
