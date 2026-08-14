import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { buildPartFrames } from "../bin/avatar-drive/parts-physics.mjs";
import { loadPartsSet, validatePartsManifest } from "../bin/avatar-drive/parts-set.mjs";
import { loadSpriteSet, requireVowelMouthAssets } from "../bin/avatar-drive/sprite-set.mjs";
import { resolveFfmpeg, resolveFfprobe } from "../../media-bin/src/index.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(packageRoot, "bin", "avatar-drive.mjs");
const fixture = join(packageRoot, "test", "fixtures", "avatar-parts-v2");

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

test("avatar-drive parts v2: schema、親子順、z 順、states 切替を固定する", () => {
  const manifest = JSON.parse(readFileSync(join(fixture, "parts.json"), "utf8"));
  assert.deepEqual(validatePartsManifest(manifest), { ok: true });
  const partsSet = loadPartsSet(fixture, { ffprobeCommand: resolveFfprobe() });
  assert.equal(loadSpriteSet(fixture, { ffprobeCommand: resolveFfprobe() }).kind, "parts-v2");
  assert.equal(partsSet.parts.findIndex((part) => part.id === "head")
    < partsSet.parts.findIndex((part) => part.id === "hair-back"), true, "parent is evaluated first even when declared later");
  assert.doesNotThrow(() => requireVowelMouthAssets(partsSet));
  const result = buildPartFrames({
    partsSet,
    mouthStates: ["closed", "a"],
    eyeStates: ["open", "closed"],
    fps: 30,
    seed: 42,
    motionFrames: null,
  });
  const first = result.frames[0];
  const second = result.frames[1];
  assert.deepEqual(first.filter((part) => part.visible && part.id.startsWith("mouth-")).map((part) => part.id), ["mouth-closed"]);
  assert.deepEqual(second.filter((part) => part.visible && part.id.startsWith("mouth-")).map((part) => part.id), ["mouth-a"]);
  assert.equal(first.find((part) => part.id === "eyes-open").visible, true);
  assert.equal(second.find((part) => part.id === "eyes-closed").visible, true);
  assert.deepEqual(first.map((part) => part.z), [...first.map((part) => part.z)].sort((a, b) => a - b));
  const body = first.find((part) => part.id === "body");
  const head = first.find((part) => part.id === "head");
  assert.deepEqual({ e: body.matrix.e, f: body.matrix.f }, { e: 45, f: 80 });
  assert.deepEqual({ e: head.matrix.e, f: head.matrix.f }, { e: 35, f: 40 });
});

test("avatar-drive parts v2: wobble/follow/rotational drag/talk bounce は固定 dt で決定論的", () => {
  const parts = [
    { id: "root", parent: null, offset: { x: 50, y: 50 }, origin: { x: 0, y: 0 }, z: 0,
      states: "always", declarationIndex: 0, physics: { talkBounce: { velocity: 18, gravity: 54 } } },
    { id: "strand", parent: "root", offset: { x: 10, y: 0 }, origin: { x: 0, y: 0 }, z: 1,
      states: "always", declarationIndex: 1, physics: {
        wobble: { x: { amplitude: 1.5, frequency: 0.5, phase: 0.25 } },
        follow: { drag: 8 }, rotationalDrag: { strength: 1.2, minDeg: -15, maxDeg: 15, lerp: 0.25 },
      } },
  ];
  const partsSet = { kind: "parts-v2", manifest: { size: { width: 100, height: 100 } }, parts };
  const frameCount = 240;
  const motionFrames = Array.from({ length: frameCount }, (_, frame) => ({
    scaleX: 1, scaleY: 1, tx: 12 * Math.sin(2 * Math.PI * frame / 60), ty: 0, rotateDeg: 0,
  }));
  const input = {
    partsSet,
    mouthStates: Array.from({ length: frameCount }, (_, frame) => frame >= 20 && frame < 90 ? "open" : "closed"),
    eyeStates: Array(frameCount).fill("open"), fps: 30, seed: 1234, motionFrames,
  };
  const first = buildPartFrames(input);
  const second = buildPartFrames(input);
  assert.deepEqual(first, second);
  assert.ok(first.diagnostics.follow_lag_frames.strand > 0);
  assert.ok(first.frames.slice(21, 40).some((frame) => frame.find((part) => part.id === "root").matrix.f < 50), "talk onset jumps upward");
  assert.ok(first.frames.some((frame) => Math.abs(frame.find((part) => part.id === "strand").matrix.b) > 1e-6), "lag produces rotation");
});

test("avatar-drive parts v2 demo: 12 秒 say で髪の位相遅れと同一入力 SHA を実測する", { timeout: 120_000 }, (t) => {
  let ffmpeg;
  try { ffmpeg = resolveFfmpeg(); resolveFfprobe(); } catch { t.skip("ffmpeg/ffprobe unavailable"); return; }
  const root = mkdtempSync(join(tmpdir(), "avatar-parts-v2-demo-"));
  const sourcePath = join(root, "source.mov");
  const generated = spawnSync(ffmpeg, [
    "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black@0.0:s=320x180:r=12:d=12",
    "-i", join(fixture, "say.wav"), "-shortest", "-c:v", "mpeg4", "-c:a", "pcm_s16le", sourcePath,
  ], { encoding: "utf8", timeout: 30_000 });
  assert.equal(generated.status, 0, generated.stderr);
  writeFileSync(join(root, "edit.json"), `${JSON.stringify({
    version: 0,
    output: { width: 320, height: 180, fps: 12 },
    source: { path: "source.mov", proxy: null },
    cuts: [{ in: 0, out: 12 }], overlays: [], layers: [],
  }, null, 2)}\n`);
  const args = [script, root, "--sprites", fixture, "--blink-period", "1.2", "--blink-jitter", "0.1"];
  const firstRun = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 120_000 });
  assert.equal(firstRun.status, 0, firstRun.stderr || firstRun.stdout);
  const outPath = join(root, ".akari", "cache", "avatar-drive", "avatar-drive.mov");
  const firstHash = sha256(outPath);
  const secondRun = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 120_000 });
  assert.equal(secondRun.status, 0, secondRun.stderr || secondRun.stdout);
  const first = JSON.parse(firstRun.stdout);
  assert.deepEqual(JSON.parse(secondRun.stdout), first);
  assert.equal(sha256(outPath), firstHash);
  assert.equal(first.stats.frames, 144);
  assert.equal(first.stats.parts, 13);
  assert.ok(first.stats.mouth_counts.closed > 0 && first.stats.mouth_counts.open > 0);
  for (const id of ["hair-back", "hair-left", "hair-right"]) assert.ok(first.stats.follow_lag_frames[id] > 0, `${id} lag`);
});
