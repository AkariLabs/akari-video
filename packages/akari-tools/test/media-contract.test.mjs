import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

import {
  contactSheetCellDimensions,
  contactSheetGridDimensions,
  splitContactSheetCounts,
} from "../../render-cut/src/contact-sheet.mjs";
import { resolveFfmpeg, resolveFfprobe } from "../../media-bin/src/index.mjs";
import { runMediaCli } from "../bin/media.mjs";
import { formatTimecode } from "../src/media/common.mjs";
import { probeMedia } from "../src/media/probe.mjs";
import { normalizeWhisperJson, transcribeMedia } from "../src/media/transcribe.mjs";
import { waveformMedia } from "../src/media/waveform.mjs";

const ffmpeg = resolveFfmpeg();
const ffprobe = resolveFfprobe();
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(packageRoot, "../..");
let fixtureRoot;
let videoPath;
let wavPath;

test.before(async () => {
  fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "akari-media-test-"));
  videoPath = path.join(fixtureRoot, "fixture.mp4");
  wavPath = path.join(fixtureRoot, "silence-tone.wav");
  execFileSync(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc=size=320x180:rate=30:duration=3",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=3",
    "-c:v", "mpeg4", "-q:v", "5", "-c:a", "aac", "-shortest", videoPath,
  ]);
  execFileSync(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-t", "2", "-i", "anullsrc=r=48000:cl=mono",
    "-f", "lavfi", "-t", "3", "-i", "sine=frequency=440:sample_rate=48000",
    "-f", "lavfi", "-t", "1", "-i", "anullsrc=r=48000:cl=mono",
    "-filter_complex", "[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]", "-map", "[out]", "-c:a", "pcm_s16le", wavPath,
  ]);
});

test.after(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});

test("コンタクトシート割付はグリッド・均等割り・寸法上限を満たす", () => {
  assert.deepEqual(contactSheetGridDimensions(1), { cols: 1, rows: 1 });
  assert.deepEqual(contactSheetGridDimensions(4), { cols: 2, rows: 2 });
  assert.deepEqual(contactSheetGridDimensions(9), { cols: 3, rows: 3 });
  assert.deepEqual(contactSheetGridDimensions(12), { cols: 4, rows: 3 });
  assert.deepEqual(splitContactSheetCounts(13), [7, 6]);
  assert.deepEqual(splitContactSheetCounts(25), [9, 8, 8]);
  assert.deepEqual(splitContactSheetCounts(7, 3), [3, 2, 2]);
  for (let count = 1; count <= 12; count += 1) {
    const dimensions = contactSheetCellDimensions({ count, sourceWidth: 3840, sourceHeight: 2160 });
    assert.ok(dimensions.sheetWidth <= 2576);
    assert.ok(dimensions.sheetHeight <= 1456);
  }
});

test("タイムコードは分・秒を2桁、単独フレームを非ゼロ詰めで表す", () => {
  assert.equal(formatTimecode(0), "0f");
  assert.equal(formatTimecode(11), "11s");
  assert.equal(formatTimecode(8.333), "08s10f");
  assert.equal(formatTimecode(65), "01m05s");
});

test("5 コマンドの CLI stdout は JSON または JSON Lines だけ", async () => {
  const invocations = [
    ["probe", videoPath, "--no-record"],
    ["grab", videoPath, "-t", "0", "1.5", "--per-sheet", "2", "--no-record"],
    ["filmstrip", videoPath, "--count", "2", "--no-record"],
    ["waveform", wavPath, "--no-record"],
  ];
  for (const argv of invocations) {
    const lines = [];
    const errors = [];
    const exitCode = await runMediaCli(argv, { stdout: (line) => lines.push(line), stderr: (line) => errors.push(line), ffmpegCommand: ffmpeg, ffprobeCommand: ffprobe });
    assert.equal(exitCode, 0, `${argv[0]}: ${errors.join("\n")}`);
    assert.ok(lines.length >= 1);
    for (const line of lines) assert.doesNotThrow(() => JSON.parse(line));
  }

  const lines = [];
  let backendCalls = 0;
  const exitCode = await runMediaCli(["transcribe", wavPath, "--backend", "speech-analyzer", "--no-record"], {
    stdout: (line) => lines.push(line),
    stderr: () => {},
    ffmpegCommand: ffmpeg,
    ffprobeCommand: ffprobe,
    speechAnalyzerAvailable: true,
    backendRunner: async () => {
      backendCalls += 1;
      return [{ start: 2.1, end: 2.5, text: "tone" }];
    },
  });
  assert.equal(exitCode, 0);
  assert.equal(lines.length, 1);
  assert.doesNotThrow(() => JSON.parse(lines[0]));
  assert.ok(backendCalls <= 1);
});

test("waveform は無音 2 秒 + トーン 3 秒 + 無音 1 秒を ±1 frame で検出する", async () => {
  const result = await waveformMedia(wavPath, { ffmpegCommand: ffmpeg, ffprobeCommand: ffprobe, noRecord: true });
  assert.equal(result.silences.length, 2);
  assert.ok(Math.abs(result.silences[0].start - 0) <= 1 / 30);
  assert.ok(Math.abs(result.silences[0].end - 2) <= 1 / 30);
  assert.ok(Math.abs(result.silences[1].start - 5) <= 1 / 30);
  assert.ok(Math.abs(result.silences[1].end - 6) <= 1 / 30);
});

test("transcribe の 2 回目は内容ハッシュ cache hit で backend を起動しない", async () => {
  const project = await createProjectFixture("cache-project");
  let backendCalls = 0;
  const options = {
    cwd: project,
    ffmpegCommand: ffmpeg,
    ffprobeCommand: ffprobe,
    backend: "speech-analyzer",
    speechAnalyzerAvailable: true,
    backendRunner: async () => {
      backendCalls += 1;
      return [{ start: 0.1, end: 0.5, text: "test", words: [{ start: 0.1, end: 0.5, text: "test" }] }];
    },
  };
  const first = await transcribeMedia("assets/source.wav", options);
  const second = await transcribeMedia("assets/source.wav", options);
  assert.equal(first.cache.hit, false);
  assert.equal(second.cache.hit, true);
  assert.equal(backendCalls, 1);
});

test("transcribe は backend 不在なら exit 1 相当で推測しない", async () => {
  await assert.rejects(
    transcribeMedia(wavPath, { ffmpegCommand: ffmpeg, ffprobeCommand: ffprobe, speechAnalyzerAvailable: false, whisperAvailable: false, noRecord: true }),
    /利用できるローカル文字起こし backend/,
  );
});

test("既定 transcribe は SpeechAnalyzer 実行失敗時だけ whisper.cpp へフォールバックする", async () => {
  const project = await createProjectFixture("fallback-project");
  const calls = [];
  const result = await transcribeMedia("assets/source.wav", {
    cwd: project,
    ffmpegCommand: ffmpeg,
    ffprobeCommand: ffprobe,
    speechAnalyzerAvailable: true,
    whisperBin: "/fixture/whisper-cli",
    whisperModel: "/fixture/ggml.bin",
    backendRunner: async ({ backend }) => {
      calls.push(backend);
      if (backend === "speech-analyzer") throw new Error("helper failed");
      return [{ start: 0.1, end: 0.5, text: "fallback" }];
    },
  });
  assert.deepEqual(calls, ["speech-analyzer", "whisper-cpp"]);
  assert.equal(result.backend, "whisper-cpp");
});

test("帳面は probe → waveform → transcribe の順で追記し、--no-record は無変更", async (t) => {
  const project = await createProjectFixture("record-project");
  const target = "assets/source.wav";
  await probeMedia(target, { cwd: project, ffprobeCommand: ffprobe });
  await waveformMedia(target, { cwd: project, ffmpegCommand: ffmpeg, ffprobeCommand: ffprobe });
  await transcribeMedia(target, {
    cwd: project,
    ffmpegCommand: ffmpeg,
    ffprobeCommand: ffprobe,
    backend: "speech-analyzer",
    speechAnalyzerAvailable: true,
    backendRunner: async () => [{ start: 0.1, end: 0.5, text: "test" }],
  });
  const analysisPath = path.join(project, ".akari", "sidecars", "assets", "source.wav.analysis", "analysis.json");
  const analysis = JSON.parse(readFileSync(analysisPath, "utf8"));
  assert.deepEqual(analysis.observations.map((item) => item.kind), ["probe", "waveform", "transcribe"]);
  assert.equal(analysis.transcript.length, 1);
  assert.ok(analysis.probe);
  assert.ok(analysis.tracks.waveform);
  const canonicalSchema = JSON.parse(readFileSync(path.join(repositoryRoot, "packages", "schemas", "analysis.schema.json"), "utf8"));
  const validate = new Ajv2020({ strict: false }).compile(canonicalSchema);
  assert.equal(validate(analysis), true, JSON.stringify(validate.errors));
  await t.test("shell schema 写しが存在するときは帳面を検証する", (t) => {
    const shellSchemaPath = path.join(repositoryRoot, "apps", "shell", "lib", "schemas", "analysis.schema.json");
    if (!existsSync(shellSchemaPath)) return t.skip("shell のビルド生成物が未生成");
    const validateShell = new Ajv2020({ strict: false }).compile(JSON.parse(readFileSync(shellSchemaPath, "utf8")));
    assert.equal(validateShell(analysis), true, JSON.stringify(validateShell.errors));
  });
  const before = readFileSync(analysisPath, "utf8");
  await probeMedia(target, { cwd: project, ffprobeCommand: ffprobe, noRecord: true });
  assert.equal(readFileSync(analysisPath, "utf8"), before);
});

test("transcribe は非無音の語間隙を unrecognized として結果と analysis.json に記録する", async () => {
  const project = await createProjectFixture("unrecognized-project");
  const result = await transcribeMedia("assets/source.wav", {
    cwd: project,
    ffmpegCommand: ffmpeg,
    ffprobeCommand: ffprobe,
    backend: "speech-analyzer",
    speechAnalyzerAvailable: true,
    backendRunner: async () => [{
      start: 0,
      end: 2,
      text: "前 後",
      words: [{ start: 0.1, end: 0.5, text: "前" }, { start: 1.5, end: 1.9, text: "後" }],
    }],
    silencesRunner: async () => [{ start: 0.5, end: 1.1 }],
  });
  assert.deepEqual(result.segments[0].unrecognized, [{ start: 1.1, end: 1.5 }]);
  const analysisPath = path.join(
    project, ".akari", "sidecars", "assets", "source.wav.analysis", "analysis.json",
  );
  const analysis = JSON.parse(readFileSync(analysisPath, "utf8"));
  assert.deepEqual(analysis.transcript[0].unrecognized, [{ start: 1.1, end: 1.5 }]);
});

test("unrecognized: false は無音検出を呼ばず内部 markers も出力しない", async () => {
  const project = await createProjectFixture("unrecognized-disabled-project");
  let silenceCalls = 0;
  const result = await transcribeMedia("assets/source.wav", {
    cwd: project,
    ffmpegCommand: ffmpeg,
    ffprobeCommand: ffprobe,
    backend: "speech-analyzer",
    speechAnalyzerAvailable: true,
    unrecognized: false,
    backendRunner: async () => [{
      start: 0, end: 1, text: "前", markers: [{ start: 0.5, end: 0.8 }],
    }],
    silencesRunner: async () => { silenceCalls += 1; return []; },
  });
  assert.equal(silenceCalls, 0);
  assert.equal(Object.hasOwn(result.segments[0], "unrecognized"), false);
  assert.equal(Object.hasOwn(result.segments[0], "markers"), false);
});

test("normalizeWhisperJson は control を捨て non-speech の時刻だけ markers に残す", () => {
  const [segment] = normalizeWhisperJson({
    transcription: [{
      offsets: { from: 0, to: 2000 },
      text: "聞き取り",
      tokens: [
        { offsets: { from: 0, to: 100 }, text: "[_SOT_]" },
        { offsets: { from: 100, to: 500 }, text: "聞き" },
        { offsets: { from: 500, to: 900 }, text: "[inaudible]" },
        { offsets: { from: 900, to: 1300 }, text: "取\uFFFDり" },
      ],
    }],
  });
  assert.deepEqual(segment.words, [
    { start: 0.1, end: 0.5, text: "聞き" },
    { start: 0.9, end: 1.3, text: "取り" },
  ]);
  assert.deepEqual(segment.markers, [{ start: 0.5, end: 0.9 }]);
});

test("transcribe CLI は unrecognized の無効化と閾値フラグを解釈する", async () => {
  const project = await createProjectFixture("unrecognized-cli-project");
  let silenceCalls = 0;
  const common = {
    cwd: project,
    ffmpegCommand: ffmpeg,
    ffprobeCommand: ffprobe,
    speechAnalyzerAvailable: true,
    backendRunner: async () => [{
      start: 0,
      end: 1.5,
      text: "前 後",
      words: [{ start: 0, end: 0.5, text: "前" }, { start: 1, end: 1.5, text: "後" }],
    }],
    silencesRunner: async () => { silenceCalls += 1; return []; },
    stderr: () => {},
  };
  const thresholdLines = [];
  const thresholdExit = await runMediaCli([
    "transcribe", "assets/source.wav", "--backend", "speech-analyzer", "--lang", "threshold",
    "--unrecognized-min-gap", "0.6", "--unrecognized-min-voiced", "0.2", "--no-record",
  ], { ...common, stdout: (line) => thresholdLines.push(line) });
  assert.equal(thresholdExit, 0);
  assert.equal(Object.hasOwn(JSON.parse(thresholdLines[0]).segments[0], "unrecognized"), false);

  const disabledLines = [];
  const disabledExit = await runMediaCli([
    "transcribe", "assets/source.wav", "--backend", "speech-analyzer", "--lang", "disabled",
    "--no-unrecognized", "--no-record",
  ], { ...common, stdout: (line) => disabledLines.push(line) });
  assert.equal(disabledExit, 0);
  assert.equal(Object.hasOwn(JSON.parse(disabledLines[0]).segments[0], "unrecognized"), false);
  assert.equal(silenceCalls, 1);
});

test("edit.json 未宣言のプロジェクト内素材にも帳面を作る", async () => {
  const project = await createProjectFixture("unlisted-project", { writeEdit: false });
  await probeMedia("assets/source.wav", { cwd: project, ffprobeCommand: ffprobe });
  assert.equal(existsSync(path.join(project, ".akari", "sidecars", "assets", "source.wav.analysis", "analysis.json")), true);
});

test("プロジェクト外では .akari を作らない", async () => {
  const outside = await mkdtemp(path.join(os.tmpdir(), "akari-media-outside-"));
  const target = path.join(outside, "source.wav");
  writeFileSync(target, readFileSync(wavPath));
  await probeMedia(target, { cwd: outside, ffprobeCommand: ffprobe });
  assert.equal(existsSync(path.join(outside, ".akari")), false);
  await rm(outside, { recursive: true, force: true });
});

test("既定 transcribe は cloud/fetch 経路を呼ばない", async () => {
  let fetchCalls = 0;
  let backendCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetchCalls += 1; throw new Error("network disabled"); };
  try {
    await transcribeMedia(wavPath, {
      ffmpegCommand: ffmpeg,
      ffprobeCommand: ffprobe,
      speechAnalyzerAvailable: true,
      cloudRunner: async () => { throw new Error("cloud child route must not run"); },
      backendRunner: async ({ backend }) => {
        backendCalls += 1;
        assert.equal(backend, "speech-analyzer");
        return [];
      },
      noRecord: true,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(fetchCalls, 0);
  assert.ok(backendCalls <= 1);
});

async function createProjectFixture(name, { writeEdit = true } = {}) {
  const project = path.join(fixtureRoot, name);
  await mkdir(path.join(project, ".akari"), { recursive: true });
  await mkdir(path.join(project, "assets"), { recursive: true });
  writeFileSync(path.join(project, "assets", "source.wav"), readFileSync(wavPath));
  if (writeEdit) writeFileSync(path.join(project, "edit.json"), `${JSON.stringify({ version: 2, sources: [{ id: "source", path: "assets/source.wav" }] })}\n`);
  return project;
}
