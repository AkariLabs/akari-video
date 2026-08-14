import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { appendLayersAdditive } from "../src/eye-bar/edit-apply.mjs";
import { bakeAvatarClip } from "../bin/avatar-drive/bake.mjs";
import { buildBlinkStates, deriveSeed } from "../bin/avatar-drive/blink.mjs";
import {
  BLINK_GATE, buildEmotionStates, buildExpressionDrive, buildTrackedBlinkStates, loadExpressionTrack,
} from "../bin/avatar-drive/expression-track.mjs";
import { buildAvatarLayer } from "../bin/avatar-drive/layer.mjs";
import { buildMotionFrames, calculateMotionMargin } from "../bin/avatar-drive/motion.mjs";
import { envelopeToMouthStates } from "../bin/avatar-drive/profile.mjs";
import { loadSpriteSet, requireVowelMouthAssets, validateSpriteManifest } from "../bin/avatar-drive/sprite-set.mjs";
import {
  buildVowelTimeline, moraeForWord, parseTranscript, resolveMouthStates,
} from "../bin/avatar-drive/vowel.mjs";
import { resolveFfmpeg, resolveFfprobe } from "../../media-bin/src/index.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(packageRoot, "bin", "avatar-drive.mjs");
const fixture = join(packageRoot, "test", "fixtures", "avatar-sprites");
const expressionFixture = join(packageRoot, "test", "fixtures", "avatar-drive", "face-expression-ground-truth.json");
const driveProfile = {
  midThreshold: 0.025, openThreshold: 0.075, hysteresis: 0.008,
  attackMs: 35, releaseMs: 120, blinkPeriod: 4.2, blinkJitter: 1.2, blinkDuration: 0.12,
};

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

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

test("avatar-drive motion: 同じ入力は一致し、seed が変わると onset tilt が変わる", () => {
  const input = {
    mouthStates: [...Array(20).fill("closed"), ...Array(40).fill("open"), ...Array(20).fill("closed")],
    fps: 20, intensity: 0.5, width: 128, height: 128,
  };
  const first = buildMotionFrames({ ...input, seed: 1234 });
  assert.deepEqual(first, buildMotionFrames({ ...input, seed: 1234 }));
  const second = buildMotionFrames({ ...input, seed: 5678 });
  assert.notDeepEqual(first.map(({ rotateDeg }) => rotateDeg), second.map(({ rotateDeg }) => rotateDeg));
  assert.ok(first.slice(20).some(({ scaleY }) => scaleY > 1.005));
});

test("avatar-drive motion: intensity 0 は全 frame で厳密な恒等変換", () => {
  const frames = buildMotionFrames({
    mouthStates: ["closed", "open", "a", "closed"], fps: 30, intensity: 0, seed: 99,
    width: 128, height: 128, headStates: [null, { roll: 20 }, null, { roll: -20 }],
  });
  assert.deepEqual(frames, Array.from({ length: 4 }, () => ({
    scaleX: 1, scaleY: 1, tx: 0, ty: 0, rotateDeg: 0,
  })));
});

test("avatar-drive motion: expression head roll は frame 単位で procedural tilt より優先", () => {
  const common = {
    mouthStates: ["closed", "open", "open", "open"], fps: 20, intensity: 0.5, seed: 17,
    width: 128, height: 128,
  };
  const procedural = buildMotionFrames(common);
  const tracked = buildMotionFrames({ ...common, headStates: [null, null, { roll: 8 }, null] });
  assert.equal(tracked[2].rotateDeg, 4);
  assert.equal(tracked[1].rotateDeg, procedural[1].rotateDeg);
  assert.equal(tracked[3].rotateDeg, procedural[3].rotateDeg);
});

test("avatar-drive expression: 実測 blink は採用し、遮蔽の非対称スパイクは棄却する", () => {
  const track = loadExpressionTrack(expressionFixture);
  const blink = buildTrackedBlinkStates(track.samples, BLINK_GATE, track.sample_fps);
  const stateAt = (time) => blink.states.find((_, index) => track.samples[index].t === time);
  assert.deepEqual(BLINK_GATE, { threshold: 0.3, symmetry: 0.12, minimumSamples: 2 });
  assert.equal(stateAt(19.125), "closed");
  assert.equal(stateAt(19.1667), "closed");
  assert.equal(stateAt(19.2083), "closed");
  for (const sample of track.samples.filter(({ t }) => t >= 10.1667 && t <= 10.5833)) {
    assert.equal(stateAt(sample.t), "open", `occlusion t=${sample.t}`);
  }
});

test("avatar-drive expression: cuts 時刻へ再サンプルし、頭の符号と大域単調性を保つ", () => {
  const track = loadExpressionTrack(expressionFixture);
  const first = buildExpressionDrive({
    track,
    timeline: { fps: 24, cuts: [{ path: track.sourcePath, start: 0, end: 20, speed: 1 }] },
    frameCount: 480,
    headSmoothing: 5,
  });
  const second = buildExpressionDrive({
    track,
    timeline: { fps: 24, cuts: [{ path: track.sourcePath, start: 0, end: 20, speed: 1 }] },
    frameCount: 480,
    headSmoothing: 5,
  });
  assert.deepEqual(first, second);
  assert.equal(first.eyes[Math.round(19.1667 * 24)], "closed");
  assert.equal(first.eyes[Math.round(10.375 * 24)], "open");
  const yawAt = (time) => first.head[Math.round(time * 24)].yaw;
  assert.ok(yawAt(11) < 0 && yawAt(12) < 0);
  assert.ok(yawAt(12) > yawAt(11), `${yawAt(11)} -> ${yawAt(12)}`);
});

test("avatar-drive expression: emotion 写像と enter/exit ヒステリシスを固定する", () => {
  const sample = (blendshapes) => ({ blendshapes });
  const pair = (left, right, value) => ({ [left]: value, [right]: value });
  assert.deepEqual(buildEmotionStates([
    sample({}),
    sample(pair("mouthSmileLeft", "mouthSmileRight", 0.6)),
    sample(pair("mouthSmileLeft", "mouthSmileRight", 0.35)),
    sample(pair("mouthSmileLeft", "mouthSmileRight", 0.2)),
    sample(pair("mouthFrownLeft", "mouthFrownRight", 0.6)),
    sample(pair("browDownLeft", "browDownRight", 0.6)),
    sample({ browOuterUpLeft: 0.6, browOuterUpRight: 0.6, jawOpen: 0.6 }),
  ]), ["neutral", "happy", "happy", "neutral", "sad", "angry", "surprised"]);
});

test("avatar-drive expression: analysis.json pointer と直接 track は同じ文書を読む", () => {
  const root = mkdtempSync(join(tmpdir(), "avatar-drive-expression-pointer-"));
  const trackPath = join(root, "face.json");
  const analysisPath = join(root, "analysis.json");
  writeFileSync(trackPath, readFileSync(expressionFixture));
  writeFileSync(analysisPath, JSON.stringify({ tracks: { face_expression: { path: "face.json" } } }));
  assert.deepEqual(loadExpressionTrack(analysisPath).samples, loadExpressionTrack(trackPath).samples);
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
  for (const name of [
    "sprite.json", "base.png", "mouth-closed.png", "mouth-mid.png", "mouth-open.png",
    "mouth-a.png", "mouth-i.png", "mouth-u.png", "mouth-e.png", "mouth-o.png",
    "eyes-open.png", "eyes-closed.png",
  ]) {
    copyFileSync(join(fixture, name), join(root, name));
  }
  const args = [script, root, "--sprites", root, "--blink-period", "0.55", "--blink-jitter", "0.1"];
  const firstRun = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 30_000 });
  const firstHash = sha256(join(root, ".akari", "cache", "avatar-drive", "avatar-drive.mov"));
  const secondRun = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 30_000 });
  const secondHash = sha256(join(root, ".akari", "cache", "avatar-drive", "avatar-drive.mov"));
  assert.equal(firstRun.status, 0, firstRun.stderr || firstRun.stdout);
  assert.equal(secondRun.status, 0, secondRun.stderr || secondRun.stdout);
  const first = JSON.parse(firstRun.stdout);
  const second = JSON.parse(secondRun.stdout);
  assert.deepEqual(first, second);
  assert.equal(firstHash, secondHash, "既定 motion の MOV は byte 一致する");
  assert.ok(first.drive.mouth.includes("closed"));
  assert.ok(first.drive.mouth.includes("mid"));
  assert.ok(first.drive.mouth.includes("open"));
  assert.ok(first.drive.eyes.includes("closed"));
  assert.equal(first.layers[0].kind, "baked");
  assert.ok(first.stats.width > 128);
  assert.ok(first.stats.height > 128);
  assert.equal(first.stats.width, 128 + first.stats.motion_margin * 2);
  assert.equal(first.stats.height, 128 + first.stats.motion_margin * 2);
});

test("avatar-drive CLI: --no-motion は従来寸法・決定論を保ち、数値指定との併用を拒否", { timeout: 30_000 }, (t) => {
  let ffmpeg;
  try { ffmpeg = resolveFfmpeg(); resolveFfprobe(); } catch { t.skip("ffmpeg/ffprobe unavailable"); return; }
  const root = mkdtempSync(join(tmpdir(), "avatar-drive-no-motion-"));
  const sourcePath = join(root, "source.mov");
  const generated = spawnSync(ffmpeg, [
    "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=navy:s=320x180:r=10:d=1",
    "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=48000:duration=1",
    "-shortest", "-c:v", "mpeg4", "-c:a", "pcm_s16le", sourcePath,
  ], { encoding: "utf8" });
  assert.equal(generated.status, 0, generated.stderr);
  writeFileSync(join(root, "edit.json"), `${JSON.stringify({
    version: 0, output: { width: 320, height: 180, fps: 10 },
    source: { path: "source.mov", proxy: null }, cuts: [{ in: 0, out: 1 }], overlays: [], layers: [],
  }, null, 2)}\n`);
  const args = [script, root, "--sprites", fixture, "--no-motion"];
  const first = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 30_000 });
  const firstHash = sha256(join(root, ".akari", "cache", "avatar-drive", "avatar-drive.mov"));
  const second = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 30_000 });
  assert.equal(first.status, 0, first.stderr || first.stdout);
  assert.equal(second.status, 0, second.stderr || second.stdout);
  assert.equal(first.stdout, second.stdout);
  assert.equal(firstHash, sha256(join(root, ".akari", "cache", "avatar-drive", "avatar-drive.mov")));
  assert.equal(JSON.parse(first.stdout).stats.width, 128);
  assert.equal(JSON.parse(first.stdout).stats.height, 128);
  const conflict = spawnSync(process.execPath, [...args, "--motion-intensity", "0.5"], { encoding: "utf8" });
  assert.equal(conflict.status, 2);
  assert.match(JSON.parse(conflict.stdout).reason, /同時/);
});

test("avatar-drive motion: intensity 1 の全 frame は透明境界内に収まる", { timeout: 30_000 }, async (t) => {
  let ffmpeg;
  try { ffmpeg = resolveFfmpeg(); resolveFfprobe(); } catch { t.skip("ffmpeg/ffprobe unavailable"); return; }
  const spriteSet = loadSpriteSet(fixture, { ffprobeCommand: resolveFfprobe() });
  const mouthStates = [...Array(12).fill("closed"), ...Array(36).fill("open"), ...Array(12).fill("closed")];
  const eyeStates = Array(mouthStates.length).fill("open");
  const motionFrames = buildMotionFrames({
    mouthStates, fps: 30, intensity: 1, seed: 4242, width: 128, height: 128,
  });
  const root = mkdtempSync(join(tmpdir(), "avatar-drive-motion-bounds-"));
  const outPath = join(root, "motion.mov");
  const baked = await bakeAvatarClip({ spriteSet, mouthStates, eyeStates, fps: 30, outPath, motionFrames }, {
    ffmpegCommand: ffmpeg,
  });
  assert.equal(baked.margin, calculateMotionMargin(128, 128, motionFrames));
  assert.ok(baked.margin > 0);
  const decoded = spawnSync(ffmpeg, [
    "-v", "error", "-i", outPath, "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1",
  ], { encoding: null, maxBuffer: baked.width * baked.height * mouthStates.length * 4 + 1024 * 1024 });
  assert.equal(decoded.status, 0, String(decoded.stderr));
  const frameBytes = baked.width * baked.height * 4;
  assert.equal(decoded.stdout.length, frameBytes * mouthStates.length);
  for (let frame = 0; frame < mouthStates.length; frame += 1) {
    const start = frame * frameBytes;
    let minX = baked.width;
    let minY = baked.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < baked.height; y += 1) {
      for (let x = 0; x < baked.width; x += 1) {
        if (decoded.stdout[start + (y * baked.width + x) * 4 + 3] === 0) continue;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
    assert.ok(maxX >= minX && maxY >= minY, `frame ${frame} has alpha`);
    assert.ok(minX > 0 && minY > 0 && maxX < baked.width - 1 && maxY < baked.height - 1, `frame ${frame} bbox`);
    for (const [x, y] of [[0, 0], [baked.width - 1, 0], [0, baked.height - 1], [baked.width - 1, baked.height - 1]]) {
      assert.equal(decoded.stdout[start + (y * baked.width + x) * 4 + 3], 0, `frame ${frame} corner ${x},${y}`);
    }
  }
});

test("avatar-drive CLI: 必須入力なしは exit 2、--check は可否 JSON", () => {
  const missing = spawnSync(process.execPath, [script], { encoding: "utf8" });
  assert.equal(missing.status, 2);
  assert.match(JSON.parse(missing.stdout).reason, /project.*--sprites/);
  const checked = spawnSync(process.execPath, [script, "--check"], { encoding: "utf8" });
  assert.equal(checked.status, 0);
  assert.equal(typeof JSON.parse(checked.stdout).available, "boolean");
});

test("avatar-drive vowel: かなとローマ字を仕様どおりモーラへ分割する", () => {
  assert.deepEqual(moraeForWord("あいうえお"), ["a", "i", "u", "e", "o"]);
  assert.deepEqual(moraeForWord("こんにちは"), ["o", "closed", "i", "i", "a"]);
  assert.deepEqual(moraeForWord("がっこう"), ["a", "closed", "o", "u"]);
  assert.deepEqual(moraeForWord("きゃきゅきょ"), ["a", "u", "o"]);
  assert.deepEqual(moraeForWord("ラーメン"), ["a", "a", "e", "closed"]);
  assert.deepEqual(moraeForWord("ティッシュ"), ["i", "closed", "u"]);
  assert.equal(moraeForWord("東京"), null);
  assert.deepEqual(moraeForWord("kya"), ["a"]);
  assert.deepEqual(moraeForWord("gakkou"), ["a", "closed", "o", "u"]);
  assert.deepEqual(moraeForWord("konnichiwa"), ["o", "closed", "i", "i", "a"]);
});

test("avatar-drive vowel: captions と最小 transcript を同じ単語列へ正規化する", () => {
  const expected = [
    { start: 0.1, end: 0.4, text: "あ" },
    { start: 0.5, end: 0.9, text: "い" },
  ];
  const captions = {
    captions: [
      { text: "ignored", words: [expected[1]] },
      { text: "ignored without words" },
      { text: "ignored", words: [expected[0]] },
    ],
  };
  assert.deepEqual(parseTranscript(captions), expected);
  assert.deepEqual(parseTranscript([expected[1], expected[0]]), expected);
  assert.throws(() => parseTranscript([{ text: "あ", start: 1, end: 1 }]), /end.*start/);
  assert.throws(() => parseTranscript({ captions: [null] }), /object/);
  assert.throws(() => parseTranscript({ words: [] }), /配列または captions/);
});

test("avatar-drive vowel: 単語内はモーラ均等割り、語間ギャップは null", () => {
  assert.deepEqual(buildVowelTimeline({
    words: [
      { start: 0, end: 1, text: "あいう" },
      { start: 1.5, end: 2, text: "え" },
    ],
    frameCount: 8,
    fps: 4,
  }), ["a", "a", "i", "u", null, null, "e", "e"]);
});

test("avatar-drive vowel: 音量 closed を優先し、不明な発話中母音は a", () => {
  assert.deepEqual(resolveMouthStates({
    volumeStates: ["closed", "mid", "open", "open", "closed"],
    vowelTimeline: [null, "a", "i", null, "e"],
  }), ["closed", "a", "i", "a", "closed"]);
});

test("avatar-drive vowel: 旧 3 口 manifest は vowel で拒否し volume CLI では受理する", { timeout: 30_000 }, (t) => {
  let ffmpeg;
  try { ffmpeg = resolveFfmpeg(); resolveFfprobe(); } catch { t.skip("ffmpeg/ffprobe unavailable"); return; }
  const manifest = JSON.parse(readFileSync(join(fixture, "sprite.json"), "utf8"));
  for (const vowel of ["a", "i", "u", "e", "o"]) delete manifest.mouth[vowel];
  assert.throws(() => requireVowelMouthAssets(manifest), /mouth\.a\/i\/u\/e\/o/);

  const root = mkdtempSync(join(tmpdir(), "avatar-drive-volume-compat-"));
  const sourcePath = join(root, "source.mov");
  const generated = spawnSync(ffmpeg, [
    "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=navy:s=320x180:r=10:d=1",
    "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=48000:duration=1",
    "-shortest", "-c:v", "mpeg4", "-c:a", "pcm_s16le", sourcePath,
  ], { encoding: "utf8" });
  assert.equal(generated.status, 0, generated.stderr);
  writeFileSync(join(root, "edit.json"), `${JSON.stringify({
    version: 0,
    output: { width: 320, height: 180, fps: 10 },
    source: { path: "source.mov", proxy: null },
    cuts: [{ in: 0, out: 1 }], overlays: [], layers: [],
  }, null, 2)}\n`);
  writeFileSync(join(root, "sprite.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const name of [
    "base.png", "mouth-closed.png", "mouth-mid.png", "mouth-open.png", "eyes-open.png", "eyes-closed.png",
  ]) copyFileSync(join(fixture, name), join(root, name));

  const omitted = spawnSync(process.execPath, [script, root, "--sprites", root], { encoding: "utf8", timeout: 30_000 });
  const explicit = spawnSync(process.execPath, [script, root, "--sprites", root, "--mouth-mode", "volume"], {
    encoding: "utf8", timeout: 30_000,
  });
  assert.equal(omitted.status, 0, omitted.stderr || omitted.stdout);
  assert.equal(explicit.status, 0, explicit.stderr || explicit.stdout);
  assert.equal(explicit.stdout, omitted.stdout, "expression-track 未指定の stdout は byte 一致する");
});

test("avatar-drive expression CLI: head/emotion を加算し sprite ベイクは同一入力 2 回で決定論的", { timeout: 30_000 }, (t) => {
  let ffmpeg;
  try { ffmpeg = resolveFfmpeg(); resolveFfprobe(); } catch { t.skip("ffmpeg/ffprobe unavailable"); return; }
  const root = mkdtempSync(join(tmpdir(), "avatar-drive-expression-cli-"));
  const sourcePath = join(root, "source.mov");
  const generated = spawnSync(ffmpeg, [
    "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=navy:s=320x180:r=10:d=1",
    "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=48000:duration=1",
    "-shortest", "-c:v", "mpeg4", "-c:a", "pcm_s16le", sourcePath,
  ], { encoding: "utf8" });
  assert.equal(generated.status, 0, generated.stderr);
  writeFileSync(join(root, "edit.json"), `${JSON.stringify({
    version: 0, output: { width: 320, height: 180, fps: 10 },
    source: { path: "source.mov", proxy: null }, cuts: [{ in: 0, out: 1 }], overlays: [], layers: [],
  }, null, 2)}\n`);
  const expressionPath = join(root, "face.json");
  writeFileSync(expressionPath, JSON.stringify({
    version: 0, kind: "face-expression", source: { path: "source.mov", duration: 1 }, sample_fps: 10,
    samples: Array.from({ length: 10 }, (_, index) => ({
      t: index / 10,
      detections: [{
        head: { yaw: -0.01 + index * 0.001, pitch: 0, roll: 0 },
        blendshapes: {
          eyeBlinkLeft: index === 4 || index === 5 ? 0.6 : 0.05,
          eyeBlinkRight: index === 4 || index === 5 ? 0.58 : 0.05,
          mouthSmileLeft: index >= 6 ? 0.6 : 0,
          mouthSmileRight: index >= 6 ? 0.6 : 0,
        },
      }],
    })),
  }));
  const args = [script, root, "--sprites", fixture, "--expression-track", expressionPath, "--head-smoothing", "0"];
  const first = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 30_000 });
  const second = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 30_000 });
  assert.equal(first.status, 0, first.stderr || first.stdout);
  assert.equal(second.status, 0, second.stderr || second.stdout);
  assert.equal(first.stdout, second.stdout);
  const output = JSON.parse(first.stdout);
  assert.equal(output.drive.fps, 10);
  assert.equal(output.drive.head.length, output.drive.mouth.length);
  assert.equal(output.drive.emotion[7], "happy");
  assert.equal(output.drive.eyes[4], "closed");
  assert.equal(output.layers[0].preset, "avatar-drive-v0");
});

test("avatar-drive vowel CLI: transcript 駆動の stdout は同一入力 2 回で一致する", { timeout: 30_000 }, (t) => {
  let ffmpeg;
  try { ffmpeg = resolveFfmpeg(); resolveFfprobe(); } catch { t.skip("ffmpeg/ffprobe unavailable"); return; }
  const root = mkdtempSync(join(tmpdir(), "avatar-drive-vowel-cli-"));
  const sourcePath = join(root, "source.mov");
  const generated = spawnSync(ffmpeg, [
    "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=navy:s=320x180:r=20:d=1.5",
    "-f", "lavfi", "-i", "aevalsrc=if(between(t\\,0.2\\,1.2)\\,0.45*sin(2*PI*220*t)\\,0):s=48000:d=1.5",
    "-shortest", "-c:v", "mpeg4", "-c:a", "pcm_s16le", sourcePath,
  ], { encoding: "utf8" });
  assert.equal(generated.status, 0, generated.stderr);
  writeFileSync(join(root, "edit.json"), `${JSON.stringify({
    version: 0,
    output: { width: 320, height: 180, fps: 20 },
    source: { path: "source.mov", proxy: null },
    cuts: [{ in: 0, out: 1.5 }], overlays: [], layers: [],
  }, null, 2)}\n`);
  const transcriptPath = join(root, "transcript.json");
  writeFileSync(transcriptPath, `${JSON.stringify([
    { text: "あい", start: 0.2, end: 0.7 },
    { text: "うえお", start: 0.7, end: 1.2 },
  ], null, 2)}\n`);
  const args = [script, root, "--sprites", fixture, "--mouth-mode", "vowel", "--transcript", transcriptPath];
  const firstRun = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 30_000 });
  const secondRun = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 30_000 });
  assert.equal(firstRun.status, 0, firstRun.stderr || firstRun.stdout);
  assert.equal(secondRun.status, 0, secondRun.stderr || secondRun.stdout);
  const first = JSON.parse(firstRun.stdout);
  const second = JSON.parse(secondRun.stdout);
  assert.deepEqual(first, second);
  assert.ok(first.drive.mouth.includes("closed"));
  assert.ok(first.drive.mouth.some((state) => ["a", "i", "u", "e", "o"].includes(state)));
  assert.equal(first.drive.mouth.some((state) => state === "mid" || state === "open"), false);
  assert.deepEqual(Object.keys(first.stats.mouth_counts), ["closed", "a", "i", "u", "e", "o"]);

  const missingTranscript = spawnSync(process.execPath, [script, root, "--sprites", fixture, "--mouth-mode", "vowel"], {
    encoding: "utf8",
  });
  assert.equal(missingTranscript.status, 1);
  assert.match(JSON.parse(missingTranscript.stdout).reason, /--transcript/);
});
