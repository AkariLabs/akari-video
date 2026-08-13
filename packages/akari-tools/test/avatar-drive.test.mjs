import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { appendLayersAdditive } from "../src/eye-bar/edit-apply.mjs";
import { buildBlinkStates, deriveSeed } from "../bin/avatar-drive/blink.mjs";
import { buildAvatarLayer } from "../bin/avatar-drive/layer.mjs";
import { envelopeToMouthStates } from "../bin/avatar-drive/profile.mjs";
import { loadSpriteSet, validateSpriteManifest } from "../bin/avatar-drive/sprite-set.mjs";
import { resolveFfmpeg, resolveFfprobe } from "../../media-bin/src/index.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(packageRoot, "bin", "avatar-drive.mjs");
const fixture = join(packageRoot, "test", "fixtures", "avatar-sprites");
const driveProfile = {
  midThreshold: 0.025, openThreshold: 0.075, hysteresis: 0.008,
  attackMs: 35, releaseMs: 120, blinkPeriod: 4.2, blinkJitter: 1.2, blinkDuration: 0.12,
};

test("avatar-drive: エンベロープからの口状態列は平滑・ヒステリシス込みで決定論的", () => {
  const rms = [0, 0.18, 0.28, 0.28, 0.7, 0.7, 0.5, 0.26, 0.18, ...Array(20).fill(0)];
  const profile = {
    midThreshold: 0.2, openThreshold: 0.55, hysteresis: 0.08,
    attackMs: 80, releaseMs: 350, blinkPeriod: 4, blinkJitter: 1, blinkDuration: 0.1,
  };
  const first = envelopeToMouthStates(rms, 10, profile);
  const second = envelopeToMouthStates(rms, 10, profile);
  assert.deepEqual(first, second);
  assert.equal(first.states[0], "closed");
  assert.ok(first.states.includes("mid"));
  assert.ok(first.states.includes("open"));
  assert.notEqual(first.states[8], "closed", "release smoothing and hysteresis should hold a speaking state");
  assert.equal(first.states.at(-1), "closed");
});

test("avatar-drive: まばたき列は同じ seed で一致し、異なる seed で変わる", () => {
  const input = { frameCount: 600, fps: 30, period: 3.5, jitter: 1.1, duration: 0.12 };
  const seed = deriveSeed({ edit: { version: 0 }, sprite: { version: 0 } });
  const first = buildBlinkStates({ ...input, seed });
  assert.deepEqual(first, buildBlinkStates({ ...input, seed }));
  assert.notDeepEqual(first.events, buildBlinkStates({ ...input, seed: seed + 1 }).events);
  assert.ok(first.states.includes("closed"));
});

test("avatar-drive: sprite.json は必須差分を検証し、追加キーを受理する", () => {
  const manifest = JSON.parse(readFileSync(join(fixture, "sprite.json"), "utf8"));
  assert.deepEqual(validateSpriteManifest(manifest), { ok: true });
  const missing = structuredClone(manifest);
  delete missing.mouth.open;
  const invalid = validateSpriteManifest(missing);
  assert.equal(invalid.ok, false);
  assert.match(invalid.errors.join(" "), /mouth\.open/);
  const loaded = loadSpriteSet(fixture, { ffprobeCommand: resolveFfprobe() });
  assert.equal(loaded.manifest.mouth.smile, "mouth-mid.png");
});

test("avatar-drive: layers[] 適用は既存フィールド不変の末尾追記", () => {
  const root = mkdtempSync(join(tmpdir(), "avatar-drive-layer-"));
  const editPath = join(root, "edit.json");
  const original = {
    version: 0,
    output: { width: 1280, height: 720, fps: 30 },
    source: { path: "source.mp4", proxy: null },
    cuts: [{ in: 0, out: 2 }],
    overlays: [{ id: "keep", html: "keep.html", start: 0, duration: 1 }],
    layers: [{ id: "existing", t: 0, duration: 1, kind: "video", src: "pip.mp4" }],
  };
  writeFileSync(editPath, `${JSON.stringify(original, null, 2)}\n`);
  const layer = buildAvatarLayer({
    projectRoot: root, outPath: join(root, ".akari", "avatar.mov"),
    outputWidth: 1280, outputHeight: 720,
    sprite: JSON.parse(readFileSync(join(fixture, "sprite.json"), "utf8")),
    duration: 2, profile: driveProfile,
  });
  assert.equal(appendLayersAdditive(editPath, [layer]).ok, true);
  const applied = JSON.parse(readFileSync(editPath, "utf8"));
  assert.deepEqual({ ...applied, layers: applied.layers.slice(0, -1) }, original);
  assert.equal(applied.layers.at(-1).kind, "baked");
  assert.equal(appendLayersAdditive(editPath, [layer]).ok, false, "same id must not overwrite");
});

test("avatar-drive: 名前付き四隅配置は anchor に依存せず bbox を margin 内へ揃える", () => {
  const outputWidth = 1280;
  const outputHeight = 720;
  const margin = 48;
  const scale = 1.25;
  const sprite = JSON.parse(readFileSync(join(fixture, "sprite.json"), "utf8"));
  assert.equal(sprite.anchor.x, 0.5, "canonical bottom-center anchor fixture");
  const expectedEdges = {
    "right-bottom": { right: outputWidth - margin, bottom: outputHeight - margin },
    "left-bottom": { left: margin, bottom: outputHeight - margin },
    "right-top": { right: outputWidth - margin, top: margin },
    "left-top": { left: margin, top: margin },
  };
  for (const [position, expected] of Object.entries(expectedEdges)) {
    const layer = buildAvatarLayer({
      projectRoot: "/tmp/project", outPath: "/tmp/project/avatar.mov",
      outputWidth, outputHeight, sprite, duration: 1, position, scale, margin,
      profile: driveProfile,
    });
    const centerX = outputWidth / 2 + layer.transform.x;
    const centerY = outputHeight / 2 + layer.transform.y;
    const halfWidth = sprite.size.width * scale / 2;
    const halfHeight = sprite.size.height * scale / 2;
    const bounds = {
      left: centerX - halfWidth,
      right: centerX + halfWidth,
      top: centerY - halfHeight,
      bottom: centerY + halfHeight,
    };
    for (const [edge, value] of Object.entries(expected)) assert.equal(bounds[edge], value, `${position} ${edge}`);
    assert.ok(bounds.left >= 0 && bounds.right <= outputWidth, `${position} horizontal bounds`);
    assert.ok(bounds.top >= 0 && bounds.bottom <= outputHeight, `${position} vertical bounds`);
  }
});

test("avatar-drive: 明示 x,y は sprite anchor をその座標へ固定する", () => {
  const outputWidth = 1280;
  const outputHeight = 720;
  const scale = 1.25;
  const sprite = JSON.parse(readFileSync(join(fixture, "sprite.json"), "utf8"));
  const layer = buildAvatarLayer({
    projectRoot: "/tmp/project", outPath: "/tmp/project/avatar.mov",
    outputWidth, outputHeight, sprite, duration: 1, position: "321,456", scale,
    profile: driveProfile,
  });
  const centerX = outputWidth / 2 + layer.transform.x;
  const centerY = outputHeight / 2 + layer.transform.y;
  assert.equal(centerX + (sprite.anchor.x - 0.5) * sprite.size.width * scale, 321);
  assert.equal(centerY + (sprite.anchor.y - 0.5) * sprite.size.height * scale, 456);
});

test("avatar-drive CLI: 実 ffmpeg の状態列と layer JSON は同入力 2 回で一致する", { timeout: 30_000 }, (t) => {
  let ffmpeg;
  try { ffmpeg = resolveFfmpeg(); resolveFfprobe(); } catch { t.skip("ffmpeg/ffprobe unavailable"); return; }
  const root = mkdtempSync(join(tmpdir(), "avatar-drive-cli-"));
  const sourcePath = join(root, "source.mov");
  const generated = spawnSync(ffmpeg, [
    "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=navy:s=320x180:r=20:d=2",
    "-f", "lavfi", "-i", "aevalsrc=if(between(t\\,0.45\\,1.35)\\,0.45*sin(2*PI*220*t)\\,0):s=48000:d=2",
    "-shortest", "-c:v", "mpeg4", "-c:a", "pcm_s16le", sourcePath,
  ], { encoding: "utf8" });
  assert.equal(generated.status, 0, generated.stderr);
  const edit = {
    version: 0,
    output: { width: 320, height: 180, fps: 20 },
    source: { path: "source.mov", proxy: null },
    cuts: [{ in: 0, out: 2 }], overlays: [], layers: [],
  };
  writeFileSync(join(root, "edit.json"), `${JSON.stringify(edit, null, 2)}\n`);
  for (const name of ["sprite.json", "base.png", "mouth-closed.png", "mouth-mid.png", "mouth-open.png", "eyes-open.png", "eyes-closed.png"]) {
    copyFileSync(join(fixture, name), join(root, name));
  }
  const args = [script, root, "--sprites", root, "--blink-period", "0.55", "--blink-jitter", "0.1"];
  const firstRun = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 30_000 });
  const secondRun = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 30_000 });
  assert.equal(firstRun.status, 0, firstRun.stderr || firstRun.stdout);
  assert.equal(secondRun.status, 0, secondRun.stderr || secondRun.stdout);
  const first = JSON.parse(firstRun.stdout);
  const second = JSON.parse(secondRun.stdout);
  assert.deepEqual(first, second);
  assert.ok(first.drive.mouth.includes("closed"));
  assert.ok(first.drive.mouth.includes("mid"));
  assert.ok(first.drive.mouth.includes("open"));
  assert.ok(first.drive.eyes.includes("closed"));
  assert.equal(first.layers[0].kind, "baked");
  assert.equal(first.stats.width, 128);
  assert.equal(first.stats.height, 128);
});

test("avatar-drive CLI: 必須入力なしは exit 2、--check は可否 JSON", () => {
  const missing = spawnSync(process.execPath, [script], { encoding: "utf8" });
  assert.equal(missing.status, 2);
  assert.match(JSON.parse(missing.stdout).reason, /project.*--sprites/);
  const checked = spawnSync(process.execPath, [script, "--check"], { encoding: "utf8" });
  assert.equal(checked.status, 0);
  assert.equal(typeof JSON.parse(checked.stdout).available, "boolean");
});
