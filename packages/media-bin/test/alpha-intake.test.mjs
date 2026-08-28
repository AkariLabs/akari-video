import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  alphaMaskPathFor,
  colorPathFor,
  ensureAlphaIntake,
  prepareAlphaLayers,
} from "../src/alpha-intake.mjs";
import { resolveFfmpeg, resolveFfprobe } from "../src/index.mjs";

const ffmpeg = resolveFfmpeg();
const ffprobe = resolveFfprobe();

function generateAlphaWebm(output) {
  const result = spawnSync(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc2=size=96x54:rate=12:duration=1",
    "-f", "lavfi", "-i", "nullsrc=size=96x54:rate=12:duration=1,geq=lum='if(gt(X,2*N),255,0)'",
    "-filter_complex", "[0:v][1:v]alphamerge,format=yuva420p",
    "-an", "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0",
    "-b:v", "0", "-crf", "10", "-g", "12", output,
  ], { encoding: "utf8", timeout: 60_000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
}

function generateAlphaMov(output) {
  const result = spawnSync(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc2=size=96x54:rate=12:duration=1",
    "-f", "lavfi", "-i", "nullsrc=size=96x54:rate=12:duration=1,geq=lum='if(gt(Y,2*N),255,0)'",
    "-filter_complex", "[0:v][1:v]alphamerge,format=yuva444p10le",
    "-an", "-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuva444p10le", output,
  ], { encoding: "utf8", timeout: 60_000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
}

test("alpha intake creates a synchronized color/mask pair, coalesces calls, and skips fresh outputs", { timeout: 120_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "akari-alpha-intake-"));
  try {
    const input = join(directory, "person.webm");
    generateAlphaWebm(input);
    const firstPromise = ensureAlphaIntake(input, { ffmpeg, ffprobe });
    const joinedPromise = ensureAlphaIntake(input, { ffmpeg, ffprobe });
    assert.equal(firstPromise, joinedPromise);
    const first = await firstPromise;
    assert.equal(first.ok, true, first.reason);
    assert.equal(first.alpha, true);
    assert.equal(first.skipped, false);
    assert.equal(first.colorPath, colorPathFor(input));
    assert.equal(first.maskPath, alphaMaskPathFor(input));
    assert.ok((await stat(first.colorPath)).size > 0);
    assert.ok((await stat(first.maskPath)).size > 0);
    assert.equal(first.probe.color.nb_frames, first.probe.mask.nb_frames);
    assert.equal(first.probe.color.r_frame_rate, first.probe.mask.r_frame_rate);

    const second = await ensureAlphaIntake(input, { ffmpeg, ffprobe });
    assert.equal(second.ok, true, second.reason);
    assert.equal(second.skipped, true);

    const prepared = await prepareAlphaLayers({ layers: [{ id: "person", src: "person.webm" }] }, {
      projectRoot: directory,
      ensure: (source) => ensureAlphaIntake(source, { ffmpeg, ffprobe }),
    });
    assert.deepEqual(prepared.warnings, []);
    assert.equal(prepared.edit.layers[0].src, "person.color.mp4");
    assert.equal(prepared.edit.layers[0].mask, "person.mask.mp4");

    const explicit = await prepareAlphaLayers({ layers: [{
      id: "person", src: "person.webm", mask: "declared.mask.mp4",
    }] }, {
      projectRoot: directory,
      ensure: (source) => ensureAlphaIntake(source, { ffmpeg, ffprobe }),
    });
    assert.equal(explicit.edit.layers[0].src, "person.color.mp4");
    assert.equal(explicit.edit.layers[0].mask, "declared.mask.mp4");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("alpha intake returns a non-throwing failure and layer preparation skips only that layer", async () => {
  const missing = join(tmpdir(), `akari-alpha-missing-${process.pid}.webm`);
  const result = await ensureAlphaIntake(missing, { ffmpeg, ffprobe });
  assert.equal(result.ok, false);
  assert.match(result.reason, /ENOENT|no such file/u);

  const prepared = await prepareAlphaLayers({ layers: [
    { id: "broken", src: missing },
    { id: "ordinary", src: "ordinary.mp4" },
  ] }, { projectRoot: "/", ensure: async () => result });
  assert.deepEqual(prepared.edit.layers.map(layer => layer.id), ["ordinary"]);
  assert.equal(prepared.warnings.length, 1);
  assert.match(prepared.warnings[0], /broken/u);
});

test("alpha intake accepts alpha pixel formats in MOV without forcing a VP9 decoder", { timeout: 120_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "akari-alpha-mov-"));
  try {
    const input = join(directory, "person.mov");
    generateAlphaMov(input);
    const result = await ensureAlphaIntake(input, { ffmpeg, ffprobe });
    assert.equal(result.ok, true, result.reason);
    assert.equal(result.alpha, true);
    assert.equal(result.probe.color.codec_name, "h264");
    assert.equal(result.probe.mask.codec_name, "h264");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
