#!/usr/bin/env node
// L1 bench for task Q (export outside-engine overhead).
// usage: node bench.mjs --repo <worktree> --source <source.mp4> --workdir <dir> --label <before|after> --runs 3
//        [--fixture plain|black] [--no-verify-blank] [--engine gpu]
// Runs render-cut with --progress, timestamps every stdout/stderr line, derives a stage table and
// writes <workdir>/<label>-<i>.log, <workdir>/<label>-<i>.json and <workdir>/<label>-summary.json.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";

const args = process.argv.slice(2);
const opt = (name, fallback = null) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const flag = (name) => args.includes(name);
const repo = resolve(opt("--repo"));
const source = resolve(opt("--source"));
const workdir = resolve(opt("--workdir"));
const label = opt("--label", "run");
const runs = Number(opt("--runs", "1"));
const fixture = opt("--fixture", "plain");
const engine = opt("--engine", "gpu");
const noVerifyBlank = flag("--no-verify-blank");
const ffprobe = join(repo, "packages/media-bin/vendor/darwin-arm64/ffprobe");
const renderCut = join(repo, "packages/render-cut/bin/render-cut.mjs");
mkdirSync(workdir, { recursive: true });
const akariHome = join(workdir, "akari-home");
mkdirSync(akariHome, { recursive: true });

function editJson(kind) {
  if (kind === "plain") {
    return {
      version: 2,
      output: { width: 1920, height: 1080, fps: 30 },
      sources: [{ id: "src-1", path: "assets/source.mp4" }],
      tracks: [{ id: "v-main", lane: "visual", items: [
        { id: "clip-1", at: 0, duration: 900, source: { kind: "media", src: "src-1", in: 0, out: 30 } },
      ] }],
    };
  }
  if (kind === "black") {
    // 10 s of footage, then 1 s of an all-black clip (assets/black.mp4), then footage again.
    return {
      version: 2,
      output: { width: 1920, height: 1080, fps: 30 },
      sources: [{ id: "src-1", path: "assets/source.mp4" }, { id: "black", path: "assets/black.mp4" }],
      tracks: [{ id: "v-main", lane: "visual", items: [
        { id: "clip-1", at: 0, duration: 300, source: { kind: "media", src: "src-1", in: 0, out: 10 } },
        { id: "clip-black", at: 300, duration: 30, source: { kind: "media", src: "black", in: 0, out: 1 } },
        { id: "clip-2", at: 330, duration: 270, source: { kind: "media", src: "src-1", in: 11, out: 20 } },
      ] }],
    };
  }
  throw new Error(`unknown fixture ${kind}`);
}

function sha256(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function probe(path) {
  const r = spawnSync(ffprobe, ["-v", "error", "-count_frames", "-show_entries",
    "stream=codec_type,codec_name,width,height,nb_read_frames,duration:format=duration", "-of", "json", path], { encoding: "utf8" });
  try { return JSON.parse(r.stdout); } catch { return { error: r.stderr }; }
}
function loadAvg() { return spawnSync("sysctl", ["-n", "vm.loadavg"], { encoding: "utf8" }).stdout.trim(); }
function leftoverElectron(marker) {
  const ps = spawnSync("ps", ["-eo", "pid,ppid,args"], { encoding: "utf8" }).stdout.split("\n").filter((l) => l.includes(marker) && !l.includes("grep"));
  return ps;
}

async function runOnce(index) {
  const project = join(workdir, `${label}-${index}`);
  rmSync(project, { recursive: true, force: true });
  mkdirSync(join(project, "assets"), { recursive: true });
  copyFileSync(source, join(project, "assets", "source.mp4"));
  if (fixture === "black") {
    const ffmpeg = join(repo, "packages/media-bin/vendor/darwin-arm64/ffmpeg");
    const r = spawnSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:size=1920x1080:rate=30:duration=2",
      "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", join(project, "assets", "black.mp4")], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`black fixture failed: ${r.stderr}`);
  }
  writeFileSync(join(project, "edit.json"), `${JSON.stringify(editJson(fixture), null, 2)}\n`);
  const out = join(project, "exports", "out.mp4");
  const lint = spawnSync(process.execPath, [join(repo, "packages/edit-lint/bin/edit-lint.mjs"), project], { encoding: "utf8", cwd: repo });
  if (lint.status !== 0) throw new Error(`edit-lint failed: ${lint.stdout}\n${lint.stderr}`);
  const cli = [renderCut, project, "--out", out, "--quality", "standard", "--engine", engine, "--progress", "--no-settle", ...(noVerifyBlank ? ["--no-verify-blank"] : [])];
  const env = { ...process.env, AKARI_HOME: akariHome, AKARI_EXPORT_ALLOW_DESKTOP: "0" };
  delete env.ELECTRON_RUN_AS_NODE;
  const lines = [];
  const t0 = performance.now();
  const wall0 = Date.now();
  const stamp = (stream, text) => {
    for (const line of text.split(/\r?\n/)) {
      if (line === "") continue;
      lines.push({ ms: Math.round(performance.now() - t0), stream, line });
    }
  };
  const child = spawn(process.execPath, cli, { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"] });
  let so = ""; let se = "";
  child.stdout.on("data", (c) => { so += c; const parts = so.split(/\r?\n/); so = parts.pop(); for (const p of parts) stamp("out", p); });
  child.stderr.on("data", (c) => { se += c; const parts = se.split(/\r?\n/); se = parts.pop(); for (const p of parts) stamp("err", p); });
  const exit = await new Promise((res) => child.once("close", (code, signal) => res({ code, signal })));
  if (so) stamp("out", so); if (se) stamp("err", se);
  const totalMs = Math.round(performance.now() - t0);
  const log = lines.map((l) => `${String(l.ms).padStart(7)} ${l.stream === "err" ? "E" : " "} ${l.line}`).join("\n");
  writeFileSync(join(workdir, `${label}-${index}.log`), `${log}\n`);

  const find = (pred) => lines.find((l) => pred(l.line));
  const findLast = (pred) => [...lines].reverse().find((l) => pred(l.line));
  const at = (l) => (l ? l.ms : null);
  const s = {
    prepare_start: at(find((l) => l === "PROGRESS stage=prepare status=start")),
    prepare_end: at(find((l) => l === "PROGRESS stage=prepare status=end")),
    audio_cut_start: at(find((l) => l === "PROGRESS stage=audio-cut status=start")),
    audio_cut_end: at(find((l) => l === "PROGRESS stage=audio-cut status=end")),
    render_start: at(find((l) => l.startsWith("PROGRESS stage=render status=start"))),
    first_frame_line: at(find((l) => /^PROGRESS frame=\d+ total=\d+$/.test(l))),
    first_preview: at(find((l) => l.startsWith("PROGRESS preview="))),
    last_frame_line: at(findLast((l) => /^PROGRESS frame=\d+ total=\d+$/.test(l))),
    render_end: at(find((l) => l === "PROGRESS stage=render status=end")),
    audio_mix_start: at(find((l) => l === "PROGRESS stage=audio-mix status=start")),
    audio_mix_end: at(find((l) => l === "PROGRESS stage=audio-mix status=end")),
    verify_start: at(find((l) => l === "PROGRESS stage=verify status=start")),
    verify_end: at(find((l) => l === "PROGRESS stage=verify status=end")),
    done: at(find((l) => l.startsWith("PROGRESS done"))),
    verdict: at(find((l) => /^(PASS|FAIL):/.test(l))),
    exit: totalMs,
  };
  const d = (a, b) => (a === null || b === null ? null : b - a);
  const table = {
    prepare: d(s.prepare_start, s.prepare_end),
    audio_cut: d(s.audio_cut_start, s.audio_cut_end),
    render_startup_to_first_frame_line: d(s.render_start, s.first_frame_line),
    render_draw: d(s.first_frame_line, s.last_frame_line),
    render_after_last_frame: d(s.last_frame_line, s.render_end),
    audio_mix: d(s.audio_mix_start, s.audio_mix_end),
    verify: d(s.verify_start, s.verify_end),
    finalize_after_verify: d(s.verify_end, s.exit),
    total: totalMs,
  };
  table.outside_engine = table.total - (table.render_draw ?? 0);
  const timingLines = lines.filter((l) => /^PROGRESS (timing|stage-detail|substage)/.test(l.line) || /^\[gpu-renderer\] (timing|stage)/.test(l.line)).map((l) => l.line);
  const verdictLine = find((l) => /^(PASS|FAIL):/.test(l))?.line ?? null;
  const blank = lines.filter((l) => l.line.includes("verify.blank-frames") || l.line.includes("空フレーム")).map((l) => l.line);
  const gpuRunPath = join(project, ".akari", "gpu-run.json");
  const gpuRun = existsSync(gpuRunPath) ? JSON.parse(readFileSync(gpuRunPath, "utf8")) : null;
  const renderJsonPath = join(project, ".akari", "render.json");
  const renderJson = existsSync(renderJsonPath) ? JSON.parse(readFileSync(renderJsonPath, "utf8")) : null;
  const marker = join(project, ".akari");
  const leftovers = leftoverElectron(marker);
  for (const l of leftovers) { const pid = Number(l.trim().split(/\s+/)[0]); if (pid) try { process.kill(pid, "SIGKILL"); } catch {} }
  const result = {
    label, index, exit, totalMs, wallStart: new Date(wall0).toISOString(), loadavg: loadAvg(),
    verdict: verdictLine, marks: s, table, timingLines, blankFindings: blank,
    output: existsSync(out) ? { sha256: sha256(out), probe: probe(out) } : null,
    gpuRunStages: gpuRun?.stages ?? null,
    gpuRunLuma: gpuRun?.luma ?? gpuRun?.blank ?? gpuRun?.luminance ?? null,
    gpuRunKeys: gpuRun ? Object.keys(gpuRun) : null,
    verifyFindings: renderJson?.verify?.findings ?? null,
    blankIntervals: renderJson?.verify?.declared?.blank_frames ?? null,
    leftoverElectronBeforeKill: leftovers.length,
    leftoverElectronAfterKill: leftoverElectron(marker).length,
  };
  writeFileSync(join(workdir, `${label}-${index}.json`), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

const results = [];
for (let i = 1; i <= runs; i += 1) {
  const r = await runOnce(i);
  results.push(r);
  process.stdout.write(`${label}-${i}: exit=${r.exit.code} total=${r.totalMs}ms ${JSON.stringify(r.table)} leftovers=${r.leftoverElectronBeforeKill}/${r.leftoverElectronAfterKill} verdict=${r.verdict}\n`);
}
const keys = Object.keys(results[0].table);
const median = (xs) => { const v = xs.filter((x) => x !== null).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
const summary = { label, fixture, runs: results.length, median: Object.fromEntries(keys.map((k) => [k, median(results.map((r) => r.table[k]))])), each: results.map((r) => ({ index: r.index, exit: r.exit.code, table: r.table, sha256: r.output?.sha256 ?? null, verdict: r.verdict })) };
writeFileSync(join(workdir, `${label}-summary.json`), `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${label} median: ${JSON.stringify(summary.median)}\n`);
