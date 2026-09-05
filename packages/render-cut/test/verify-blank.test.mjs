import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { logVerificationResult, parseArguments, verifyArtifact } from "../src/render-cut.mjs";
import { renderReport } from "../src/report.mjs";
import {
  BLANK_FRAME_SPREAD_TOLERANCE,
  activeIdsForInterval,
  blankFrameFindings,
  blankIntervalSeverity,
  detectBlankIntervals,
  estimateBackgroundYmax,
  parseSignalstatsMetadata,
  scanBlankFrames,
} from "../src/verify-blank.mjs";

const ffmpegAvailable = spawnSync("ffmpeg", ["-version"]).status === 0;
const fps = 30;
const frame = 1 / fps;

function metadata(values, sampleFps = fps) {
  return values.map((ymax, index) => [
    `[Parsed_metadata_1] frame:${index} pts:${index} pts_time:${index / sampleFps}`,
    `[Parsed_metadata_1] lavfi.signalstats.YMAX=${ymax}`,
  ].join("\n")).join("\n");
}

function metadataWithRanges(values, sampleFps = fps) {
  return values.map(({ ymin, ymax }, index) => [
    `[Parsed_metadata_1] frame:${index} pts:${index} pts_time:${index / sampleFps}`,
    `[Parsed_metadata_1] lavfi.signalstats.YMIN=${ymin}`,
    `[Parsed_metadata_2] frame:${index} pts:${index} pts_time:${index / sampleFps}`,
    `[Parsed_metadata_2] lavfi.signalstats.YMAX=${ymax}`,
  ].join("\n")).join("\n");
}

function runFfmpeg(args) {
  const result = spawnSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
}

async function makeFourPartFixture(path) {
  runFfmpeg([
    "-f", "lavfi", "-i", `color=c=black:size=160x90:rate=${fps}:duration=1`,
    "-f", "lavfi", "-i", `testsrc2=size=160x90:rate=${fps}:duration=1`,
    "-f", "lavfi", "-i", `color=c=black:size=160x90:rate=${fps}:duration=0.5`,
    "-f", "lavfi", "-i", `testsrc2=size=160x90:rate=${fps}:duration=1`,
    "-filter_complex", "[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0[v]",
    "-map", "[v]", "-c:v", "ffv1", path,
  ]);
}

test("signalstats parser and lower-five-percent background estimator are deterministic", () => {
  const parsed = parseSignalstatsMetadata(metadata([16, 16, 235]));
  assert.deepEqual(parsed.map(({ frame: number, pts_time, ymax }) => ({ number, pts_time, ymax })), [
    { number: 0, pts_time: 0, ymax: 16 },
    { number: 1, pts_time: 1 / fps, ymax: 16 },
    { number: 2, pts_time: 2 / fps, ymax: 235 },
  ]);
  assert.equal(estimateBackgroundYmax(Array.from({ length: 100 }, (_, index) => index)), 2);
});

test("signalstats parser assembles YMIN and YMAX per frame and keeps YMAX-only compatibility", () => {
  assert.deepEqual(parseSignalstatsMetadata(metadataWithRanges([
    { ymin: 16, ymax: 16 },
    { ymin: 18, ymax: 34 },
  ])), [
    { frame: 0, pts: 0, pts_time: 0, ymin: 16, ymax: 16 },
    { frame: 1, pts: 1, pts_time: 1 / fps, ymin: 18, ymax: 34 },
  ]);
  assert.deepEqual(parseSignalstatsMetadata(metadata([16], 10)), [
    { frame: 0, pts: 0, pts_time: 0, ymax: 16 },
  ]);
  assert.deepEqual(detectBlankIntervals(parseSignalstatsMetadata(metadata(Array(10).fill(16), 10)), {
    fps: 10,
    backgroundYmax: 16,
  }), [{ start: 0, duration: 1, ymax_max: 16 }]);
});

test("signalstats parser merges duplicate headings from the two metadata filters", () => {
  const output = [
    "[Parsed_metadata_1 @ 0x100] frame:0    pts:0       pts_time:0",
    "[Parsed_metadata_1 @ 0x100] lavfi.signalstats.YMIN=16",
    "[Parsed_metadata_2 @ 0x200] frame:0    pts:0       pts_time:0",
    "[Parsed_metadata_2 @ 0x200] lavfi.signalstats.YMAX=32",
  ].join("\n");
  assert.deepEqual(parseSignalstatsMetadata(output), [
    { frame: 0, pts: 0, pts_time: 0, ymin: 16, ymax: 32 },
  ]);
});

test("signalstats parser requires both frame and pts to match before merging headings", () => {
  const output = [
    "[Parsed_metadata_1 @ 0x100] frame:0 pts:0 pts_time:0",
    "[Parsed_metadata_1 @ 0x100] lavfi.signalstats.YMAX=16",
    "[Parsed_metadata_2 @ 0x200] frame:0 pts:1 pts_time:1",
    "[Parsed_metadata_2 @ 0x200] lavfi.signalstats.YMAX=32",
  ].join("\n");
  assert.deepEqual(parseSignalstatsMetadata(output), [
    { frame: 0, pts: 0, pts_time: 0, ymax: 16 },
    { frame: 0, pts: 1, pts_time: 1, ymax: 32 },
  ]);
});

test("interval detection reports 0.3 seconds and drops a 0.2-second run", () => {
  const samples = parseSignalstatsMetadata(metadata([
    ...Array(9).fill(16), ...Array(3).fill(200), ...Array(6).fill(16), ...Array(3).fill(200),
  ]));
  assert.deepEqual(detectBlankIntervals(samples, { fps, backgroundYmax: 16 }), [
    { start: 0, duration: 0.3, ymax_max: 16 },
  ]);
});

test("spread gate rejects non-flat frames independently of the YMAX threshold", () => {
  const samples = parseSignalstatsMetadata(metadataWithRanges([
    ...Array(10).fill({ ymin: 16, ymax: 32 }),
    ...Array(10).fill({ ymin: 16, ymax: 33 }),
  ], 10));
  assert.deepEqual(detectBlankIntervals(samples, {
    fps: 10,
    backgroundYmax: 33,
    spreadTolerance: BLANK_FRAME_SPREAD_TOLERANCE,
  }), [{ start: 0, duration: 1, ymax_max: 32 }]);
});

test("active IDs use overlay timing plus explicit and sequential cut output timing", () => {
  const edit = {
    overlays: [{ id: "title", start: 0.2, duration: 0.4 }],
    cuts: [
      { id: "first", in: 0, out: 2, speed: 2 },
      { id: "second", in: 4, out: 5 },
      { id: "explicit", at: 4, duration: 2 },
    ],
  };
  assert.deepEqual(activeIdsForInterval(edit, { start: 0, duration: 1 }), {
    active_overlays: ["title"],
    active_cuts: ["first"],
  });
  assert.deepEqual(activeIdsForInterval(edit, { start: 1, duration: 1 }), {
    active_overlays: [],
    active_cuts: ["second"],
  });
});

test("severity and findings are warning only with active declarations and never error", () => {
  const info = { start: 0, duration: 1, ymax_max: 16, active_overlays: [], active_cuts: [] };
  const warning = { ...info, active_overlays: ["title"] };
  assert.equal(blankIntervalSeverity(info), "info");
  assert.equal(blankIntervalSeverity(warning), "warning");
  const findings = blankFrameFindings([
    { ...info, severity: "info" },
    { ...warning, severity: "warning" },
  ]);
  assert.deepEqual(findings.map(({ check, severity }) => ({ check, severity })), [
    { check: "verify.blank-frames", severity: "info" },
    { check: "verify.blank-frames", severity: "warning" },
  ]);
});

test("scan invokes one injected signalstats plus metadata pass", () => {
  const calls = [];
  const result = scanBlankFrames({
    outputPath: "out.mp4",
    fps: 10,
    ffmpegCommand: "ffmpeg-test",
    spawnSyncImpl: (command, args) => {
      calls.push({ command, args });
      return { status: 0, stdout: "", stderr: metadata(Array(10).fill(16), 10) };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "ffmpeg-test");
  assert.equal(calls[0].args[calls[0].args.indexOf("-vf") + 1], "signalstats,metadata=print:key=lavfi.signalstats.YMIN,metadata=print:key=lavfi.signalstats.YMAX");
  assert.equal(result.intervals.length, 1);
});

test("real lavfi four-part fixture reports two blank intervals within one frame", async (t) => {
  if (!ffmpegAvailable) return t.skip("ffmpeg unavailable");
  const directory = await mkdtemp(join(tmpdir(), "render-cut-blank-"));
  try {
    const path = join(directory, "four-part.mkv");
    await makeFourPartFixture(path);
    const result = scanBlankFrames({ outputPath: path, fps });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.intervals.length, 2, JSON.stringify(result, null, 2));
    const expected = [{ start: 0, duration: 1 }, { start: 2, duration: 0.5 }];
    for (const [index, interval] of result.intervals.entries()) {
      assert.ok(Math.abs(interval.start - expected[index].start) <= frame, JSON.stringify(interval));
      assert.ok(Math.abs(interval.duration - expected[index].duration) <= frame, JSON.stringify(interval));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("real 0.2-second dark transition is not reported", async (t) => {
  if (!ffmpegAvailable) return t.skip("ffmpeg unavailable");
  const directory = await mkdtemp(join(tmpdir(), "render-cut-blank-short-"));
  try {
    const path = join(directory, "short.mkv");
    runFfmpeg([
      "-f", "lavfi", "-i", `testsrc2=size=160x90:rate=${fps}:duration=0.5`,
      "-f", "lavfi", "-i", `color=c=black:size=160x90:rate=${fps}:duration=0.2`,
      "-f", "lavfi", "-i", `testsrc2=size=160x90:rate=${fps}:duration=0.5`,
      "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]",
      "-map", "[v]", "-c:v", "ffv1", path,
    ]);
    assert.deepEqual(scanBlankFrames({ outputPath: path, fps }).intervals, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("--no-verify-blank disables scanning and records zero intervals", () => {
  assert.equal(parseArguments(["/project"]).verifyBlank, true);
  assert.equal(parseArguments(["/project", "--no-verify-blank"]).verifyBlank, false);
  let signalstatsCalls = 0;
  const verification = verifyArtifact({
    outputPath: "out.mp4",
    plan: {
      predicted_duration_seconds: 1,
      duration_tolerance_seconds: 0.1,
      preset: { width: 160, height: 90, fps: 10 },
      commands: { audio_mix: { hasNarration: false, hasAudibleAudio: false } },
    },
    edit: { overlays: [], cuts: [] },
    ffprobeCommand: "ffprobe-test",
    ffmpegCommand: "ffmpeg-test",
    verifyBlank: false,
    spawnSyncImpl: (command, args) => {
      if (command === "ffprobe-test") return {
        status: 0,
        stdout: JSON.stringify({
          streams: [{ codec_type: "video", codec_name: "h264", profile: "High", width: 160, height: 90, pix_fmt: "yuv420p", color_range: "tv", avg_frame_rate: "10/1" }],
          format: { duration: "1" },
        }),
        stderr: "",
      };
      if (args.includes("signalstats,metadata=print:key=lavfi.signalstats.YMIN,metadata=print:key=lavfi.signalstats.YMAX")) signalstatsCalls += 1;
      return { status: 0, stdout: "frame=10\nprogress=end\n", stderr: "" };
    },
  });
  assert.equal(signalstatsCalls, 0);
  assert.deepEqual(verification.declared.blank_frames, []);
  assert.equal(verification.findings.some(({ check }) => check === "verify.blank-frames"), false);
});

test("blank warning is written to stderr and the HTML report includes the interval table", () => {
  const output = { log: [], error: [] };
  const interval = {
    start: 1,
    duration: 0.5,
    ymax_max: 16,
    active_overlays: ["title"],
    active_cuts: [],
    severity: "warning",
  };
  const finding = blankFrameFindings([interval])[0];
  const state = {
    version: 1,
    phase: "verified",
    inputs: {},
    warnings: [],
    plan: {
      output: "exports/final.mp4",
      predicted_duration_seconds: 2,
      preset: { width: 160, height: 90, fps: 30 },
      rasterizer: { selected: "gpu" },
      intermediates: [],
      commands: {},
    },
    provenance: { rasterizer: { adopted: "gpu", attempts: [] } },
    verify: { verdict: "pass", findings: [finding], declared: { blank_frames: [interval] } },
    artifacts: [],
  };
  assert.equal(logVerificationResult(state, {
    log: (line) => output.log.push(line),
    error: (line) => output.error.push(line),
  }), 0);
  assert.match(output.error[0], /^WARN verify\.blank-frames:/u);
  assert.deepEqual(output.log, ["PASS: exports/final.mp4"]);
  const html = renderReport(state, "reports/render-report.html", ".");
  assert.match(html, /<h2>Blank-frame scan<\/h2>/u);
  assert.match(html, /<code>title<\/code>/u);
  assert.match(html, /minimum reported continuous interval is 0\.3 seconds/u);
});

test("findings append background_ymax and spread tolerance without changing the existing prefix", () => {
  const interval = {
    start: 1,
    duration: 0.5,
    ymax_max: 16,
    active_overlays: ["title"],
    active_cuts: [],
    severity: "warning",
  };
  const legacyMessage = blankFrameFindings([interval])[0].message;
  const message = blankFrameFindings([interval], {
    backgroundYmax: 16,
    spreadTolerance: BLANK_FRAME_SPREAD_TOLERANCE,
  })[0].message;
  assert.equal(legacyMessage, "空フレーム候補 1s–1.5s（0.5 秒、YMAX 最大 16）; 活性 overlay:title");
  assert.equal(message, `${legacyMessage}; background_ymax 16; spread 許容 16`);
});

test("a detected blank-frame warning does not change verifyArtifact's pass verdict", () => {
  const verification = verifyArtifact({
    outputPath: "out.mp4",
    plan: {
      predicted_duration_seconds: 1,
      duration_tolerance_seconds: 0.1,
      preset: { width: 160, height: 90, fps: 10 },
      commands: { audio_mix: { hasNarration: false, hasAudibleAudio: true } },
    },
    edit: {
      audio: { bgm: { path: "bgm.wav" } },
      overlays: [{ id: "title", start: 0, duration: 1 }],
      cuts: [],
    },
    ffprobeCommand: "ffprobe-test",
    ffmpegCommand: "ffmpeg-test",
    spawnSyncImpl: (command, args) => {
      if (command === "ffprobe-test") return {
        status: 0,
        stdout: JSON.stringify({
          streams: [
            { codec_type: "video", codec_name: "h264", profile: "High", width: 160, height: 90, pix_fmt: "yuv420p", color_range: "tv", avg_frame_rate: "10/1" },
            { codec_type: "audio", codec_name: "aac" },
          ],
          format: { duration: "1" },
        }),
        stderr: "",
      };
      if (args.includes("-progress")) return { status: 0, stdout: "frame=10\nprogress=end\n", stderr: "" };
      if (args.includes("volumedetect")) return { status: 0, stdout: "", stderr: "mean_volume: -20.0 dB\nmax_volume: -3.0 dB\n" };
      return { status: 0, stdout: "", stderr: metadata(Array(10).fill(16), 10) };
    },
  });
  const finding = verification.findings.find(({ check }) => check === "verify.blank-frames");
  assert.equal(finding?.severity, "warning");
  assert.equal(verification.verdict, "pass");
});

test("active overlay ID is attached to a real detected interval as warning", async (t) => {
  if (!ffmpegAvailable) return t.skip("ffmpeg unavailable");
  const directory = await mkdtemp(join(tmpdir(), "render-cut-blank-id-"));
  try {
    const path = join(directory, "four-part.mkv");
    await makeFourPartFixture(path);
    const result = scanBlankFrames({
      outputPath: path,
      fps,
      edit: { overlays: [{ id: "expected-title", start: 0.25, duration: 0.5 }], cuts: [] },
    });
    assert.deepEqual(result.intervals[0].active_overlays, ["expected-title"]);
    assert.equal(result.intervals[0].severity, "warning");
    assert.equal(result.findings[0].severity, "warning");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a one-second white background is detected by relative YMAX sticking", async (t) => {
  if (!ffmpegAvailable) return t.skip("ffmpeg unavailable");
  const directory = await mkdtemp(join(tmpdir(), "render-cut-blank-white-"));
  try {
    const path = join(directory, "white.mkv");
    runFfmpeg([
      "-f", "lavfi", "-i", `color=c=white:size=160x90:rate=${fps}:duration=1`,
      "-c:v", "ffv1", path,
    ]);
    const result = scanBlankFrames({ outputPath: path, fps });
    assert.equal(result.intervals.length, 1, JSON.stringify(result, null, 2));
    assert.ok(result.background_ymax > 200, JSON.stringify(result));
    assert.ok(Math.abs(result.intervals[0].duration - 1) <= frame);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("real dark grid with a moving box is not reported as blank", async (t) => {
  if (!ffmpegAvailable) return t.skip("ffmpeg unavailable");
  const directory = await mkdtemp(join(tmpdir(), "render-cut-blank-grid-"));
  try {
    const path = join(directory, "dark-grid.mkv");
    runFfmpeg([
      "-f", "lavfi", "-i", `color=c=0x0a0d14:size=320x180:rate=${fps}:duration=1.5,drawgrid=width=32:height=32:thickness=2:color=0xb4b4b4,drawbox=x='mod(t*160\\,280)':y=70:w=28:h=28:color=0x9aa0ff:t=fill`,
      "-c:v", "ffv1", path,
    ]);
    const result = scanBlankFrames({ outputPath: path, fps });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.intervals.length, 0, JSON.stringify(result, null, 2));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("real flat black and middle-gray frames are each reported as one interval", async (t) => {
  if (!ffmpegAvailable) return t.skip("ffmpeg unavailable");
  const directory = await mkdtemp(join(tmpdir(), "render-cut-blank-flat-"));
  try {
    for (const [name, color] of [["black", "black"], ["gray", "0x808080"]]) {
      const path = join(directory, `${name}.mkv`);
      runFfmpeg([
        "-f", "lavfi", "-i", `color=c=${color}:size=320x180:rate=${fps}:duration=1`,
        "-c:v", "ffv1", path,
      ]);
      const result = scanBlankFrames({ outputPath: path, fps });
      assert.equal(result.ok, true, result.error);
      assert.equal(result.intervals.length, 1, `${name}: ${JSON.stringify(result, null, 2)}`);
      assert.ok(Math.abs(result.intervals[0].duration - 1) <= frame, JSON.stringify(result));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("real testsrc2 and dark-grid concat is not reported as blank", async (t) => {
  if (!ffmpegAvailable) return t.skip("ffmpeg unavailable");
  const directory = await mkdtemp(join(tmpdir(), "render-cut-blank-grid-concat-"));
  try {
    const path = join(directory, "grid-concat.mkv");
    runFfmpeg([
      "-f", "lavfi", "-i", `testsrc2=size=320x180:rate=${fps}:duration=2`,
      "-f", "lavfi", "-i", `color=c=0x0a0d14:size=320x180:rate=${fps}:duration=1.5,drawgrid=width=32:height=32:thickness=2:color=0xb4b4b4,drawbox=x='mod(t*160\\,280)':y=70:w=28:h=28:color=0x9aa0ff:t=fill`,
      "-f", "lavfi", "-i", `testsrc2=size=320x180:rate=${fps}:duration=2`,
      "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]",
      "-map", "[v]", "-c:v", "ffv1", path,
    ]);
    const result = scanBlankFrames({ outputPath: path, fps });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.intervals.length, 0, JSON.stringify(result, null, 2));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
