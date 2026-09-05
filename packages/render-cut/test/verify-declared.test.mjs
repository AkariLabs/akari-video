import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { logVerificationResult, verifyArtifact } from "../src/render-cut.mjs";
import { buildAudioMixCommand } from "../src/plan.mjs";
import { enumerateDeclaredRenderInputs, hashDeclaredRenderInputs } from "../src/render-inputs.mjs";
import { createImmutableRenderReceipt } from "../src/render-receipt.mjs";
import { renderReport } from "../src/report.mjs";
import {
  AUDIO_LEVEL_THRESHOLD_DB,
  MOTION_STATIC_NCC,
  MOTION_UNIFORM_STDDEV,
  extractGrayFrame,
  judgeAudioLevel,
  judgeMotion,
  measureAudioLevel,
  normalizedCrossCorrelation,
  parseVolumeLevels,
  planVolumeIntervals,
  selectMotionProbes,
} from "../src/verify-declared.mjs";

const ffmpegAvailable = spawnSync("ffmpeg", ["-version"]).status === 0;
const ffprobeAvailable = spawnSync("ffprobe", ["-version"]).status === 0;
const grayBytes = 160 * 90;

test("declared verification constants pin the v0 thresholds", () => {
  assert.equal(AUDIO_LEVEL_THRESHOLD_DB, -80);
  assert.equal(MOTION_STATIC_NCC, 0.98);
  assert.equal(MOTION_UNIFORM_STDDEV, 2);
});

test("audio mix plans expose whether BGM, SFX, narration, or master audio is audible", () => {
  const base = { projectRoot: ".", inputPath: "in.mp4", outputPath: "out.mp4", duration: 10 };
  const build = (audio) => buildAudioMixCommand({ ...base, edit: { audio } });
  assert.equal(build({}).hasAudibleAudio, false);
  assert.equal(build({ bgm: { path: "bgm.wav" } }).hasAudibleAudio, true);
  assert.equal(build({ sfx: [{ path: "sfx.wav", t: 0 }] }).hasAudibleAudio, true);
  assert.equal(build({ master: { denoise: "off" } }).hasAudibleAudio, true);
});

test("planVolumeIntervals uses the whole ten-second output as one interval", () => {
  assert.deepEqual(planVolumeIntervals(10), [{ start: 0, duration: 10 }]);
});

test("planVolumeIntervals uses two centered windows for 600 seconds", () => {
  assert.deepEqual(planVolumeIntervals(600), [
    { start: 135, duration: 30 },
    { start: 435, duration: 30 },
  ]);
});

test("planVolumeIntervals caps a 5309.9-second output at six deterministic windows", () => {
  assert.deepEqual(planVolumeIntervals(5309.9), [
    { start: 427.492, duration: 30 },
    { start: 1312.475, duration: 30 },
    { start: 2197.458, duration: 30 },
    { start: 3082.442, duration: 30 },
    { start: 3967.425, duration: 30 },
    { start: 4852.408, duration: 30 },
  ]);
});

test("planVolumeIntervals keeps every interval inside the declared output", () => {
  for (const duration of [0.001, 29.9, 30, 299.9, 300, 600, 5309.9]) {
    for (const interval of planVolumeIntervals(duration)) {
      assert.ok(interval.start >= 0, `${duration}: ${JSON.stringify(interval)}`);
      assert.ok(interval.start + interval.duration <= duration + 1e-9, `${duration}: ${JSON.stringify(interval)}`);
    }
  }
  assert.deepEqual(planVolumeIntervals(0), []);
  assert.deepEqual(planVolumeIntervals(Number.NaN), []);
});

test("parseVolumeLevels reads finite mean and maximum values", () => {
  assert.deepEqual(
    parseVolumeLevels("[Parsed_volumedetect] mean_volume: -24.3 dB\n[Parsed_volumedetect] max_volume: -3.1 dB\n"),
    { mean_db: -24.3, max_db: -3.1 },
  );
});

test("parseVolumeLevels preserves digital silence as negative infinity", () => {
  const parsed = parseVolumeLevels("mean_volume: -inf dB\r\nmax_volume: -inf dB\r\n");
  assert.equal(parsed.mean_db, Number.NEGATIVE_INFINITY);
  assert.equal(parsed.max_db, Number.NEGATIVE_INFINITY);
});

test("parseVolumeLevels returns null when either value is absent", () => {
  assert.equal(parseVolumeLevels("max_volume: -2.0 dB"), null);
  assert.equal(parseVolumeLevels("not a volumedetect report"), null);
});

test("measureAudioLevel invokes input-side seeks and keeps the loudest interval", () => {
  const calls = [];
  const reports = [
    "mean_volume: -40.0 dB\nmax_volume: -12.0 dB\n",
    "mean_volume: -30.0 dB\nmax_volume: -4.5 dB\n",
  ];
  const measurement = measureAudioLevel({
    outputPath: "out.mp4",
    durationSeconds: 600,
    ffmpegCommand: "ffmpeg-test",
    spawnSyncImpl: (command, args) => {
      calls.push({ command, args });
      return { status: 0, stderr: reports[calls.length - 1] };
    },
  });
  assert.equal(measurement.ok, true);
  assert.equal(measurement.max_db, -4.5);
  assert.deepEqual(measurement.intervals, [
    { start: 135, duration: 30, mean_db: -40, max_db: -12 },
    { start: 435, duration: 30, mean_db: -30, max_db: -4.5 },
  ]);
  assert.equal(calls[0].command, "ffmpeg-test");
  assert.ok(calls[0].args.indexOf("-ss") < calls[0].args.indexOf("-i"));
  assert.equal(calls[0].args[calls[0].args.indexOf("-ss") + 1], "135");
});

test("measureAudioLevel reports the last stderr line on process failure", () => {
  const measurement = measureAudioLevel({
    outputPath: "out.mp4",
    durationSeconds: 10,
    spawnSyncImpl: () => ({ status: 1, stderr: "first line\nlast failure\n" }),
  });
  assert.equal(measurement.ok, false);
  assert.equal(measurement.error, "last failure");
});

function audioJudgement({ declared, maxDb, hasAudioStream = true, ok = true, reasons = ["bgm"] }) {
  return judgeAudioLevel({
    declared,
    reasons,
    hasAudioStream,
    measurement: ok
      ? { ok: true, intervals: [{ start: 0, duration: 10, mean_db: maxDb, max_db: maxDb }], max_db: maxDb }
      : { ok: false, intervals: [{ start: 0, duration: 10 }], max_db: null, error: "probe failed" },
  });
}

test("declared digital silence is an audio-level error", () => {
  const judged = audioJudgement({ declared: true, maxDb: -91, reasons: ["bgm", "素材音声"] });
  assert.equal(judged.finding.severity, "error");
  assert.equal(judged.record.verdict, "fail");
  assert.match(judged.finding.message, /bgm\/素材音声/u);
  assert.match(judged.finding.message, /閾値 -80 dB・1 区間/u);
});

test("declared audible output is an audio-level info pass", () => {
  const judged = audioJudgement({ declared: true, maxDb: -20 });
  assert.equal(judged.finding.severity, "info");
  assert.equal(judged.record.verdict, "pass");
  assert.equal(judged.record.max_db, -20);
});

test("an undeclared silent audio track is a warning without failure", () => {
  const judged = audioJudgement({ declared: false, maxDb: -91, reasons: [] });
  assert.equal(judged.finding.severity, "warning");
  assert.equal(judged.record.verdict, "warning");
  assert.match(judged.finding.message, /無音トラック/u);
});

test("undeclared audible audio is a warning without failure", () => {
  const judged = audioJudgement({ declared: false, maxDb: -20, reasons: [] });
  assert.equal(judged.finding.severity, "warning");
  assert.equal(judged.record.verdict, "warning");
  assert.match(judged.finding.message, /可聴音声/u);
});

test("audio-level is recorded as skipped when the output has no audio stream", () => {
  const judged = audioJudgement({ declared: true, maxDb: -20, hasAudioStream: false });
  assert.equal(judged.finding, null);
  assert.deepEqual(judged.record, {
    declared: true,
    reasons: ["bgm"],
    threshold_db: -80,
    intervals: [],
    max_db: null,
    verdict: "skipped",
  });
});

test("audio measurement failure is an error that names threshold and interval count", () => {
  const judged = audioJudgement({ declared: true, maxDb: null, ok: false });
  assert.equal(judged.finding.severity, "error");
  assert.equal(judged.record.verdict, "fail");
  assert.match(judged.finding.message, /閾値 -80 dB・1 区間/u);
  assert.match(judged.finding.message, /probe failed/u);
});

test("normalizedCrossCorrelation is 1 for identical non-uniform samples", () => {
  assert.ok(Math.abs(normalizedCrossCorrelation([0, 1, 4, 9], [0, 1, 4, 9]) - 1) < 1e-12);
});

test("normalizedCrossCorrelation is -1 for inverted samples", () => {
  assert.ok(Math.abs(normalizedCrossCorrelation([0, 1, 2, 3], [3, 2, 1, 0]) + 1) < 1e-12);
});

test("normalizedCrossCorrelation is NaN for a uniform sample", () => {
  assert.equal(Number.isNaN(normalizedCrossCorrelation([4, 4, 4], [1, 2, 3])), true);
});

test("normalizedCrossCorrelation stays near zero for independent deterministic noise", () => {
  let leftState = 0x12345678;
  let rightState = 0x87654321;
  const next = (state) => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  const left = [];
  const right = [];
  for (let index = 0; index < 4096; index += 1) {
    leftState = next(leftState);
    rightState = next(rightState);
    left.push(leftState & 0xff);
    right.push(rightState & 0xff);
  }
  assert.ok(Math.abs(normalizedCrossCorrelation(left, right)) < 0.2);
});

function cropPoints(times = [0, 150, 299]) {
  return [
    { t: times[0], crop: { x: 0, y: 0, w: 0.5, h: 0.5 }, transform: { scale: 2 } },
    { t: times[1], crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, transform: { scale: 2 } },
    { t: times[2], crop: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, transform: { scale: 2 } },
  ];
}

test("selectMotionProbes chooses the maximum crop pair and converts raw frame times", () => {
  const selected = selectMotionProbes(
    [{ id: "moving", at: 0, in: 0, out: 10, keyframes: cropPoints() }],
    { fps: 30, durationSeconds: 10 },
  );
  assert.equal(selected.length, 1);
  assert.equal(selected[0].cut, "moving");
  assert.equal(selected[0].t1, 0);
  assert.ok(Math.abs(selected[0].t2 - (10 - 1 / 30)) < 1e-9);
});

test("selectMotionProbes accepts transform-only declarations in output-local seconds", () => {
  const selected = selectMotionProbes([{
    id: "transform",
    at: 3,
    in: 0,
    out: 5,
    keyframes: [
      { t: 0, transform: { x: 0, y: 0, scale: 1, rotate: 0 } },
      { t: 4, transform: { x: 100, y: 5, scale: 1.5, rotate: 10 } },
    ],
  }], { fps: 30, durationSeconds: 10 });
  assert.deepEqual(selected, [{ cut: "transform", t1: 3, t2: 7 }]);
});

test("selectMotionProbes ignores one-point and unchanged declarations", () => {
  const selected = selectMotionProbes([
    { id: "one", in: 0, out: 1, keyframes: [{ t: 0, crop: { x: 0, y: 0, w: 1, h: 1 } }] },
    {
      id: "same",
      in: 0,
      out: 1,
      keyframes: [
        { t: 0, crop: { x: 0, y: 0, w: 1, h: 1 } },
        { t: 1, crop: { x: 0, y: 0, w: 1, h: 1 } },
      ],
    },
  ], { fps: 30, durationSeconds: 2 });
  assert.deepEqual(selected, []);
});

test("selectMotionProbes stops after the first eight eligible cuts", () => {
  const cuts = Array.from({ length: 9 }, (_, index) => ({
    id: `c${index}`,
    at: index,
    in: 0,
    out: 1,
    keyframes: cropPoints([0, 0.5, 0.9]),
  }));
  const selected = selectMotionProbes(cuts, { fps: 30, durationSeconds: 10 });
  assert.equal(selected.length, 8);
  assert.deepEqual(selected.map((probe) => probe.cut), ["c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7"]);
});

test("extractGrayFrame uses an input-side seek and returns exactly 14,400 bytes", () => {
  let capturedArgs;
  const extracted = extractGrayFrame({
    outputPath: "out.mp4",
    seconds: 1.25,
    ffmpegCommand: "ffmpeg-test",
    spawnSyncImpl: (_command, args) => {
      capturedArgs = args;
      return { status: 0, stdout: Buffer.alloc(grayBytes, 64), stderr: Buffer.alloc(0) };
    },
  });
  assert.equal(extracted.ok, true);
  assert.equal(extracted.pixels.length, grayBytes);
  assert.ok(capturedArgs.indexOf("-ss") < capturedArgs.indexOf("-i"));
  assert.equal(capturedArgs[capturedArgs.indexOf("-ss") + 1], "1.25");
});

test("extractGrayFrame rejects short rawvideo output", () => {
  const extracted = extractGrayFrame({
    outputPath: "out.mp4",
    seconds: 0,
    spawnSyncImpl: () => ({ status: 0, stdout: Buffer.alloc(10), stderr: Buffer.alloc(0) }),
  });
  assert.equal(extracted.ok, false);
  assert.match(extracted.error, /10 bytes; expected 14400/u);
});

function fakeMotionSpawn(frames) {
  let index = 0;
  return () => ({ status: 0, stdout: frames[index++], stderr: Buffer.alloc(0) });
}

test("judgeMotion warns when declared camera-work frames are highly correlated", () => {
  const patterned = Buffer.from(Array.from({ length: grayBytes }, (_, index) => index % 251));
  const judged = judgeMotion({
    outputPath: "out.mp4",
    cuts: [{ id: "static", at: 0, in: 0, out: 1, keyframes: cropPoints([0, 0.5, 0.9]) }],
    fps: 30,
    durationSeconds: 1,
    spawnSyncImpl: fakeMotionSpawn([patterned, Buffer.from(patterned)]),
  });
  assert.equal(judged.findings[0].severity, "warning");
  assert.match(judged.findings[0].message, /カメラワーク未反映/u);
  assert.equal(judged.records[0].verdict, "warning");
  assert.ok(judged.records[0].ncc >= 0.98);
});

test("judgeMotion skips uniform frames", () => {
  const uniform = Buffer.alloc(grayBytes, 127);
  const judged = judgeMotion({
    outputPath: "out.mp4",
    cuts: [{ id: "uniform", at: 0, in: 0, out: 1, keyframes: cropPoints([0, 0.5, 0.9]) }],
    fps: 30,
    durationSeconds: 1,
    spawnSyncImpl: fakeMotionSpawn([uniform, uniform]),
  });
  assert.deepEqual(judged.findings, []);
  assert.equal(judged.records[0].verdict, "skipped");
  assert.equal(judged.records[0].skipped, "uniform");
});

test("judgeMotion records info for visibly different frames", () => {
  const ascending = Buffer.from(Array.from({ length: grayBytes }, (_, index) => index % 251));
  const descending = Buffer.from(Array.from(ascending, (value) => 250 - value));
  const judged = judgeMotion({
    outputPath: "out.mp4",
    cuts: [{ id: "moving", at: 0, in: 0, out: 1, keyframes: cropPoints([0, 0.5, 0.9]) }],
    fps: 30,
    durationSeconds: 1,
    spawnSyncImpl: fakeMotionSpawn([ascending, descending]),
  });
  assert.equal(judged.findings[0].severity, "info");
  assert.equal(judged.records[0].verdict, "pass");
  assert.ok(judged.records[0].ncc < 0.98);
});

test("verifyArtifact appends declared checks after the unchanged eleven checks and keeps measured closed", () => {
  const metadata = {
    streams: [
      { codec_type: "video", codec_name: "h264", profile: "High", width: 320, height: 180, pix_fmt: "yuv420p", color_range: "tv", avg_frame_rate: "10/1" },
      { codec_type: "audio", codec_name: "aac" },
    ],
    format: { duration: "2" },
  };
  const calls = [];
  const verification = verifyArtifact({
    outputPath: "out.mp4",
    plan: {
      predicted_duration_seconds: 2,
      duration_tolerance_seconds: 0.2,
      preset: { width: 320, height: 180, fps: 10 },
      commands: { audio_mix: { hasNarration: true, hasAudibleAudio: true } },
    },
    edit: { cuts: [], audio: { narration: [{ path: "n.wav", t: 0 }] } },
    ffprobeCommand: "ffprobe-test",
    ffmpegCommand: "ffmpeg-test",
    spawnSyncImpl: (command, args) => {
      calls.push({ command, args });
      if (command === "ffprobe-test") return { status: 0, stdout: JSON.stringify(metadata), stderr: "" };
      if (args.includes("-progress")) return { status: 0, stdout: "frame=20\nprogress=end\n", stderr: "" };
      return { status: 0, stdout: "", stderr: "mean_volume: -21.0 dB\nmax_volume: -3.0 dB\n" };
    },
  });
  assert.equal(verification.verdict, "pass");
  assert.deepEqual(verification.findings.slice(0, 11).map((finding) => finding.check), [
    "verify.duration",
    "verify.frame-count",
    "verify.resolution",
    "verify.fps",
    "verify.video-codec",
    "verify.video-profile",
    "verify.pixel-format",
    "verify.color-range",
    "verify.audio",
    "verify.narration-audio",
    "verify.decode",
  ]);
  assert.equal(verification.findings[11].check, "verify.audio-level");
  assert.deepEqual(Object.keys(verification.measured), [
    "duration_seconds",
    "width",
    "height",
    "fps",
    "video_codec",
    "video_profile",
    "pixel_format",
    "color_range",
    "audio_codec",
    "frame_count",
  ]);
  assert.equal(verification.declared.audio_level.verdict, "pass");
  assert.deepEqual(verification.declared.motion, []);
  assert.deepEqual(verification.declared.blank_frames, []);
  assert.equal(calls.length, 4);
});

test("verifyArtifact keeps pass when motion measurement adds a static-camera warning", () => {
  const metadata = {
    streams: [
      { codec_type: "video", codec_name: "h264", profile: "High", width: 320, height: 180, pix_fmt: "yuv420p", color_range: "tv", avg_frame_rate: "10/1" },
      { codec_type: "audio", codec_name: "aac" },
    ],
    format: { duration: "2" },
  };
  const patterned = Buffer.from(Array.from({ length: grayBytes }, (_, index) => index % 251));
  const verification = verifyArtifact({
    outputPath: "out.mp4",
    plan: {
      predicted_duration_seconds: 2,
      duration_tolerance_seconds: 0.2,
      preset: { width: 320, height: 180, fps: 10 },
      commands: { audio_mix: { hasNarration: false, hasAudibleAudio: true } },
    },
    edit: {
      audio: { bgm: { path: "bgm.wav" } },
      cuts: [{ id: "static", at: 0, in: 0, out: 2, keyframes: cropPoints([0, 1, 1.9]) }],
    },
    ffprobeCommand: "ffprobe-test",
    ffmpegCommand: "ffmpeg-test",
    spawnSyncImpl: (command, args) => {
      if (command === "ffprobe-test") return { status: 0, stdout: JSON.stringify(metadata), stderr: "" };
      if (args.includes("-progress")) return { status: 0, stdout: "frame=20\nprogress=end\n", stderr: "" };
      if (args.includes("volumedetect")) return { status: 0, stdout: "", stderr: "mean_volume: -21.0 dB\nmax_volume: -3.0 dB\n" };
      return { status: 0, stdout: patterned, stderr: Buffer.alloc(0) };
    },
  });
  assert.equal(verification.verdict, "pass");
  assert.equal(verification.findings.find((finding) => finding.check === "verify.motion-static")?.severity, "warning");
  assert.equal(verification.declared.motion[0].verdict, "warning");
});

test("CLI verification warnings are logged before PASS and do not change exit code", () => {
  const lines = [];
  const exitCode = logVerificationResult({
    plan: { output: "exports/out.mp4" },
    verify: {
      verdict: "pass",
      findings: [{ severity: "warning", check: "verify.motion-static", message: "cut c1: NCC 1.0000" }],
    },
  }, { log: (line) => lines.push(line) });
  assert.equal(exitCode, 0);
  assert.deepEqual(lines, [
    "WARN verify.motion-static: cut c1: NCC 1.0000",
    "PASS: exports/out.mp4",
  ]);
});

test("warning verification still creates a receipt with the unchanged closed payload", async () => {
  const root = await mkdtemp(join(tmpdir(), "render-cut-declared-receipt-"));
  try {
    const editText = '{"version":0,"output":{"width":320,"height":180,"fps":10},"source":{"path":"source.mp4"},"cuts":[],"overlays":[]}\n';
    await writeFile(join(root, "edit.json"), editText, "utf8");
    await mkdir(join(root, ".akari"));
    await mkdir(join(root, "exports"));
    const outputPath = join(root, "exports", "final.mp4");
    await writeFile(outputPath, "artifact", "utf8");
    const edit = JSON.parse(editText);
    const declaredInputs = await enumerateDeclaredRenderInputs({ projectRoot: root, edit, editText });
    const inputSnapshot = await hashDeclaredRenderInputs(declaredInputs, { useConsumedText: true });
    const ffprobe = { duration_seconds: 1, width: 320, height: 180, fps: 10 };
    const receipt = await createImmutableRenderReceipt({
      projectRoot: root,
      declaredInputs,
      inputSnapshot,
      outputPath,
      ffprobe,
      plan: { output: "exports/final.mp4", commands: {} },
      verify: {
        verdict: "pass",
        findings: [{ severity: "warning", check: "verify.motion-static", message: "warning" }],
        measured: ffprobe,
        declared: { audio_level: { verdict: "warning" }, motion: [] },
      },
      tools: { node: "fixture", ffmpeg: "fixture", ffprobe: "fixture" },
      createdAt: "2026-09-02T00:00:00.000Z",
    });
    assert.deepEqual(Object.keys(receipt.payload), [
      "version",
      "receipt_scope",
      "createdAt",
      "inputs",
      "output",
      "plan_sha256",
      "lint_sha256",
      "lint_state",
      "review_sha256",
      "review_state",
      "verify",
      "tools",
    ]);
    assert.deepEqual(receipt.payload.output.ffprobe, ffprobe);
    assert.deepEqual(receipt.payload.verify, { verdict: "pass" });
    assert.equal("declared" in receipt.payload, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("render report gives verification warnings their yellow warning class", () => {
  const html = renderReport({
    version: 1,
    phase: "verified",
    inputs: {},
    warnings: [],
    plan: {
      output: "exports/final.mp4",
      predicted_duration_seconds: 1,
      preset: { width: 320, height: 180, fps: 10 },
      rasterizer: { selected: "gpu" },
      intermediates: [],
      commands: {},
    },
    provenance: { rasterizer: { adopted: "gpu", attempts: [] } },
    verify: {
      verdict: "pass",
      findings: [{ severity: "warning", check: "verify.motion-static", message: "warning" }],
    },
    artifacts: [],
  }, "reports/render-report.html", ".");
  assert.match(html, /\.warning \{ color: #f5c451; \}/u);
  assert.match(html, /<li class="warning"><code>verify\.motion-static<\/code>/u);
});

test("render report shows the verification-only GPU force stamp only when recorded in state", () => {
  const state = {
    version: 1,
    phase: "planned",
    inputs: {},
    warnings: [],
    plan: {
      output: "exports/final.mp4",
      predicted_duration_seconds: 1,
      preset: { width: 320, height: 180, fps: 10 },
      rasterizer: { selected: "gpu" },
      intermediates: [],
      commands: {},
    },
    provenance: { rasterizer: { adopted: null, attempts: [] } },
    artifacts: [],
  };
  assert.doesNotMatch(renderReport(state, "reports/render-report.html", "."), /検証用（GPU 強制）/u);
  assert.match(renderReport({ ...state, gpu_forced: true }, "reports/render-report.html", "."), /検証用（GPU 強制）/u);
});

test("real ffmpeg measures audible and silent ten-second signals", async (t) => {
  if (!ffmpegAvailable) return t.skip("ffmpeg unavailable");
  const directory = await mkdtemp(join(tmpdir(), "render-cut-verify-audio-"));
  try {
    const tone = join(directory, "tone.wav");
    const silence = join(directory, "silence.wav");
    runFfmpeg(["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "10", "-c:a", "pcm_s16le", tone]);
    runFfmpeg(["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "10", "-c:a", "pcm_s16le", silence]);

    const audible = measureAudioLevel({ outputPath: tone, durationSeconds: 10 });
    assert.equal(audible.ok, true);
    assert.ok(audible.max_db > -20, JSON.stringify(audible));
    assert.equal(audioJudgement({ declared: true, maxDb: audible.max_db }).finding.severity, "info");

    const silent = measureAudioLevel({ outputPath: silence, durationSeconds: 10 });
    assert.equal(silent.ok, true);
    assert.ok(silent.max_db < -80, JSON.stringify(silent));
    assert.equal(audioJudgement({ declared: true, maxDb: silent.max_db }).finding.severity, "error");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("real ffmpeg video without an audio stream records audio-level as skipped", async (t) => {
  if (!ffmpegAvailable || !ffprobeAvailable) return t.skip("ffmpeg/ffprobe unavailable");
  const directory = await mkdtemp(join(tmpdir(), "render-cut-verify-no-audio-"));
  try {
    const outputPath = join(directory, "video-only.mp4");
    runFfmpeg([
      "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=10:duration=2",
      "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p", "-an", outputPath,
    ]);
    const verification = verifyArtifact({
      outputPath,
      plan: {
        predicted_duration_seconds: 2,
        duration_tolerance_seconds: 0.2,
        preset: { width: 320, height: 180, fps: 10 },
        commands: { audio_mix: { hasNarration: false, hasAudibleAudio: false } },
      },
      ffprobeCommand: "ffprobe",
      ffmpegCommand: "ffmpeg",
    });
    assert.equal(verification.declared.audio_level.verdict, "skipped");
    assert.equal(verification.findings.some((finding) => finding.check === "verify.audio-level"), false);
    assert.equal(verification.findings.find((finding) => finding.check === "verify.audio")?.severity, "error");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("real ffmpeg distinguishes static, uniform, and moving output frames", async (t) => {
  if (!ffmpegAvailable || !ffprobeAvailable) return t.skip("ffmpeg/ffprobe unavailable");
  const directory = await mkdtemp(join(tmpdir(), "render-cut-verify-motion-"));
  try {
    const staticVideo = join(directory, "static.mp4");
    const uniformVideo = join(directory, "uniform.mp4");
    const movingVideo = join(directory, "moving.mp4");
    runFfmpeg(["-f", "lavfi", "-i", "testsrc2=size=320x180:rate=1", "-frames:v", "1", join(directory, "pattern.png")]);
    runFfmpeg(["-loop", "1", "-i", join(directory, "pattern.png"), "-t", "10", "-r", "30", "-pix_fmt", "yuv420p", "-an", staticVideo]);
    runFfmpeg(["-f", "lavfi", "-i", "color=c=gray:size=320x180:rate=30", "-t", "10", "-pix_fmt", "yuv420p", "-an", uniformVideo]);
    runFfmpeg(["-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30", "-t", "10", "-pix_fmt", "yuv420p", "-an", movingVideo]);
    const cuts = [{ id: "motion", at: 0, in: 0, out: 10, keyframes: cropPoints() }];

    const staticResult = judgeMotion({ outputPath: staticVideo, cuts, fps: 30, durationSeconds: 10 });
    assert.equal(staticResult.records[0].verdict, "warning");
    assert.ok(staticResult.records[0].ncc >= 0.98);

    const uniformResult = judgeMotion({ outputPath: uniformVideo, cuts, fps: 30, durationSeconds: 10 });
    assert.equal(uniformResult.records[0].skipped, "uniform");

    const movingResult = judgeMotion({ outputPath: movingVideo, cuts, fps: 30, durationSeconds: 10 });
    assert.equal(movingResult.records[0].verdict, "pass");
    assert.ok(movingResult.records[0].ncc < 0.98);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function runFfmpeg(args) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}
