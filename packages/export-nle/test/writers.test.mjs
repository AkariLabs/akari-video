import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEdit, baseTimelineDuration } from "../src/edit-model.mjs";
import { frameDuration } from "../src/time.mjs";
import { buildFcpxml } from "../src/fcpxml.mjs";
import { buildXmeml } from "../src/xmeml.mjs";
import { buildSrt } from "../src/srt.mjs";
import { assertWellFormedXml } from "./helpers.mjs";

const edit = {
  version: 1,
  output: { width: 1080, height: 1920, fps: 30 },
  sources: [{ id: "main", path: "main.mp4", proxy: null }],
  cuts: [
    { src: "main", in: 0, out: 5, transition_out: { type: "dissolve", duration: 1 } },
    { src: "main", in: 10, out: 15, speed: 2, transform: { x: 10, y: -20, scale: 1.2 }, opacity: 0.9 },
  ],
  layers: [
    { id: "l-0001", t: 1, duration: 2, kind: "baked", src: "telop.mov", opacity: 0.8, blend: "screen" },
  ],
  audio: {
    narration: [
      { id: "n-0001", path: "narration/n-0001.mp3", t: 1, gain_db: -3, provenance: { provider: "human" } },
    ],
    bgm: { path: "bgm.mp3", gain_db: -18, ducking: true, fadeOut: 2 },
    sfx: [{ path: "sfx/hit.wav", t: 2, in: 0.5, out: 1.5, gain_db: -6 }],
    master: { loudnorm: -14 },
  },
  beats: [{ id: "b-0001", src: "main", t: 2, kind: "hook", strength: 0.8 }],
  emphasis_words: [
    { id: "e-0001", src: "main", t_start: 11, t_end: 11.5, word: "ここ", emotion: "surprise" },
    { id: "e-0002", src: "main", t_start: 7, t_end: 7.5, word: "圏外", emotion: "joy" },
  ],
  direction: { preset: "shorts-high-energy", intensity: 70 },
};

function buildContext(model) {
  return {
    durations: new Map([
      ["main.mp4", 20],
      ["bgm.mp3", 4],
      ["narration/n-0001.mp3", 2],
      ["sfx/hit.wav", 3],
      ["telop.mov", 2],
    ]),
    frameDur: frameDuration(model.output.fps),
    totalDuration: baseTimelineDuration(model),
  };
}

test("fcpxml: well-formed で、主要素と時刻が量子化有理数で入る", () => {
  const model = normalizeEdit(edit, "/tmp/demo-project");
  const { xml, dropped } = buildFcpxml(model, buildContext(model));
  assertWellFormedXml(xml);
  assert.match(xml, /<fcpxml version="1\.11">/);
  assert.match(xml, /frameDuration="1\/30s"/);
  // xfade: cut1 可視尺 4s → junction 4s、中央寄せで offset 3.5s
  assert.match(xml, /<transition name="Cross Dissolve" offset="7\/2s" duration="1s"\/>/);
  // beat は含むカットのクリップへ source 秒のまま marker
  assert.match(xml, /<marker start="2s"[^>]*value="beat:hook \(0\.8\)"/);
  // BGM は実尺 4s → 全体尺 6.5s を 2 ループで充填
  assert.match(xml, /name="bgm \(loop 1\)"/);
  assert.match(xml, /name="bgm \(loop 2\)"/);
  // ゲインは adjust-volume
  assert.match(xml, /<adjust-volume amount="-3dB"\/>/);
  assert.match(xml, /audioRole="dialogue"/);
});

test("fcpxml: 移らないフィールドが dropped に列挙される（黙って落とさない）", () => {
  const model = normalizeEdit(edit, "/tmp/demo-project");
  const { dropped } = buildFcpxml(model, buildContext(model));
  const fields = dropped.map((entry) => entry.field);
  assert.ok(fields.includes("audio.bgm.ducking"));
  assert.ok(fields.includes("audio.master"));
  assert.ok(fields.includes("direction"));
  // カット範囲外の emphasis はマーカーにならず dropped
  assert.ok(fields.includes("emphasis_words[e-0002]"));
});

test("xmeml: well-formed で、フレーム整数と NTSC フラグが正しい", () => {
  const model = normalizeEdit(edit, "/tmp/demo-project");
  const { xml } = buildXmeml(model, buildContext(model));
  assertWellFormedXml(xml);
  assert.match(xml, /<xmeml version="5">/);
  assert.match(xml, /<timebase>30<\/timebase>/);
  assert.match(xml, /<ntsc>FALSE<\/ntsc>/);
  // cut1: start 0 / end 120（可視 4s @30fps）、transition は 105-135 中央寄せ
  assert.match(xml, /<start>105<\/start>/);
  assert.match(xml, /<end>135<\/end>/);
  // -18dB → 線形 0.125893
  assert.match(xml, /<value>0\.125893<\/value>/);
  // speed 2 → timeremap 200%
  assert.match(xml, /<effectid>timeremap<\/effectid>/);
  assert.match(xml, /<value>200<\/value>/);
  // beat はシーケンスマーカー
  assert.match(xml, /<name>beat:hook \(0\.8\)<\/name>/);
});

test("xmeml: NTSC fps でフレームが真のレートで丸まる", () => {
  const model = normalizeEdit({ ...edit, output: { width: 1080, height: 1920, fps: 29.97 } }, "/tmp/p");
  const { xml } = buildXmeml(model, buildContext(model));
  assert.match(xml, /<ntsc>TRUE<\/ntsc>/);
  // 4s @29.97 → 120 フレーム（4 * 30000/1001 = 119.88 → 120）
  assert.match(xml, /<end>120<\/end>/);
});

test("srt: source 秒アンカーを timeline へ写した cue を出す", () => {
  const model = normalizeEdit(edit, "/tmp/demo-project");
  const captions = [
    { id: "c-0001", start: 1, end: 3, text: "こんにちは", src: "main", speaker: null, sourceRef: null, edited: false },
    { id: "c-0002", start: 11, end: 12, text: "スピード区間", src: "main", speaker: null, sourceRef: null, edited: false, style: "karaoke" },
    { id: "c-0003", start: 7, end: 8, text: "カット圏外", src: "main", speaker: null, sourceRef: null, edited: false },
  ];
  const { srt, cueCount, dropped } = buildSrt(model, captions);
  assert.equal(cueCount, 2);
  assert.match(srt, /1\n00:00:01,000 --> 00:00:03,000\nこんにちは/);
  // speed 2: source [11,12) → timeline 4.5 から 0.5s
  assert.match(srt, /2\n00:00:04,500 --> 00:00:05,000\nスピード区間/);
  assert.ok(!srt.includes("カット圏外"));
  assert.ok(dropped.some((entry) => entry.field.startsWith("captions[]")));
});
