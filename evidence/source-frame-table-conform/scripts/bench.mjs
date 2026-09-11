#!/usr/bin/env node
// L1 harness for source-frame-table-conform (wrapper-owned verification script).
// usage: node bench.mjs --repo <tree> --tools <tree-with-vendor-ffmpeg> --source <mp4> --workdir <dir> --label <before|after>
//        [--fixture real|cfr] [--quality high|standard]
// Per run: project = assets/source.mp4 + edit.json (single clip) -> `akari media probe` (records sidecar)
//   -> edit-lint (default, no --media; JSON) -> render-cut --engine gpu -> kill leftovers -> sha256
//   -> per-frame PSNR of the output against the source at shifts -1 / 0 / +1 (frames paired by index via setpts).
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";

const args = process.argv.slice(2);
const opt = (name, fallback = null) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const repo = resolve(opt("--repo"));
const tools = resolve(opt("--tools", repo));
const source = resolve(opt("--source"));
const workdir = resolve(opt("--workdir"));
const label = opt("--label", "run");
const fixture = opt("--fixture", "real");
const quality = opt("--quality", "high");
const ffmpeg = join(tools, "packages/media-bin/vendor/darwin-arm64/ffmpeg");
const ffprobe = join(tools, "packages/media-bin/vendor/darwin-arm64/ffprobe");
const renderCut = join(repo, "packages/render-cut/bin/render-cut.mjs");
const editLint = join(repo, "packages/edit-lint/bin/edit-lint.mjs");
const media = join(repo, "packages/akari-tools/bin/media.mjs");
mkdirSync(workdir, { recursive: true });
const akariHome = join(workdir, "akari-home");
mkdirSync(akariHome, { recursive: true });

function sha256(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function loadAvg() { return spawnSync("sysctl", ["-n", "vm.loadavg"], { encoding: "utf8" }).stdout.trim(); }
function leftoverElectron(marker) {
  return spawnSync("ps", ["-eo", "pid,ppid,args"], { encoding: "utf8" }).stdout.split("\n")
    .filter((l) => l.includes(marker) && !l.includes("grep"));
}
function frameCount(path) {
  const r = spawnSync(ffprobe, ["-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries",
    "stream=nb_read_packets,r_frame_rate,avg_frame_rate:format=duration", "-of", "json", path], { encoding: "utf8" });
  return JSON.parse(r.stdout);
}
// PSNR of out frame n against source frame n+shift (both re-timed by frame index so framesync pairs by index).
function psnrShift(out, src, shift, statsPath, fps) {
  const outChain = shift < 0 ? `[0:v]select='gte(n,${-shift})',setpts=N/(${fps}*TB)[a]` : `[0:v]setpts=N/(${fps}*TB)[a]`;
  const srcChain = shift > 0 ? `[1:v]select='gte(n,${shift})',setpts=N/(${fps}*TB)[b]` : `[1:v]setpts=N/(${fps}*TB)[b]`;
  const r = spawnSync(ffmpeg, ["-v", "error", "-y", "-i", out, "-i", src, "-lavfi",
    `${outChain};${srcChain};[a][b]psnr=stats_file=${statsPath}:shortest=1`, "-f", "null", "-"], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`psnr failed: ${r.stderr}`);
  const rows = readFileSync(statsPath, "utf8").split("\n").filter(Boolean).map((line) => {
    const m = {};
    for (const kv of line.trim().split(/\s+/)) { const [k, v] = kv.split(":"); m[k] = Number(v); }
    // re-map n to output frame index: for shift<0 the output was trimmed by -shift frames.
    m.outFrame = shift < 0 ? m.n - 1 - shift : m.n - 1;
    return m;
  });
  return rows;
}
function summarize(rows, fps) {
  const v = rows.map((r) => r.psnr_avg);
  const sorted = [...v].sort((a, b) => a - b);
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const region = (from, to) => {
    const sel = rows.filter((r) => r.outFrame >= from * fps && r.outFrame < to * fps).map((r) => r.psnr_avg);
    const s = [...sel].sort((a, b) => a - b);
    return sel.length ? { n: sel.length, min: s[0], median: s[Math.floor(s.length / 2)], mean: sel.reduce((a, b) => a + b, 0) / sel.length } : null;
  };
  return {
    frames: v.length, min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], mean, max: sorted.at(-1),
    below45: v.filter((x) => x < 45).length, below40: v.filter((x) => x < 40).length,
    firstBelow45: rows.find((r) => r.psnr_avg < 45)?.outFrame ?? null,
    region_0_15s: region(0, 15), region_15_30s: region(15, 30),
  };
}

async function main() {
  const project = join(workdir, `${label}-${fixture}`);
  rmSync(project, { recursive: true, force: true });
  mkdirSync(join(project, "assets"), { recursive: true });
  mkdirSync(join(project, ".akari"), { recursive: true });
  copyFileSync(source, join(project, "assets", "source.mp4"));
  const info = frameCount(join(project, "assets", "source.mp4"));
  const fps = 30;
  const totalFrames = Number(info.streams[0].nb_read_packets);
  const seconds = totalFrames / fps;
  writeFileSync(join(project, "edit.json"), `${JSON.stringify({
    version: 2,
    output: { width: 1920, height: 1080, fps },
    sources: [{ id: "src-1", path: "assets/source.mp4" }],
    tracks: [{ id: "v-main", lane: "visual", items: [
      { id: "clip-1", at: 0, duration: totalFrames, source: { kind: "media", src: "src-1", in: 0, out: seconds } },
    ] }],
  }, null, 2)}\n`);

  // (c) probe -> sidecar
  const probe = spawnSync(process.execPath, [media, "probe", "assets/source.mp4"], { cwd: project, encoding: "utf8", env: { ...process.env, FFMPEG: ffmpeg, FFPROBE: ffprobe } });
  if (probe.status !== 0) throw new Error(`probe failed: ${probe.stderr}`);
  const probeJson = JSON.parse(probe.stdout);
  writeFileSync(join(workdir, `${label}-${fixture}.probe.json`), `${JSON.stringify(probeJson, null, 2)}\n`);
  const sidecar = join(project, ".akari", "sidecars", "assets", "source.mp4.analysis", "analysis.json");
  const sidecarExists = existsSync(sidecar);

  // (d) edit-lint default run (no --media)
  const lint = spawnSync(process.execPath, [editLint, project, "--json"], { cwd: repo, encoding: "utf8", env: { ...process.env, FFPROBE: ffprobe } });
  writeFileSync(join(workdir, `${label}-${fixture}.lint.json`), lint.stdout);
  let lintJson = null;
  try { lintJson = JSON.parse(lint.stdout); } catch {}
  const vfrFindings = (lintJson?.findings ?? []).filter((f) => f.check === "source.vfr");
  if (lint.status === 2) throw new Error(`edit-lint execution error: ${lint.stdout}\n${lint.stderr}`);

  // (a)/(b) render-cut
  const out = join(project, "exports", "out.mp4");
  const cli = [renderCut, project, "--out", out, "--quality", quality, "--engine", "gpu", "--progress", "--no-settle"];
  const env = { ...process.env, AKARI_HOME: akariHome, AKARI_EXPORT_ALLOW_DESKTOP: "0" };
  delete env.ELECTRON_RUN_AS_NODE;
  const lines = [];
  const t0 = performance.now();
  const child = spawn(process.execPath, cli, { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"] });
  const stamp = (stream, text) => { for (const line of text.split(/\r?\n/)) if (line) lines.push(`${String(Math.round(performance.now() - t0)).padStart(7)} ${stream} ${line}`); };
  let so = ""; let se = "";
  child.stdout.on("data", (c) => { so += c; const p = so.split(/\r?\n/); so = p.pop(); for (const x of p) stamp(" ", x); });
  child.stderr.on("data", (c) => { se += c; const p = se.split(/\r?\n/); se = p.pop(); for (const x of p) stamp("E", x); });
  const exit = await new Promise((res) => child.once("close", (code, signal) => res({ code, signal })));
  if (so) stamp(" ", so); if (se) stamp("E", se);
  const totalMs = Math.round(performance.now() - t0);
  writeFileSync(join(workdir, `${label}-${fixture}.render.log`), `${lines.join("\n")}\n`);
  const marker = join(project, ".akari");
  const leftovers = leftoverElectron(marker);
  for (const l of leftovers) { const pid = Number(l.trim().split(/\s+/)[0]); if (pid) try { process.kill(pid, "SIGKILL"); } catch {} }
  const gpuRunPath = join(project, ".akari", "gpu-run.json");
  const gpuRun = existsSync(gpuRunPath) ? JSON.parse(readFileSync(gpuRunPath, "utf8")) : null;

  let psnr = null;
  if (existsSync(out)) {
    const src = join(project, "assets", "source.mp4");
    const shifts = {};
    for (const shift of [-1, 0, 1]) {
      const rows = psnrShift(out, src, shift, join(workdir, `${label}-${fixture}.psnr.shift${shift}.txt`), fps);
      shifts[String(shift)] = { rows, summary: summarize(rows, fps) };
    }
    // argmax per output frame: which source frame (n-1 / n / n+1) matches best
    const byFrame = new Map();
    for (const [shift, { rows }] of Object.entries(shifts)) for (const r of rows) {
      const e = byFrame.get(r.outFrame) ?? {};
      e[shift] = r.psnr_avg; byFrame.set(r.outFrame, e);
    }
    const argmax = { "-1": 0, "0": 0, "1": 0 };
    const wrongFrames = [];
    for (const [n, e] of [...byFrame.entries()].sort((a, b) => a[0] - b[0])) {
      if (e["-1"] == null || e["0"] == null || e["1"] == null) continue;
      const best = Object.entries(e).sort((a, b) => b[1] - a[1])[0][0];
      argmax[best] += 1;
      if (best !== "0") wrongFrames.push({ frame: n, best, psnr: e });
    }
    psnr = {
      shift0: shifts["0"].summary, shiftMinus1: shifts["-1"].summary, shiftPlus1: shifts["1"].summary,
      argmax, wrongFrames: wrongFrames.slice(0, 20), wrongFrameCount: wrongFrames.length,
      firstWrongFrame: wrongFrames[0]?.frame ?? null, lastWrongFrame: wrongFrames.at(-1)?.frame ?? null,
    };
  }
  const result = {
    label, fixture, quality, exit, totalMs, loadavg: loadAvg(), wallStart: new Date().toISOString(),
    sourceFrames: totalFrames, sourceRates: { r_frame_rate: info.streams[0].r_frame_rate, avg_frame_rate: info.streams[0].avg_frame_rate },
    probeFrameTiming: probeJson.video?.frame_timing ?? null, sidecarExists,
    lintExit: lint.status, lintVerdict: lintJson?.verdict ?? lintJson?.status ?? null, sourceVfrFindings: vfrFindings,
    output: existsSync(out) ? { sha256: sha256(out), frames: frameCount(out) } : null,
    launcherTier: gpuRun?.launcher_tier ?? gpuRun?.launcher?.tier ?? null,
    gpuRunKeys: gpuRun ? Object.keys(gpuRun) : null,
    psnr,
    leftoverElectronBeforeKill: leftovers.length, leftoverElectronAfterKill: leftoverElectron(marker).length,
  };
  writeFileSync(join(workdir, `${label}-${fixture}.json`), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ label, fixture, exit, totalMs, sha256: result.output?.sha256, frame_timing: result.probeFrameTiming, vfr: vfrFindings.length, psnr: psnr && { min: psnr.shift0.min, below45: psnr.shift0.below45, argmax: psnr.argmax, firstWrong: psnr.firstWrongFrame } }));
}
main().catch((e) => { console.error(e); process.exit(1); });
