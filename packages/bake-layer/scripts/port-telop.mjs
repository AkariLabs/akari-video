// port-telop — 旧 akari-telop の wave3 / wave3b テンプレ（235 件）を presets/telop/ へ全件機械移植する。
// 各テンプレの本体（AtfDoc）を template.json に、1 行メタデータを index.jsonl に書く（契約 §1.3）。
// 旧リポは読み取り専用（絶対パスで直接 import するのみ・書き込みは一切しない）。
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { importTsBundle } from "./lib/load-ts-bundle.mjs"
import { CURATED_TELOP_TAGS } from "./curated-telop.mjs"

// 移植元 checkout の位置は環境依存 — 再移植時は AKARI_TELOP_REPO で自分の checkout を指す
const TELOP_REPO = process.env.AKARI_TELOP_REPO
if (!TELOP_REPO) {
  console.error("AKARI_TELOP_REPO=<akari-telop checkout のパス> を指定してください")
  process.exit(1)
}
const TELOP_COMMIT = "f2519143ad27bfa67463df2bf3c461ab6a7fa685"
const PRESETS_TELOP = join(import.meta.dirname, "..", "..", "..", "presets", "telop")

async function buildIdToSourceMap() {
  const map = new Map()
  for (const wave of ["wave3", "wave3b"]) {
    const dir = join(TELOP_REPO, "src", "samples", wave)
    for (const name of await readdir(dir)) {
      if (name.endsWith(".test.ts") || name === "index.ts") continue
      if (!name.endsWith(".ts")) continue
      const content = await readFile(join(dir, name), "utf8")
      const idMatches = [...content.matchAll(/id:\s*['"]([^'"]+)['"]/g)]
      for (const m of idMatches) {
        if (!map.has(m[1])) map.set(m[1], { wave, filename: name, content })
      }
    }
  }
  return map
}

/** 各ファイル先頭の連続コメント行を抽出する。 */
function extractLeadingComment(content) {
  const lines = content.split("\n")
  const commentLines = []
  for (const line of lines) {
    const s = line.trim()
    if (s.startsWith("//")) {
      commentLines.push(s.slice(2).trim())
    } else if (s === "") {
      if (commentLines.length > 0) break
      continue
    } else {
      break
    }
  }
  return commentLines
}

/** 先頭コメントから短い name を作る（filename 接頭辞 / id 括弧書きを除去し、最初の意味段落だけ残す）。 */
function deriveName(commentLines, id) {
  if (commentLines.length === 0) return id
  const first = commentLines[0]
  let name = first
    .replace(/^[\w.\-]+\.ts\s*[—-]\s*/u, "") // "xxx.ts — " prefix
    .replace(/^[\w.\-]+\.ts\s+/u, "") // "xxx.ts " prefix (no dash)
    .replace(/[（(][^）)]*\)|[（(][^）)]*）/u, (m) => (m.includes(id) ? "" : m)) // id を含む括弧書きを削除
    .trim()
  if (!name) name = id
  return name
}

/** id から機械変換タグを作る（ref3_ / ref3_tl_ 接頭辞・研究バッチ番号(r1s3 等)・純数値トークンを除外）。 */
function autoTagsFromId(id, kind) {
  const stripped = id.replace(/^ref3_(tl_)?/, "").replace(/^tmpl_/, "")
  const tokens = stripped
    .split("_")
    .filter((t) => t && !/^r\d+s\d+$/.test(t) && !/^\d+$/.test(t) && t.length > 1)
  return [...new Set([...tokens, kind])]
}

async function main() {
  await mkdir(PRESETS_TELOP, { recursive: true })
  const idToSource = await buildIdToSourceMap()

  const { wave3Templates } = await importTsBundle(join(TELOP_REPO, "src", "samples", "wave3", "index.ts"))
  const { wave3bTemplates } = await importTsBundle(join(TELOP_REPO, "src", "samples", "wave3b", "index.ts"))
  const docs = [...wave3Templates, ...wave3bTemplates]

  const indexLines = []
  let curatedCount = 0

  for (const doc of docs) {
    const src = idToSource.get(doc.id)
    const commentLines = src ? extractLeadingComment(src.content) : []
    const name = deriveName(commentLines, doc.id)
    const curatedTags = CURATED_TELOP_TAGS[doc.id]
    const tagQuality = curatedTags ? "curated" : "auto"
    if (curatedTags) curatedCount += 1
    const tags = curatedTags ?? autoTagsFromId(doc.id, doc.kind)

    const dir = join(PRESETS_TELOP, doc.id)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, "template.json"), JSON.stringify(doc, null, 2) + "\n")

    const entry = {
      id: doc.id,
      kind: "telop",
      category: doc.kind, // ATF の kind（lower-third/caption/popup/corner/free）
      name,
      tags,
      tag_quality: tagQuality,
      params: doc.variables.map((v) => ({ key: v.key, type: v.type, label: v.label, default: v.default })),
      animated: doc.layers.some(
        (l) => (Array.isArray(l.tracks) && l.tracks.length > 0) || l.perChar?.tracks?.length > 0 || l.perChar?.loop,
      ),
      source: {
        repo: "akari-telop",
        commit: TELOP_COMMIT,
        path: src ? `src/samples/${src.wave}/${src.filename}` : null,
      },
    }
    indexLines.push(JSON.stringify(entry))
  }

  await writeFile(join(PRESETS_TELOP, "index.jsonl"), indexLines.join("\n") + "\n")

  console.log(
    JSON.stringify({
      ok: true,
      totalPorted: docs.length,
      curated: curatedCount,
      auto: docs.length - curatedCount,
    }),
  )
}

main().catch((err) => {
  console.error("[port-telop] failed:", err)
  process.exitCode = 1
})
