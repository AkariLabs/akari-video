import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { lintProject } from "../../edit-lint/src/edit-lint.mjs";
import { legacyRenderArgs } from "./helpers/render-engine.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(packageRoot, "bin", "render-cut.mjs");

function ffmpeg(args) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

function measureBand(path, center, frequency) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-ss", String(center - 0.1),
    "-i", path, "-t", "0.2", "-af", `bandpass=f=${frequency}:width_type=q:w=15,volumedetect`,
    "-f", "null", "-"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const match = result.stderr.match(/mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/u);
  assert.ok(match, result.stderr);
  return Number(match[1]);
}

function peak(path, start = null, duration = null) {
  const args = ["-hide_banner", "-nostats"];
  if (start !== null) args.push("-ss", String(start));
  args.push("-i", path);
  if (duration !== null) args.push("-t", String(duration));
  args.push("-af", "astats=metadata=1:reset=0", "-f", "null", "-");
  const result = spawnSync("ffmpeg", args, { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const matches = [...result.stderr.matchAll(/Peak level dB:\s*(-?\d+(?:\.\d+)?)/gu)];
  assert.ok(matches.length, result.stderr);
  return Number(matches.at(-1)[1]);
}

async function makeProject(withFade) {
  const root = await mkdtemp(join(tmpdir(), "render-cut-bgm-crossfade-"));
  try {
    await mkdir(join(root, "audio"));
    ffmpeg(["-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30:duration=4",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", join(root, "source.mp4")]);
    for (const [name, frequency] of [["a", 440], ["b", 880]]) {
      ffmpeg(["-f", "lavfi", "-i", `sine=frequency=${frequency}:sample_rate=48000:duration=3`,
        "-af", "volume=15dB", "-c:a", "pcm_s16le", join(root, "audio", `${name}.wav`)]);
    }
    const edit = {
      version: 2,
      output: { width: 320, height: 180, fps: 30 },
      sources: [
        { id: "video", path: "source.mp4" },
        { id: "tone-a", path: "audio/a.wav" },
        { id: "tone-b", path: "audio/b.wav" },
      ],
      tracks: [
        { id: "visual", lane: "visual", items: [{ id: "picture", at: 0, duration: 120, audio: false,
          source: { kind: "media", src: "video", in: 0, out: 4 } }] },
        { id: "audio-a", lane: "audio", items: [{ id: "bgm-a", at: 0, duration: 60, role: "bgm",
          ...(withFade ? { fade_out: 0.5 } : {}),
          source: { kind: "media", src: "tone-a", in: 0, out: 2 } }] },
        { id: "audio-b", lane: "audio", items: [{ id: "bgm-b", at: 45, duration: 60, role: "bgm",
          ...(withFade ? { fade_in: 0.5 } : {}),
          source: { kind: "media", src: "tone-b", in: 0, out: 2 } }] },
      ],
    };
    await writeFile(join(root, "edit.json"), JSON.stringify(edit));
    return root;
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

async function withRenderedProject(t, withFade, verify) {
  const probe = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  if (probe.error?.code === "ENOENT") return t.skip("ffmpeg unavailable");
  assert.equal(probe.status, 0, probe.error?.message ?? probe.stderr);
  const root = await makeProject(withFade);
  try {
    const lint = await lintProject(root);
    assert.equal(lint.verdict, "pass", JSON.stringify(lint.findings));
    await mkdir(join(root, ".akari"), { recursive: true });
    await writeFile(join(root, ".akari", "lint.json"), '{"version":1,"verdict":"pass"}\n');
    const rendered = spawnSync(process.execPath, [cli, root, ...legacyRenderArgs()], { encoding: "utf8" });
    assert.equal(rendered.status, 0, rendered.stderr);
    const state = JSON.parse(await readFile(join(root, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass");
    const args = state.plan.commands.audio_mix.args;
    const filterComplex = args[args.indexOf("-filter_complex") + 1];
    assert.ok(filterComplex, "audio mix filter_complex is missing");
    const output = join(root, state.artifacts[0].path);
    const centers = [1.0, 1.55, 1.75, 1.95, 2.5];
    const levels440 = centers.map(center => measureBand(output, center, 440));
    const levels880 = centers.map(center => measureBand(output, center, 880));
    const peaks = {
      source: peak(join(root, "audio", "a.wav")),
      whole: peak(output),
      overlap: peak(output, 1.5, 0.5),
      singleBefore: peak(output, 0.5, 0.8),
      singleAfter: peak(output, 2.5, 0.8),
    };
    t.diagnostic(JSON.stringify({ levels440, levels880, peaks }));
    await verify({ lint, filterComplex, levels440, levels880, peaks });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("two v2 BGM items crossfade in the rendered output", async (t) => {
  await withRenderedProject(t, true, ({ lint, filterComplex, levels440, levels880, peaks }) => {
    assert.equal(lint.findings.some(finding => finding.check === "v2.audio-bgm-multiple"), false);
    assert.match(filterComplex, /afade=t=out/u);
    assert.match(filterComplex, /afade=t=in/u);
    assert.ok(levels440[0] > -60 && levels440[0] > levels880[0] + 20, `before: ${levels440[0]}, ${levels880[0]}`);
    assert.ok(levels440[2] > -60 && levels880[2] > -60, `middle: ${levels440[2]}, ${levels880[2]}`);
    assert.ok(levels880[4] > -60 && levels880[4] > levels440[4] + 20, `after: ${levels440[4]}, ${levels880[4]}`);
    assert.ok(levels440[1] > levels440[2] && levels440[2] > levels440[3], `fade out: ${levels440}`);
    assert.ok(levels880[1] < levels880[2] && levels880[2] < levels880[3], `fade in: ${levels880}`);
    assert.ok(peaks.overlap <= peaks.singleBefore + 1, `overlap ${peaks.overlap} dBFS, single ${peaks.singleBefore} dBFS`);
    assert.ok(peaks.whole < 0, `whole peak: ${peaks.whole}`);
    t.diagnostic(`audio_mix filter_complex: ${filterComplex}`);
  });
});

test("two v2 BGM items without fades raise the overlap peak and lint warning", async (t) => {
  await withRenderedProject(t, false, ({ lint, filterComplex, peaks }) => {
    const warnings = lint.findings.filter(finding => finding.check === "v2.audio-bgm-multiple");
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].severity, "warning");
    assert.doesNotMatch(filterComplex, /afade=t=/u);
    assert.ok(peaks.overlap >= peaks.singleBefore + 3, `overlap ${peaks.overlap} dBFS, single ${peaks.singleBefore} dBFS`);
    assert.ok(peaks.whole < 0, `whole peak: ${peaks.whole}`);
  });
});
