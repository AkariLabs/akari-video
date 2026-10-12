import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { verifyLeadingGap } from "../src/verify-leading-gap.mjs";

const repo = resolve(import.meta.dirname, "../../..");
const fps = 10;
const width = 128;
const height = 72;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 180_000,
    maxBuffer: 8 * 1024 * 1024, ...options });
  assert.equal(result.status, 0, `${command}: ${result.error?.message ?? result.stderr}`);
  return result.stdout;
}

function available(command) {
  return spawnSync(command, ["-version"], { timeout: 10_000 }).status === 0;
}

function firstBlueFrame(path) {
  const pixels = run("ffmpeg", ["-v", "error", "-i", path, "-map", "0:v:0",
    "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { encoding: null });
  const stride = width * height * 3;
  assert.equal(pixels.length % stride, 0);
  for (let frame = 0; frame < pixels.length / stride; frame++) {
    const pixel = frame * stride + (Math.floor(height / 2) * width + Math.floor(width / 2)) * 3;
    if (pixels[pixel + 2] > 90 && pixels[pixel + 2] > pixels[pixel + 1] * 1.4) return frame;
  }
  throw new Error("blue source marker absent from output");
}

function firstBeepSecond(path) {
  const pcm = run("ffmpeg", ["-v", "error", "-i", path, "-map", "0:a:0",
    "-ac", "1", "-ar", "48000", "-f", "f32le", "pipe:1"], { encoding: null });
  const samplesPerWindow = 480;
  for (let offset = 0; offset + samplesPerWindow * 4 <= pcm.length; offset += samplesPerWindow * 4) {
    let peak = 0;
    for (let i = 0; i < samplesPerWindow; i++) {
      peak = Math.max(peak, Math.abs(pcm.readFloatLE(offset + i * 4)));
    }
    if (peak > 0.015) return offset / 4 / 48000;
  }
  throw new Error("source beep absent from output");
}

test("GPU and OSR exports keep a two-second main-track gap aligned with source audio", async (t) => {
  if (!["ffmpeg", "ffprobe"].every(available)) return t.skip("ffmpeg/ffprobe unavailable");
  try { if (!requireElectron()) return t.skip("Electron unavailable"); }
  catch { return t.skip("Electron unavailable"); }
  const root = await mkdtemp(join(tmpdir(), "export-leading-gap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, "project");
  await mkdir(join(project, "assets"), { recursive: true });
  await mkdir(join(project, "overlays"), { recursive: true });
  await mkdir(join(project, "exports"), { recursive: true });
  await writeFile(join(project, "overlays", "title.html"),
    '<div style="width:100%;height:100%;background:#111;color:white">TITLE</div>');
  run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i",
    `color=c=green:size=${width}x${height}:rate=${fps}:duration=2`,
    "-f", "lavfi", "-i", `color=c=blue:size=${width}x${height}:rate=${fps}:duration=2`,
    "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000:duration=0.5",
    "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v];[2:a]adelay=2000,apad=whole_dur=4[a]",
    "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-t", "4", join(project, "assets", "main.mp4")]);
  await writeFile(join(project, "edit.json"), JSON.stringify({
    version: 2, output: { width, height, fps },
    sources: [{ id: "main", path: "assets/main.mp4" }],
    tracks: [
      { id: "main", lane: "visual", items: [{ id: "clip", at: 20, duration: 40,
        source: { kind: "media", src: "main", in: 0, out: 4, speed: 1 } }] },
      { id: "title", lane: "visual", items: [{ id: "card", at: 0, duration: 20,
        source: { kind: "html", path: "overlays/title.html" } }] },
    ],
  }));
  const measurements = [];
  const verificationEdit = { cuts: [{ id: "clip", src: "main", track: 0, at: 2, in: 0, out: 4 }] };
  const verificationInputs = [{ id: "main", path: join(project, "assets", "main.mp4") }];
  for (const engine of ["auto", "osr"]) {
    const output = join(project, "exports", `${engine}.mp4`);
    const env = { ...process.env, AKARI_HOME: join(root, "akari-home") };
    delete env.AKARI_EXPORT_ALLOW_DESKTOP;
    delete env.AKARI_OSR_ELECTRON;
    const render = spawnSync(process.execPath, [join(repo, "packages/render-cut/bin/render-cut.mjs"), project,
      "--force", "--no-verify-blank", "--engine", engine, "--out", output],
    { env, encoding: "utf8", timeout: 600_000, maxBuffer: 8 * 1024 * 1024 });
    assert.ok(render.status === 0 || render.status === 1,
      `${engine}: export execution failed (${render.status}): ${render.error?.message ?? render.stderr}`);
    await access(output);
    const receipt = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    const verifyFinding = receipt.verify?.findings?.find(finding => finding.check === "verify.leading-gap-sync");
    if (engine === "auto") {
      assert.equal(receipt.provenance?.engine ?? receipt.engine, "gpu");
    }
    const blue = firstBlueFrame(output) / fps;
    const beep = firstBeepSecond(output);
    const offset = blue - beep;
    const finding = verifyLeadingGap({ outputPath: output, edit: verificationEdit,
      inputs: verificationInputs, ffmpegCommand: "ffmpeg" });
    console.log(`${engine}: blue=${blue.toFixed(2)}s beep=${beep.toFixed(2)}s picture-minus-audio=${offset.toFixed(2)}s`);
    measurements.push({ engine, blue, offset, finding, verifyFinding, renderStatus: render.status });
  }
  const faulty = join(project, "exports", "early.mp4");
  run("ffmpeg", ["-y", "-v", "error", "-i", join(project, "exports", "auto.mp4"),
    "-filter_complex", "[0:v]trim=start=2,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=2[v]",
    "-map", "[v]", "-map", "0:a:0", "-c:v", "libx264", "-c:a", "copy", faulty]);
  const faultyFinding = verifyLeadingGap({ outputPath: faulty, edit: verificationEdit,
    inputs: verificationInputs, ffmpegCommand: "ffmpeg" });
  assert.equal(faultyFinding?.severity, "error", JSON.stringify(faultyFinding));
  for (const { engine, blue, offset, finding, verifyFinding, renderStatus } of measurements) {
    const expectedSeverity = Math.abs(offset) <= 0.15 ? "info" : "error";
    assert.equal(verifyFinding?.severity, expectedSeverity,
      `${engine}: verify finding ${JSON.stringify(verifyFinding)}`);
    assert.equal(finding?.severity, expectedSeverity,
      `${engine}: direct verify finding ${JSON.stringify(finding)}`);
    assert.ok(Math.abs(offset) <= 0.15, `${engine}: picture-minus-audio=${offset.toFixed(2)}s`);
    assert.ok(Math.abs(blue - 4) <= 0.15, `${engine}: blue marker at ${blue.toFixed(2)}s, expected 4.00s`);
    assert.equal(renderStatus, 0, `${engine}: export verification failed after aligned measurements`);
  }
});

function requireElectron() {
  const candidate = join(repo, "node_modules", "electron", "dist");
  const electron = process.platform === "darwin"
    ? join(candidate, "Electron.app", "Contents", "MacOS", "Electron")
    : join(candidate, process.platform === "win32" ? "electron.exe" : "electron");
  return spawnSync(electron, ["--version"], { timeout: 10_000 }).status === 0;
}
