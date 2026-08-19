import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile as rawWriteFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createMigratingWriteFile } from "./helpers/v2-fixture.mjs";

const writeFile = createMigratingWriteFile(rawWriteFile);

import { buildAudioMixCommand } from "../src/plan.mjs";

// docs/contract-2026-07-25-r6-audio-tracks-and-trim.md §2 addendum (audio-clip-fades,
// 2026-08-18 -- owner ruling "クリップ主義" T2): audio.sfx[].fade_in/fade_out apply afade over
// the clip's own effective playback window [t, t + effectiveDuration), clamped to half that
// window (same rule as audio.bgm.fadeIn/fadeOut, mirrored in resolveSfxFadeSeconds). L2 requires
// measuring the real rendered output's level at several timestamps -- not trusting the command
// plan alone -- in the spirit of audio-bgm-fade.test.mjs / audio-sfx-in-out.test.mjs.

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(packageRoot, "bin", "render-cut.mjs");

function run(project, args = []) {
  return spawnSync(process.execPath, [cliPath, project, ...args], { encoding: "utf8" });
}

function ffmpeg(args) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result;
}

// Input-side -ss (before -i) performs a real seek, so only samples in [start, start+duration)
// ever reach volumedetect -- same rationale as audio-bgm-fade.test.mjs's measureMeanVolume.
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

async function makeProject({ duration = 8, sfx = [] }) {
  const root = await mkdtemp(join(tmpdir(), "render-cut-sfx-fade-test-"));
  makeSilentSourceVideo(join(root, "source.mp4"), { duration });
  await mkdir(join(root, "audio"));
  for (const item of sfx) {
    if (item.materialDuration) {
      makeTone(join(root, "audio", item.file), { frequency: item.frequency ?? 440, duration: item.materialDuration });
    }
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
        audio: { sfx: sfx.map(({ file, ...rest }) => ({ path: `audio/${file}`, ...rest })) },
      },
      null,
      2,
    )}\n`,
  );
  await mkdir(join(root, ".akari"));
  await writeFile(join(root, ".akari", "lint.json"), '{"version":1,"verdict":"pass"}\n');
  return root;
}

test("sfx.fade_in=1 ramps RMS up monotonically within the clip's own window (real rendered output)", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const timelineT = 1;
  const materialDuration = 4;
  const project = await makeProject({
    duration: 8,
    sfx: [{ file: "sfx.wav", materialDuration, t: timelineT, fade_in: 1 }],
  });
  try {
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass");
    assert.match(state.plan.commands.audio_mix.args.join(" "), /afade=t=in:st=0:d=1(?!\d)/);

    const outputPath = join(project, state.artifacts[0].path);
    const window = 0.2;
    const at02 = measureMeanVolume(outputPath, timelineT + 0.2 - window / 2, window);
    const at05 = measureMeanVolume(outputPath, timelineT + 0.5 - window / 2, window);
    const at09 = measureMeanVolume(outputPath, timelineT + 0.9 - window / 2, window);
    const steadyControl = measureMeanVolume(outputPath, timelineT + 2 - window / 2, window);
    t.diagnostic(`fade_in=1 mean_volume: t+0.2s ${at02}dB, t+0.5s ${at05}dB, t+0.9s ${at09}dB, steady(t+2s) ${steadyControl}dB`);

    assert.ok(at02 < at05 - 1, `expected +0.2s (${at02}dB) measurably quieter than +0.5s (${at05}dB)`);
    assert.ok(at05 < at09 - 1, `expected +0.5s (${at05}dB) measurably quieter than +0.9s (${at09}dB)`);
    assert.ok(Math.abs(at09 - steadyControl) < 1, `expected +0.9s (${at09}dB, near the end of the 1s fade) to already be close to the steady level (${steadyControl}dB)`);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("sfx.fade_out=1 is symmetric with fade_in=1 within a 4s clip window (tail mirrors head)", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const timelineT = 1;
  const materialDuration = 4; // fadeIn [0,1], plateau [1,3], fadeOut [3,4] -- no overlap
  const project = await makeProject({
    duration: 8,
    sfx: [{ file: "sfx.wav", materialDuration, t: timelineT, fade_in: 1, fade_out: 1 }],
  });
  try {
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass");
    assert.match(state.plan.commands.audio_mix.args.join(" "), /afade=t=in:st=0:d=1,afade=t=out:st=3:d=1/);

    const outputPath = join(project, state.artifacts[0].path);
    const window = 0.2;
    const head02 = measureMeanVolume(outputPath, timelineT + 0.2 - window / 2, window);
    const head08 = measureMeanVolume(outputPath, timelineT + 0.8 - window / 2, window);
    const tail02 = measureMeanVolume(outputPath, timelineT + materialDuration - 0.2 - window / 2, window);
    const tail08 = measureMeanVolume(outputPath, timelineT + materialDuration - 0.8 - window / 2, window);
    const plateau = measureMeanVolume(outputPath, timelineT + 2 - window / 2, window);
    t.diagnostic(
      `head: +0.2s ${head02}dB, +0.8s ${head08}dB; tail: end-0.2s ${tail02}dB, end-0.8s ${tail08}dB; plateau ${plateau}dB`,
    );

    assert.ok(Math.abs(head02 - tail02) < 1.5, `expected fade-in @+0.2s (${head02}dB) to mirror fade-out @end-0.2s (${tail02}dB)`);
    assert.ok(Math.abs(head08 - tail08) < 1.5, `expected fade-in @+0.8s (${head08}dB) to mirror fade-out @end-0.8s (${tail08}dB)`);
    assert.ok(tail02 < tail08 - 1, `expected the tail to keep descending toward the end: end-0.8s (${tail08}dB) should be louder than end-0.2s (${tail02}dB)`);
    assert.ok(plateau > head08 + 1 && plateau > tail08 + 1, `expected the plateau (${plateau}dB) to be measurably louder than either ramp's midpoint`);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("sfx.fade_in/fade_out omitted keeps the filtergraph free of afade (regression invariant)", () => {
  const command = buildAudioMixCommand({
    edit: {
      version: 0,
      output: { width: 320, height: 180, fps: 10 },
      audio: { sfx: [{ path: "audio/pop.wav", t: 1, gain_db: -3 }] },
    },
    projectRoot: "/project",
    inputPath: "/project/.akari/render-tmp/composite.mp4",
    outputPath: "/project/.akari/render-tmp/final.mp4",
    duration: 10,
  });
  assert.ok(!command.args.join(" ").includes("afade"), `expected no afade in args when fade_in/fade_out are omitted, got: ${command.args.join(" ")}`);
  assert.equal(command.warnings.length, 0);
});

test("sfx.fade_in exceeding half the clip's effective (in/out-trimmed) duration is clamped at render time", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  // Material is 6s, but in/out trims the effective window down to [1,3) = 2s -- half = 1s.
  // Requesting fade_in=10 should clamp to 1s, not to half of the 6s material or the 8s timeline.
  const timelineT = 1;
  const materialDuration = 6;
  const project = await makeProject({
    duration: 8,
    sfx: [{ file: "sfx.wav", materialDuration, t: timelineT, in: 1, out: 3, fade_in: 10 }],
  });
  try {
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    assert.match(
      executed.stderr,
      /render-cut warning:.*audio\.sfx\[0\]\.fade_in 10s exceeds half the clip's effective duration \(2s\); clamped to 1s/,
    );

    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass");
    assert.match(state.plan.commands.audio_mix.args.join(" "), /afade=t=in:st=0:d=1(?!\d)/);

    const outputPath = join(project, state.artifacts[0].path);
    const window = 0.2;
    // With the clamped 1s fade (not the requested 10s), +1.5s into the clip (well past the 1s
    // ramp) should already be back at the steady level.
    const at15 = measureMeanVolume(outputPath, timelineT + 1.5 - window / 2, window);
    const steadyControl = measureMeanVolume(outputPath, timelineT + 1.9 - window / 2, window);
    t.diagnostic(`clamped fade_in: t+1.5s ${at15}dB vs steady control (t+1.9s) ${steadyControl}dB`);
    assert.ok(Math.abs(at15 - steadyControl) < 1, `expected t+1.5s (${at15}dB) to already be at steady level (${steadyControl}dB) once fade_in is clamped to 1s`);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("sfx.fade_in/fade_out on an in/out-trimmed clip apply to the trimmed window, not the whole material", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  // 5s material, trimmed to material [1,3) (2s effective window), placed at timeline t=1.
  // fade_in=0.5 should ramp up over the *first* 0.5s of the trimmed window (timeline [1,1.5)),
  // not over the first 0.5s of the untrimmed 5s material.
  const timelineT = 1;
  const materialDuration = 5;
  const project = await makeProject({
    duration: 8,
    sfx: [{ file: "sfx.wav", materialDuration, t: timelineT, in: 1, out: 3, fade_in: 0.5 }],
  });
  try {
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass");
    assert.match(state.plan.commands.audio_mix.args.join(" "), /atrim=start=1:end=3,asetpts=PTS-STARTPTS,volume=0dB,afade=t=in:st=0:d=0\.5/);

    const outputPath = join(project, state.artifacts[0].path);
    const window = 0.15;
    const early = measureMeanVolume(outputPath, timelineT + 0.15 - window / 2, window);
    const late = measureMeanVolume(outputPath, timelineT + 0.45 - window / 2, window);
    t.diagnostic(`trimmed-window fade_in=0.5: t+0.15s ${early}dB, t+0.45s ${late}dB`);
    assert.ok(early < late - 1, `expected the ramp to still be rising within the first 0.5s of the trimmed window: +0.15s (${early}dB) should be quieter than +0.45s (${late}dB)`);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
