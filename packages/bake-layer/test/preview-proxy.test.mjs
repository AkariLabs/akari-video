import { spawn } from "node:child_process"
import { createServer } from "node:http"
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import assert from "node:assert/strict"
import { test } from "node:test"
import { launchBakeBrowser } from "../src/browser.mjs"
import { previewProxyPathForMov } from "../src/encode.mjs"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const CLI = join(REPO_ROOT, "packages/bake-layer/bin/bake-layer.mjs")

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })
    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) resolvePromise(stdout)
      else reject(new Error(`${command} exited ${code}\n${stderr.slice(-4000)}`))
    })
  })
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function inspectProxy(path) {
  const output = await run("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=codec_name:stream_tags=alpha_mode",
    "-of",
    "json",
    path,
  ])
  const [stream] = JSON.parse(output).streams
  return { codec: stream.codec_name, alphaMode: stream.tags?.alpha_mode ?? stream.tags?.ALPHA_MODE }
}

async function sampleAlphaInChromium(path) {
  const bytes = await readFile(path)
  const server = createServer((request, response) => {
    if (request.url === "/") {
      response.writeHead(200, { "content-type": "text/html" })
      response.end('<video id="sample" muted playsinline preload="auto" src="/asset.webm"></video>')
      return
    }
    if (request.url !== "/asset.webm") {
      response.writeHead(404).end()
      return
    }
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "")
    if (!range) {
      response.writeHead(200, {
        "accept-ranges": "bytes",
        "content-length": bytes.length,
        "content-type": "video/webm",
      })
      response.end(bytes)
      return
    }
    const start = Number(range[1])
    const end = range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1
    response.writeHead(206, {
      "accept-ranges": "bytes",
      "content-length": end - start + 1,
      "content-range": `bytes ${start}-${end}/${bytes.length}`,
      "content-type": "video/webm",
    })
    response.end(bytes.subarray(start, end + 1))
  })
  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise))
  const address = server.address()
  let browser
  try {
    browser = await launchBakeBrowser()
    const page = await browser.newPage()
    await page.goto(`http://127.0.0.1:${address.port}/`)
    return await page.evaluate(async () => {
      const video = document.getElementById("sample")
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        await new Promise((resolvePromise, reject) => {
          video.addEventListener("loadeddata", resolvePromise, { once: true })
          video.addEventListener("error", () => reject(video.error), { once: true })
        })
      }
      const target = Math.min(0.5, Math.max(0, video.duration / 2))
      if (target > 0) {
        await new Promise((resolvePromise) => {
          video.addEventListener("seeked", resolvePromise, { once: true })
          video.currentTime = target
        })
      }
      const canvas = document.createElement("canvas")
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const context = canvas.getContext("2d", { willReadFrequently: true })
      context.fillStyle = "rgb(255, 0, 255)"
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(video, 0, 0)
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
      let transparentBackgroundPixels = 0
      let visibleLayerPixels = 0
      for (let index = 0; index < pixels.length; index += 4) {
        const isBackground = pixels[index] > 245 && pixels[index + 1] < 10 && pixels[index + 2] > 245
        if (isBackground) transparentBackgroundPixels += 1
        else visibleLayerPixels += 1
      }
      return { transparentBackgroundPixels, visibleLayerPixels }
    })
  } finally {
    if (browser) await browser.close()
    await new Promise((resolvePromise) => server.close(resolvePromise))
  }
}

test("normal bake creates a VP9 alpha preview sidecar by default", { timeout: 120_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "bake-layer-proxy-default-"))
  try {
    const mov = join(directory, "default.mov")
    const stdout = await run(process.execPath, [
      CLI,
      "--kind",
      "telop",
      "--preset",
      "ref3_name_rounded",
      "--params",
      "{}",
      "--duration",
      "1",
      "--size",
      "640x360",
      "--fps",
      "4",
      "--out",
      mov,
    ])
    const result = JSON.parse(stdout.trim())
    const proxy = previewProxyPathForMov(mov)
    assert.equal(result.previewProxy, proxy)
    assert.equal(await exists(mov), true)
    assert.equal(await exists(proxy), true)
    assert.deepEqual(await inspectProxy(proxy), { codec: "vp9", alphaMode: "1" })
    const sample = await sampleAlphaInChromium(proxy)
    assert.ok(sample.transparentBackgroundPixels > 0, "transparent pixels must reveal the magenta canvas")
    assert.ok(sample.visibleLayerPixels > 0, "visible telop pixels must differ from the magenta canvas")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("--no-preview-proxy keeps normal bake mov-only", { timeout: 120_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "bake-layer-proxy-disabled-"))
  try {
    const mov = join(directory, "disabled.MOV")
    const stdout = await run(process.execPath, [
      CLI,
      "--kind",
      "telop",
      "--preset",
      "ref3_name_rounded",
      "--params",
      "{}",
      "--duration",
      "0.25",
      "--size",
      "320x180",
      "--fps",
      "4",
      "--out",
      mov,
      "--no-preview-proxy",
    ])
    const result = JSON.parse(stdout.trim())
    assert.equal(result.previewProxy, undefined)
    assert.equal(await exists(mov), true)
    assert.equal(await exists(previewProxyPathForMov(mov)), false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("--proxy-only creates a sidecar from an existing alpha mov", { timeout: 60_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "bake-layer-proxy-only-"))
  try {
    const raw = join(directory, "texture.rgba")
    const mov = join(directory, "texture.mov")
    const width = 64
    const height = 32
    const frame = Buffer.alloc(width * height * 4)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4
        frame[offset] = x < width / 2 ? 255 : 0
        frame[offset + 1] = x < width / 2 ? 0 : 255
        frame[offset + 2] = 0
        frame[offset + 3] = x < width / 2 ? 0 : 255
      }
    }
    await writeFile(raw, Buffer.concat([frame, frame]))
    await run("ffmpeg", [
      "-y",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgba",
      "-s",
      `${width}x${height}`,
      "-r",
      "2",
      "-i",
      raw,
      "-c:v",
      "prores_ks",
      "-profile:v",
      "4",
      "-pix_fmt",
      "yuva444p10le",
      mov,
    ])
    const stdout = await run(process.execPath, [CLI, "--proxy-only", mov])
    const result = JSON.parse(stdout.trim())
    const proxy = previewProxyPathForMov(mov)
    assert.equal(result.proxyOnly, true)
    assert.equal(result.previewProxy, proxy)
    assert.equal(await exists(proxy), true)
    assert.deepEqual(await inspectProxy(proxy), { codec: "vp9", alphaMode: "1" })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
