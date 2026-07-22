// encode — PNG連番 → アルファ付き ProRes4444 .mov（旧 png-seq-mov.ts / Rust shell 側 ffmpeg 呼び出しと
// 同型。本 CLI は Tauri IPC を経由せず直接 ffmpeg を spawn する）。
import { spawn } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * @param {string[]} pngFrames base64 PNG（data URL の "data:image/png;base64," 以降 or 生base64）の配列
 * @param {{ fps: number, out: string }} opts
 */
export async function encodePngSeqToProResMov(pngFrames, opts) {
  const { fps, out } = opts
  const workDir = await mkdtemp(join(tmpdir(), "bake-layer-"))
  try {
    let i = 0
    for (const frame of pngFrames) {
      const b64 = frame.startsWith("data:") ? frame.slice(frame.indexOf(",") + 1) : frame
      const buf = Buffer.from(b64, "base64")
      const name = `frame-${String(i).padStart(6, "0")}.png`
      await writeFile(join(workDir, name), buf)
      i += 1
    }

    // -pix_fmt yuva444p10le + prores_ks -profile:v 4 = ProRes 4444（アルファチャンネル保持）の定番構成。
    const args = [
      "-y",
      "-framerate",
      String(fps),
      "-i",
      join(workDir, "frame-%06d.png"),
      "-c:v",
      "prores_ks",
      "-profile:v",
      "4",
      "-pix_fmt",
      "yuva444p10le",
      "-alpha_bits",
      "16",
      "-vendor",
      "apl0",
      out,
    ]
    await runFfmpeg(args)
    return { out, frameCount: pngFrames.length }
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] })
    let stderr = ""
    child.stderr.on("data", (d) => {
      stderr += d.toString()
    })
    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exited ${code}\n${stderr.slice(-4000)}`))
    })
  })
}
