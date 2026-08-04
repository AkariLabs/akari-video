import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const cli = path.resolve(import.meta.dirname, "../propose-cut-candidates.mjs");

function command(name) {
  const found = spawnSync("/usr/bin/env", ["sh", "-c", `command -v ${name}`], { encoding: "utf8" });
  return found.status === 0 ? found.stdout.trim() : null;
}

test("L1: actual ffmpeg detects a new 12-second -35dB silence fixture", { timeout: 30_000 }, async (context) => {
  const ffmpeg = command("ffmpeg");
  const ffprobe = command("ffprobe");
  if (!ffmpeg || !ffprobe) {
    context.skip("ffmpeg and ffprobe are required for L1 media evidence");
    return;
  }
  const root = await mkdtemp(path.join(tmpdir(), "akari-cut-l1-"));
  try {
    const source = path.join(root, "assets", "generated-12s.mp4");
    const analysisDirectory = path.join(root, ".akari", "sidecars", "assets", "generated-12s.mp4.analysis");
    await mkdir(path.dirname(source), { recursive: true });
    await mkdir(path.join(root, ".akari", "work"), { recursive: true });
    await mkdir(path.join(root, "edit-plan"), { recursive: true });
    await mkdir(analysisDirectory, { recursive: true });
    const generated = spawnSync(ffmpeg, [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=30:d=12",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=4",
      "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono:d=0.8",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=7.2",
      "-filter_complex", "[1:a][2:a][3:a]concat=n=3:v=0:a=1[a]",
      "-map", "0:v", "-map", "[a]", "-c:v", "mpeg4", "-q:v", "8", "-c:a", "aac", "-shortest", source,
    ], { encoding: "utf8", timeout: 20_000 });
    assert.equal(generated.status, 0, generated.stderr);
    await writeFile(path.join(root, ".akari", "connections.json"), "{\"version\":1}\n");
    await writeFile(path.join(root, ".akari", "work", "semantic-keep-plan.json"), `${JSON.stringify({
      version: 1,
      kind: "akari-semantic-keep-plan-v1",
      intended_edit_version: 1,
      candidate_frame_rate: 30,
      sources: [{ id: "generated", path: "assets/generated-12s.mp4" }],
      occurrences: [{ source_index: 0, range: { mode: "full_source" } }],
    })}\n`);
    await writeFile(path.join(root, "edit-plan", "decision-log.md"), "# L1 synthetic mechanism evidence\n");
    await writeFile(path.join(analysisDirectory, "analysis.json"), `${JSON.stringify({
      version: 0,
      source: path.relative(analysisDirectory, source),
      transcript: [
        { start: 3.2, end: 3.95, text: "before", words: [{ start: 3.7, end: 3.9, text: "before" }] },
        { start: 4.85, end: 5.5, text: "after", words: [{ start: 4.9, end: 5.1, text: "after" }] },
      ],
      keyframes: [],
      events: [],
      tracks: { speakers: [], faces: [], person_matte: null },
    })}\n`);
    const started = performance.now();
    const executed = spawnSync(process.execPath, [
      cli,
      "--project", root,
      "--keep-plan", ".akari/work/semantic-keep-plan.json",
      "--decision-log", "edit-plan/decision-log.md",
      "--approval-ref", "checkpoint-1/l1-synthetic/2026-08-03",
    ], {
      encoding: "utf8",
      timeout: 20_000,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, AKARI_FFMPEG_BIN: ffmpeg, AKARI_FFPROBE_BIN: ffprobe },
    });
    const elapsed = performance.now() - started;
    assert.equal(executed.status, 0, executed.stderr);
    assert.equal(executed.stderr, "");
    const report = JSON.parse(executed.stdout);
    assert.equal(report.inputs.processed_sources[0].probe.format_duration_seconds >= 10, true);
    assert.equal(report.inputs.processed_sources[0].probe.format_duration_seconds <= 15, true);
    assert.equal(report.inputs.processed_sources[0].detector.status, "COMPLETED");
    assert.ok(report.inputs.processed_sources[0].detector.silence_pair_count >= 1);
    assert.ok(report.candidates.some((candidate) => candidate.family === "pause_shortening_review")
      || report.skipped.length > 0);
    assert.equal(report.approved_to_apply, false);
    assert.ok(elapsed < 15_000, `L1 helper took ${elapsed.toFixed(1)}ms`);
    assert.ok(Buffer.byteLength(executed.stdout) < 64 * 1024 * 1024);
    context.diagnostic(JSON.stringify({
      duration_seconds: report.inputs.processed_sources[0].probe.format_duration_seconds,
      silence_pairs: report.inputs.processed_sources[0].detector.silence_pair_count,
      candidates: report.candidates.length,
      skipped: report.skipped.length,
      helper_ms: Math.round(elapsed),
      report_bytes: Buffer.byteLength(executed.stdout),
    }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
