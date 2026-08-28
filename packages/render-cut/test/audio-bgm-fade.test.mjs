import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile as rawWriteFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { legacyRenderArgs } from "./helpers/render-engine.mjs";
import { createMigratingWriteFile } from "./helpers/v2-fixture.mjs";

const writeFile = createMigratingWriteFile(rawWriteFile);

import { buildAudioMixCommand } from "../src/plan.mjs";

// audio.bgm.fadeIn/fadeOut (a previously reserved-seat field, opened by this task). L2 requires
// measuring the real rendered output's BGM-band level at several timestamps -- not trusting the
// command plan alone -- in the spirit of audio-narration.test.mjs / audio-master.test.mjs
// (volumedetect/astats over a windowed slice). Unlike those tests' relative/differential
// comparisons, these assert absolute per-instant levels, which requires an *input*-side -ss (see
// measureMeanVolume below) to get a true window rather than a cumulative-from-start average.

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(packageRoot, "bin", "render-cut.mjs");

function run(project, args = [], cli = cliPath) {
  // This suite measures the legacy audio pipeline; engine resolution has separate unit coverage.
  return spawnSync(process.execPath, [cli, project, ...legacyRenderArgs(args)], { encoding: "utf8" });
}

function ffmpeg(args) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result;
}

// -ss must be an *input*-side option (before -i) here, not an output-side one placed after -i.
// Empirically verified: for a non-stationary (e.g. fading) signal, an output-side "-i f -ss s -t d"
// makes volumedetect accumulate over the whole decoded stream from t=0 through s+d (ffmpeg runs the
// full filtergraph from the start and only trims what reaches the muxer), so the reported
// mean_volume keeps drifting toward the file's overall average as `s` grows -- it is not a window at
// all. Input-side "-ss s -i f -t d" performs a real seek before decoding, so only samples in
// [s, s+d) ever reach volumedetect. Confirmed against a known afade=d=3 fixture: output-side placement
// showed mean_volume still rising at t=7.9s of an 8s file; input-side placement correctly reports the
// steady post-fade level from t=3.35s onward.
function measureMeanVolume(filePath, start, duration) {
  const result = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-nostats", "-ss", String(start), "-i", filePath, "-t", String(duration), "-af", "volumedetect", "-f", "null", "-"],
    { encoding: "utf8" },
  );
  const match = result.stderr.match(/mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/);
  assert.ok(match, `volumedetect did not report mean_volume for ${filePath} [${start},${start + duration}]: ${result.stderr}`);
  return Number(match[1]);
}

function makeSilentSourceVideo(path, { width = 320, height = 180, fps = 10, duration }) {
  ffmpeg(["-f", "lavfi", "-i", `testsrc2=size=${width}x${height}:rate=${fps}:duration=${duration}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", path]);
}

function makeTone(path, { frequency = 440, duration, gainDb = 0, sampleRate = 48000 }) {
  ffmpeg(["-f", "lavfi", "-i", `sine=frequency=${frequency}:sample_rate=${sampleRate}:duration=${duration}`, "-af", `volume=${gainDb}dB`, "-c:a", "pcm_s16le", path]);
}

// Builds a render-cut project fixture with a video-only (silent) source and a constant-tone BGM,
// optionally with narration for the ducking-interaction tests. Mirrors audio-narration.test.mjs's
// makeProject so the fade tests measure the real end-to-end CLI output, not just the command plan.
async function makeProject({ duration = 8, bgm = {}, narration = null } = {}) {
  const root = await mkdtemp(join(tmpdir(), "render-cut-bgm-fade-test-"));
  makeSilentSourceVideo(join(root, "source.mp4"), { duration });
  await mkdir(join(root, "audio"));
  makeTone(join(root, "audio", "bgm.wav"), { frequency: 440, duration: Math.max(duration, 1) });

  const audio = { bgm: { path: "audio/bgm.wav", gain_db: 0, ...bgm } };
  if (narration) {
    makeTone(join(root, "audio", "narration.wav"), { frequency: 880, duration: narration.duration ?? duration, gainDb: narration.sourceGainDb ?? 24 });
    audio.narration = [
      { id: "n-0001", path: "audio/narration.wav", t: narration.t ?? 0, gain_db: narration.gainDb ?? 0 },
    ];
  }

  await writeFile(
    join(root, "edit.json"),
    `${JSON.stringify(
      {
        version: 0,
        output: { width: 320, height: 180, fps: 10 },
        source: { path: "source.mp4", proxy: null },
        cuts: [{ in: 0, out: duration }],
        overlays: [],
        audio,
      },
      null,
      2,
    )}\n`,
  );
  await mkdir(join(root, ".akari"));
  await writeFile(join(root, ".akari", "lint.json"), '{"version":1,"verdict":"pass"}\n');
  return root;
}

test("bgm.fadeIn=3 ramps RMS up monotonically at 0.5s/1.5s/3.5s, then holds steady (real rendered output)", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const duration = 8;
  const project = await makeProject({ duration, bgm: { fadeIn: 3 } });
  try {
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass");
    assert.match(state.plan.commands.audio_mix.args.join(" "), /afade=t=in:st=0:d=3/);

    const outputPath = join(project, state.artifacts[0].path);
    const window = 0.3;
    const at05 = measureMeanVolume(outputPath, 0.5 - window / 2, window);
    const at15 = measureMeanVolume(outputPath, 1.5 - window / 2, window);
    const at35 = measureMeanVolume(outputPath, 3.5 - window / 2, window);
    const steadyControl = measureMeanVolume(outputPath, 6 - window / 2, window);
    t.diagnostic(`fadeIn=3 mean_volume: t=0.5s ${at05}dB, t=1.5s ${at15}dB, t=3.5s ${at35}dB, steady(t=6s) ${steadyControl}dB`);

    assert.ok(at05 < at15 - 1, `expected 0.5s (${at05}dB) measurably quieter than 1.5s (${at15}dB)`);
    assert.ok(at15 < at35 - 1, `expected 1.5s (${at15}dB) measurably quieter than 3.5s (${at35}dB)`);
    assert.ok(Math.abs(at35 - steadyControl) < 1, `expected 3.5s (${at35}dB, past the 3s fade) to already be at the steady level (${steadyControl}dB)`);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("bgm.fadeOut=3 is symmetric with fadeIn=3: the tail ramp mirrors the head ramp", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const duration = 12; // fadeIn [0,3], plateau [3,9], fadeOut [9,12] -- no overlap between the two ramps
  const project = await makeProject({ duration, bgm: { fadeIn: 3, fadeOut: 3 } });
  try {
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass");
    assert.match(state.plan.commands.audio_mix.args.join(" "), /afade=t=in:st=0:d=3,afade=t=out:st=9:d=3/);

    const outputPath = join(project, state.artifacts[0].path);
    const window = 0.3;
    const head05 = measureMeanVolume(outputPath, 0.5 - window / 2, window);
    const head15 = measureMeanVolume(outputPath, 1.5 - window / 2, window);
    const tail05 = measureMeanVolume(outputPath, duration - 0.5 - window / 2, window);
    const tail15 = measureMeanVolume(outputPath, duration - 1.5 - window / 2, window);
    const plateau = measureMeanVolume(outputPath, 6 - window / 2, window);
    t.diagnostic(
      `head: t=0.5s ${head05}dB, t=1.5s ${head15}dB; tail: t=${duration - 0.5}s ${tail05}dB, t=${duration - 1.5}s ${tail15}dB; plateau ${plateau}dB`,
    );

    assert.ok(Math.abs(head05 - tail05) < 1, `expected fade-in @0.5s (${head05}dB) to mirror fade-out @${duration - 0.5}s (${tail05}dB)`);
    assert.ok(Math.abs(head15 - tail15) < 1, `expected fade-in @1.5s (${head15}dB) to mirror fade-out @${duration - 1.5}s (${tail15}dB)`);
    assert.ok(tail05 < tail15 - 1, `expected the tail to keep descending toward the end: @${duration - 1.5}s (${tail15}dB) should be louder than @${duration - 0.5}s (${tail05}dB)`);
    assert.ok(plateau > head15 + 1 && plateau > tail15 + 1, `expected the plateau (${plateau}dB) to be measurably louder than either ramp's midpoint (head@1.5s=${head15}dB, tail@${duration - 1.5}s=${tail15}dB), since both are still mid-ramp`);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("bgm.fadeIn/fadeOut omitted keeps the filtergraph free of afade (regression invariant)", async (t) => {
  // 歴史記録: fade 導入コミット時点では実装前 plan.mjs との並走レンダリングで
  // final.mp4 のバイト完全一致を実測済み（内部 bgm-fade タスクの status.json）。
  // 本テストはその不変条件（fade 省略時は afade がフィルタグラフに一切現れない）を
  // git 履歴に依存しない形で恒久検証する。
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const project = await makeProject({ duration: 6, bgm: {} });
  try {
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass");
    const args = state.plan.commands.audio_mix.args;
    const filterComplex = args[args.indexOf("-filter_complex") + 1];
    assert.ok(!filterComplex.includes("afade"), `expected no afade in filter_complex when fade is omitted, got: ${filterComplex}`);
    assert.ok(!args.join(" ").includes("afade"), "expected no afade anywhere in the audio_mix args when fade is omitted");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("bgm.fadeIn exceeding half the timeline duration is clamped at render time (not just linted)", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const duration = 6; // half = 3s; request 10s, way past the clip
  const project = await makeProject({ duration, bgm: { fadeIn: 10 } });
  try {
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    assert.match(executed.stderr, /render-cut warning:.*audio\.bgm\.fadeIn 10s exceeds half the timeline duration \(6s\); clamped to 3s/);

    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass");
    assert.match(state.plan.commands.audio_mix.args.join(" "), /afade=t=in:st=0:d=3(?!\d)/);

    const outputPath = join(project, state.artifacts[0].path);
    const window = 0.3;
    // With the requested (unclamped) 10s fade, 3.5s in would still be deep in the ramp and far
    // quieter than steady state. With the clamped 3s fade, 3.5s in is already past the ramp.
    const at35 = measureMeanVolume(outputPath, 3.5 - window / 2, window);
    const steadyControl = measureMeanVolume(outputPath, 5 - window / 2, window);
    t.diagnostic(`clamped fadeIn: t=3.5s ${at35}dB vs steady control (t=5s) ${steadyControl}dB`);
    assert.ok(Math.abs(at35 - steadyControl) < 1, `expected t=3.5s (${at35}dB) to already be at steady level (${steadyControl}dB) once fadeIn is clamped to 3s`);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

// Design question from the task brief: should afade sit before or after ducking's sidechaincompress
// in the filtergraph? Implemented as "before" (baked into the [bgm] label prior to the ducking
// step). This test empirically checks whether that choice matters: sidechaincompress's gain
// reduction is driven purely by the narration (key/sidechain) input's level, never by bgm's own
// amplitude, so multiplying in a fixed fade envelope before or after it should be commutative.
// Two hand-built filtergraphs -- fade-then-duck (current) and duck-then-fade (the alternative) --
// are rendered from the same inputs and their levels compared directly.
test("afade before vs after sidechaincompress measure the same (confirms the chosen order is not audibly different)", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const root = await mkdtemp(join(tmpdir(), "render-cut-bgm-fade-order-test-"));
  try {
    const duration = 8;
    await mkdir(join(root, "audio"));
    makeTone(join(root, "audio", "bgm.wav"), { frequency: 440, duration });
    // Narration present for the *entire* clip (including the whole fade-in window) so ducking is
    // actively engaged throughout the ramp -- the scenario where order could plausibly matter.
    makeTone(join(root, "audio", "narration.wav"), { frequency: 880, duration, gainDb: 24 });

    const sidechainArgs = "threshold=0.063:ratio=8:attack=5:release=300";
    const fadeIn = 3;

    function render(order) {
      const fadeStep = `afade=t=in:st=0:d=${fadeIn}`;
      const filters =
        order === "fade-then-duck"
          ? [
              `[1:a]volume=0dB,atrim=duration=${duration},${fadeStep}[bgm]`,
              `[2:a]volume=0dB,adelay=0:all=1[nar]`,
              `[bgm][nar]sidechaincompress=${sidechainArgs}[out]`,
            ]
          : [
              `[1:a]volume=0dB,atrim=duration=${duration}[bgm]`,
              `[2:a]volume=0dB,adelay=0:all=1[nar]`,
              `[bgm][nar]sidechaincompress=${sidechainArgs},${fadeStep}[out]`,
            ];
      const outPath = join(root, `${order}.wav`);
      const result = spawnSync(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-nostdin",
          "-y",
          "-f",
          "lavfi",
          "-i",
          `anullsrc=r=48000:cl=stereo:d=${duration}`,
          "-i",
          join(root, "audio", "bgm.wav"),
          "-i",
          join(root, "audio", "narration.wav"),
          "-filter_complex",
          filters.join(";"),
          "-map",
          "[out]",
          "-c:a",
          "pcm_s16le",
          "-ar",
          "48000",
          outPath,
        ],
        { encoding: "utf8" },
      );
      assert.equal(result.status, 0, result.stderr);
      return outPath;
    }

    const fadeThenDuck = render("fade-then-duck");
    const duckThenFade = render("duck-then-fade");

    const window = 0.3;
    const points = [0.5, 1.5, 3.5, 6];
    const readings = points.map((t) => ({
      t,
      fadeThenDuck: measureMeanVolume(fadeThenDuck, t - window / 2, window),
      duckThenFade: measureMeanVolume(duckThenFade, t - window / 2, window),
    }));
    t.diagnostic(JSON.stringify(readings));

    for (const reading of readings) {
      assert.ok(
        Math.abs(reading.fadeThenDuck - reading.duckThenFade) < 0.5,
        `expected fade-then-duck (${reading.fadeThenDuck}dB) and duck-then-fade (${reading.duckThenFade}dB) to match closely at t=${reading.t}s`,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
