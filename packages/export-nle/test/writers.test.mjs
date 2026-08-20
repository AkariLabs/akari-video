import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEdit, baseTimelineDuration } from "../src/edit-model.mjs";
import { frameDuration } from "../src/time.mjs";
import { buildFcpxml } from "../src/fcpxml.mjs";
import { buildXmeml } from "../src/xmeml.mjs";
import { buildSrt } from "../src/srt.mjs";
import { assertWellFormedXml } from "./helpers.mjs";

const edit = {
  version: 2,
  output: { width: 1080, height: 1920, fps: 30, look: { lut: "warm" } },
  sources: [{ id: "main", path: "main.mp4", proxy: null }],
  tracks: [
    { id: "main-track", lane: "visual", items: [
      { id: "c1", at: 0, duration: 150, source: { kind: "media", src: "main", in: 0, out: 5, transition_out: { type: "dissolve", duration: 1 } } },
      { id: "c2", at: 120, duration: 75, transform: { x: 10, y: -20, scale: 1.2 }, opacity: 0.9, source: { kind: "media", src: "main", in: 10, out: 15, speed: 2 } },
    ] },
    { id: "title-track", lane: "visual", items: [
      { id: "title", at: 30, duration: 60, opacity: 0.8, blend: "screen", source: { kind: "telop", preset: "title", baked: "title.mov" } },
      { id: "raw-html", at: 90, duration: 30, source: { kind: "html", path: "title.html" } },
    ] },
  ],
  audio: {
    narration: [{ id: "n-0001", path: "narration/n-0001.mp3", t: 1, gain_db: -3 }],
    bgm: { path: "bgm.mp3", gain_db: -18, ducking: true, fadeOut: 2 },
    sfx: [{ path: "sfx/hit.wav", t: 2, in: 0.5, out: 1.5, gain_db: -6 }],
    master: { loudnorm: -14 },
  },
};

function buildContext(model) {
  return {
    durations: new Map([
      ["main.mp4", 20], ["bgm.mp3", 4], ["narration/n-0001.mp3", 2],
      ["sfx/hit.wav", 3], ["title.mov", 2],
    ]),
    frameDur: frameDuration(model.output.fps),
    totalDuration: baseTimelineDuration(model),
  };
}

test("fcpxml: v2 track z、baked、トランジションを含む well-formed XML", () => {
  const model = normalizeEdit(edit, "/tmp/demo-project");
  const { xml, dropped } = buildFcpxml(model, buildContext(model));
  assertWellFormedXml(xml);
  assert.match(xml, /<fcpxml version="1\.11">/);
  assert.match(xml, /frameDuration="1\/30s"/);
  assert.match(xml, /<spine lane="1" offset="0s">/);
  assert.match(xml, /lane="2"[^>]*name="title"/);
  assert.match(xml, /<transition name="Cross Dissolve" offset="7\/2s" duration="1s"\/>/);
  assert.match(xml, /name="bgm \(loop 1\)"/);
  assert.match(xml, /<adjust-volume amount="-3dB"\/>/);
  assert.ok(dropped.some((entry) => entry.field === "audio.bgm.ducking"));
  assert.ok(dropped.some((entry) => entry.field.includes("raw-html")));
});

test("xmeml: v2 track z の順で映像トラックを出し、フレーム整数を保つ", () => {
  const model = normalizeEdit(edit, "/tmp/demo-project");
  const { xml, dropped } = buildXmeml(model, buildContext(model));
  assertWellFormedXml(xml);
  assert.match(xml, /<xmeml version="5">/);
  assert.match(xml, /<timebase>30<\/timebase>/);
  assert.match(xml, /<start>105<\/start>/);
  assert.match(xml, /<end>135<\/end>/);
  assert.ok(xml.indexOf("main.mp4") < xml.indexOf("title.mov"));
  assert.match(xml, /<effectid>timeremap<\/effectid>/);
  assert.ok(dropped.some((entry) => entry.field.includes("raw-html")));
});

test("srt: source 秒アンカーを v2 media item の絶対配置へ写す", () => {
  const model = normalizeEdit(edit, "/tmp/demo-project");
  const captions = [
    { id: "c-0001", start: 1, end: 3, text: "こんにちは", src: "main" },
    { id: "c-0002", start: 11, end: 12, text: "スピード区間", src: "main", style: "karaoke" },
    { id: "c-0003", start: 7, end: 8, text: "カット圏外", src: "main" },
  ];
  const { srt, cueCount, dropped } = buildSrt(model, captions);
  assert.equal(cueCount, 2);
  assert.match(srt, /00:00:01,000 --> 00:00:03,000\nこんにちは/);
  assert.match(srt, /00:00:04,500 --> 00:00:05,000\nスピード区間/);
  assert.ok(!srt.includes("カット圏外"));
  assert.ok(dropped.some((entry) => entry.field.startsWith("captions[]")));
});
