import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildGapAwareMultiSourceAudioCutCommand } from "../src/plan.mjs";
import { cutSpeed, resolveCutSegments, segmentDuration } from "../src/cut-timeline.mjs";
import { resolveFfmpeg, resolveFfprobe } from "../../media-bin/src/index.mjs";
import { vendorBinaryPath } from "../../media-bin/src/binary-manifest.mjs";
import { buildAtempoChain } from "../../media-bin/src/speech-atempo.mjs";
import { isCutAudioAudible } from "../../edit-store/lib/index.js";

// cut-timeline.test.mjs と同じく、呼び出し元のない private helper も実ソースから検査する。
const planSource = readFileSync(new URL("../src/plan.mjs", import.meta.url), "utf8");
function planFunction(name) {
  const start = planSource.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return planSource.slice(start, planSource.indexOf("\n}\n", start) + 2);
}
const appendNonSeekAudio = new Function("cutSpeed", "segmentDuration", "buildAtempoChain", "isCutAudioAudible", [
  planFunction("formatNumber"), planFunction("cutSpeechVolumeSuffix"),
  planFunction("appendAudioEndPaddingWarning"), planFunction("appendGapAwareAudioFilters"),
  "return appendGapAwareAudioFilters;",
].join("\n"))(cutSpeed, segmentDuration, buildAtempoChain, isCutAudioAudible);

function run(command, args, encoding = "utf8") {
  const result = spawnSync(command, args, { encoding, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, `${result.error ?? ""}\n${result.stderr}`);
  return result.stdout;
}

// 0.25 秒窓の Goertzel 振幅。300 / 900 Hz は窓内で整数周期になる。
function toneAmplitude(pcm, frequency, at) {
  const rate = 48000;
  const count = rate / 4;
  const start = Math.round(at * rate);
  assert.ok((start + count) * 4 <= pcm.length, `missing audio at ${at}s`);
  const coefficient = 2 * Math.cos(2 * Math.PI * frequency / rate);
  let previous = 0;
  let beforePrevious = 0;
  for (let i = 0; i < count; i++) {
    const value = pcm.readFloatLE((start + i) * 4) + coefficient * previous - beforePrevious;
    beforePrevious = previous;
    previous = value;
  }
  return 2 * Math.sqrt(Math.max(0,
    previous ** 2 + beforePrevious ** 2 - coefficient * previous * beforePrevious)) / count;
}

test("gap-aware AAC overlap preserves duration and both tones after a delayed partial-frame trim", async (t) => {
  let ffmpegCommand, ffprobeCommand;
  try {
    // PATH の旧版で回帰を見逃さないよう、同梱バイナリを優先する。
    const bundledFfmpeg = vendorBinaryPath("ffmpeg");
    const bundledFfprobe = vendorBinaryPath("ffprobe");
    ffmpegCommand = existsSync(bundledFfmpeg) ? bundledFfmpeg : resolveFfmpeg();
    ffprobeCommand = existsSync(bundledFfprobe) ? bundledFfprobe : resolveFfprobe();
  } catch (error) {
    return t.skip(`ffmpeg/ffprobe unavailable: ${error.message}`);
  }
  for (const command of [ffmpegCommand, ffprobeCommand]) {
    if (spawnSync(command, ["-version"], { timeout: 10_000 }).status !== 0) {
      return t.skip("ffmpeg/ffprobe unavailable");
    }
  }

  const root = await mkdtemp(join(tmpdir(), "render-cut-gap-amix-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceInputs = [
    { id: "upper", path: join(root, "upper.m4a"), hasAudio: true, inputIndex: 0 },
    { id: "lower", path: join(root, "lower.m4a"), hasAudio: true, inputIndex: 1 },
  ];
  for (const [index, source] of sourceInputs.entries()) {
    run(ffmpegCommand, ["-v", "error", "-nostdin", "-y", "-f", "lavfi", "-i",
      `sine=frequency=${index === 0 ? 900 : 300}:sample_rate=48000:duration=12`,
      "-c:a", "aac", source.path]);
  }
  // 先頭は at > 0、in は映像 / AAC フレーム境界外。seek 経路でも 0.5s の
  // preroll trim が部分音声フレームを作る。at=0 / in=0 が先頭だと修正前でも通る。
  const cuts = [
    { id: "upper", src: "upper", track: 1, at: 2, in: 6.007, out: 10.007 },
    { id: "lower", src: "lower", track: 0, at: 1, in: 0.7, out: 5.7 },
  ];
  const duration = 6;

  for (const route of ["input-seek", "absolute-trim"]) {
    await t.test(route, () => {
      const cutPath = join(root, `${route}.mp4`);
      let command;
      if (route === "input-seek") {
        command = buildGapAwareMultiSourceAudioCutCommand({
          sourceInputs, cuts, cutPath, duration, ffmpegCommand, ffprobeCommand,
        });
      } else {
        const filters = [];
        appendNonSeekAudio({ filters, warnings: [], segments: resolveCutSegments(cuts),
          inputsById: new Map(sourceInputs.map((source) => [source.id, source])),
          duration, ffprobeCommand: null });
        command = { command: ffmpegCommand, args: ["-v", "error", "-nostdin", "-y",
          ...sourceInputs.flatMap((source) => ["-i", source.path]),
          "-filter_complex", filters.join(";"), "-map", "[joineda]",
          "-vn", "-c:a", "aac", "-ar", "48000", cutPath] };
      }
      run(command.command, command.args);
      const probe = JSON.parse(run(ffprobeCommand, ["-v", "error", "-select_streams", "a:0",
        "-show_entries", "stream=codec_name,duration:format=duration", "-of", "json", cutPath]));
      assert.equal(probe.streams?.[0]?.codec_name, "aac");
      for (const measured of [probe.streams[0].duration, probe.format.duration]) {
        assert.ok(Math.abs(Number(measured) - duration) <= 0.03,
          `${route}: expected ${duration}s, got ${measured}s`);
      }
      const pcm = run(ffmpegCommand, ["-v", "error", "-i", cutPath,
        "-map", "0:a:0", "-ac", "1", "-ar", "48000", "-f", "f32le", "pipe:1"], "buffer");
      for (const frequency of [300, 900]) {
        assert.ok(toneAmplitude(pcm, frequency, 0.5) < 0.005, "leading gap must stay silent");
      }
      assert.ok(toneAmplitude(pcm, 300, 1.5) > 0.08, "lower tone must start before the overlap");
      assert.ok(toneAmplitude(pcm, 900, 1.5) < 0.005, "upper tone must not shift before at=2");
      for (const at of [2.5, 3.5, 5.5]) {
        for (const frequency of [300, 900]) {
          const amplitude = toneAmplitude(pcm, frequency, at);
          assert.ok(amplitude > 0.08 && amplitude < 0.17,
            `${route}: ${frequency}Hz at ${at}s has amplitude ${amplitude}`);
        }
      }
    });
  }
});
