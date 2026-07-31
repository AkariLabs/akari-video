// verify-l2 — 代表 telop 3 件を実際に bake CLI で焼き、アルファ・アニメーション進行を
// フレーム実測する（task.md L2 完了契約。2026-07-22 司令塔裁定で fx 3 件は取り下げ済み）。
// 実行: node scripts/verify-l2.mjs --out-dir <dir>
import { spawn } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { resolveFfmpeg } from "../../media-bin/src/index.mjs"

const BIN = join(import.meta.dirname, "..", "bin", "bake-layer.mjs")
const FFMPEG = resolveFfmpeg()

const CASES = [
  { kind: "telop", preset: "ref3_name_rounded", label: "人名スーパー（lower-third）" },
  { kind: "telop", preset: "ref3_neon_stream", label: "ネオン発光 caption（glow/shadow 検証）" },
  { kind: "telop", preset: "ref3_emotion_rage", label: "バラエティ感情 popup" },
]

const DURATION = 2
const FPS = 30
const SIZE = "1920x1080"

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (d) => (stdout += d.toString()))
    child.stderr.on("data", (d) => (stderr += d.toString()))
    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`${cmd} ${args.join(" ")} exited ${code}\n${stderr}`))
    })
  })
}

async function extractFramePng(movPath, frameIdx, outPng) {
  await run(FFMPEG, ["-y", "-i", movPath, "-vf", `select=eq(n\\,${frameIdx})`, "-vframes", "1", "-update", "1", outPng])
}

async function alphaStats(pngPath) {
  const { stdout } = await run("magick", [pngPath, "-channel", "A", "-separate", "-format", "%[fx:mean] %[fx:minima] %[fx:maxima]", "info:"])
  const [mean, min, max] = stdout.trim().split(/\s+/).map(Number)
  return { mean, min, max }
}

async function rmseDiff(pngA, pngB) {
  try {
    await run("magick", ["compare", "-metric", "RMSE", pngA, pngB, "null:"])
    return 0 // 完全一致（compare は差分ありだと exit 1 で reject される）
  } catch (e) {
    const m = /\(([\d.]+)\)/.exec(e.message)
    return m ? Number(m[1]) : null
  }
}

async function main() {
  const args = process.argv.slice(2)
  const outDirIdx = args.indexOf("--out-dir")
  const outDir = outDirIdx >= 0 ? args[outDirIdx + 1] : join(import.meta.dirname, "..", "..", "..", "..", "l2-out")
  await mkdir(outDir, { recursive: true })

  const results = []
  for (const c of CASES) {
    const movPath = join(outDir, `${c.kind}-${c.preset}.mov`)
    const startedAt = Date.now()
    const { stdout } = await run("node", [
      BIN,
      "--kind",
      c.kind,
      "--preset",
      c.preset,
      "--params",
      "{}",
      "--duration",
      String(DURATION),
      "--size",
      SIZE,
      "--fps",
      String(FPS),
      "--out",
      movPath,
    ])
    const wallMs = Date.now() - startedAt
    const bakeResult = JSON.parse(stdout.trim().split("\n").pop())

    const frameCount = bakeResult.frameCount
    const idxStart = 2
    const idxMid = Math.floor(frameCount / 2)
    const idxEnd = frameCount - 3
    const pngStart = join(outDir, `${c.kind}-${c.preset}-f${idxStart}.png`)
    const pngMid = join(outDir, `${c.kind}-${c.preset}-f${idxMid}.png`)
    const pngEnd = join(outDir, `${c.kind}-${c.preset}-f${idxEnd}.png`)
    await extractFramePng(movPath, idxStart, pngStart)
    await extractFramePng(movPath, idxMid, pngMid)
    await extractFramePng(movPath, idxEnd, pngEnd)

    const alphaStart = await alphaStats(pngStart)
    const alphaMid = await alphaStats(pngMid)
    const alphaEnd = await alphaStats(pngEnd)
    const rmseStartMid = await rmseDiff(pngStart, pngMid)
    const rmseMidEnd = await rmseDiff(pngMid, pngEnd)

    results.push({
      kind: c.kind,
      preset: c.preset,
      label: c.label,
      mov: movPath,
      frameCount,
      bakeElapsedMs: bakeResult.elapsedMs,
      wallMs,
      alpha: { start: alphaStart, mid: alphaMid, end: alphaEnd },
      hasAlpha: alphaStart.max > 0.01 || alphaMid.max > 0.01 || alphaEnd.max > 0.01,
      animationProgress: { rmseStartToMid: rmseStartMid, rmseMidToEnd: rmseMidEnd },
      animationDetected: (rmseStartMid ?? 0) > 1 || (rmseMidEnd ?? 0) > 1,
    })
    console.log(`[verify-l2] ${c.kind}/${c.preset} done in ${wallMs}ms (bake=${bakeResult.elapsedMs}ms)`)
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    cases: results,
    avgBakeElapsedMs: Math.round(results.reduce((s, r) => s + r.bakeElapsedMs, 0) / results.length),
  }
  await writeFile(join(outDir, "l2-summary.json"), JSON.stringify(summary, null, 2) + "\n")
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((err) => {
  console.error("[verify-l2] failed:", err)
  process.exitCode = 1
})
