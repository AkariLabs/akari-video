import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { generateCaptionOverlays, sourceRangeToTimeline } from "../src/captions.mjs";
import { predictedDuration } from "../src/plan.mjs";
import { computeContentDurationSeconds } from "../src/content-duration.mjs";
import { captions, cuts } from "./fixtures/caption-multitrack.mjs";

const { buildTimelineMap, normalizeCaptionClock } = createRequire(import.meta.url)("../../edit-store/lib/index.js");
const endOf = (overlays) => Math.max(0, ...overlays.map(item => item.start + item.duration));
const windows = (overlays) => overlays.map(({ start, duration }) => ({ start, duration }))
  .sort((a, b) => a.start - b.start || a.duration - b.duration);

test("three overlapping copies project 14 cues exactly like preview, without the old 111.1s tail", () => {
  const map = buildTimelineMap(cuts, { trackZ: track => track });
  const preview = normalizeCaptionClock(captions.map(cue => ({
    ...cue, clockDomain: "source", clockSourceId: cue.src,
  })), map.segments);
  const overlays = generateCaptionOverlays(captions, cuts);
  assert.equal(captions.length, 14);
  assert.equal(overlays.length, 16, "hidden copies must not produce the old 14 × 3 = 42 occurrences");
  assert.equal(overlays.length, preview.length);
  assert.deepEqual(windows(overlays), preview.map(({ start, end }) => ({ start, duration: end - start })));
  assert.equal(endOf(overlays), Math.max(...preview.map(cue => cue.end)));
  assert.ok(Math.abs(endOf(overlays) - 40.7) < 1e-9);
  assert.equal(predictedDuration(cuts), 42.4);
  assert.equal(map.totalDuration, 42.4);
  const contentDuration = computeContentDurationSeconds({
    edit: { cuts }, cutsEndSeconds: predictedDuration(cuts), captionOverlays: overlays,
  });
  assert.equal(contentDuration, 42.4, "caption tail must no longer inflate the union duration to 111.1s");
  assert.ok(contentDuration < 111.1);
});

test("fully covered copies contribute no captions", () => {
  const stacked = [0, 1, 2].map(track => ({ src: "src-1", in: 0, out: 10, at: 0, track }));
  assert.deepEqual(windows(generateCaptionOverlays([captions[0]], stacked)), [{ start: 0.59, duration: 2.1 - 0.59 }]);
  stacked[2].src = "other";
  assert.deepEqual(generateCaptionOverlays([captions[0]], stacked, { sourceCount: 2 }), []);
});

test("a cue splits at each visible winner boundary, then resumes on the lower track", () => {
  const stacked = [
    { src: "src-1", in: 0, out: 10, at: 0, track: 0 },
    { src: "src-1", in: 3, out: 5, at: 3, track: 1 },
  ];
  assert.deepEqual(windows(generateCaptionOverlays([
    { id: "boundary", src: "src-1", start: 2, end: 6, text: "Boundary" },
  ], stacked)), [
    { start: 2, duration: 1 }, { start: 3, duration: 2 }, { start: 5, duration: 1 },
  ]);
});

test("gaps do not promote undeclared source cues, while output cues keep their own clock", () => {
  const spaced = [{ src: "src-1", in: 10, out: 12, at: 3, track: 0 }];
  const cue = { id: "gap", src: "src-1", start: 1, end: 2, text: "Gap" };
  assert.deepEqual(generateCaptionOverlays([cue], spaced), []);
  assert.deepEqual(windows(generateCaptionOverlays([{ ...cue, time_domain: "output" }], spaced)), [{ start: 1, duration: 1 }]);
  assert.deepEqual(sourceRangeToTimeline(10.5, 11.5, spaced), [{ start: 3.5, duration: 1 }]);
});

test("visible source windows retain word clipping and speed-scaled emphasis", () => {
  const cue = {
    id: "words", src: "src-1", start: 10, end: 14, text: "ABCD", style: "karaoke",
    words: ["A", "B", "C", "D"].map((text, index) => ({ text, start: 10 + index, end: 11 + index })),
  };
  const stacked = [
    { src: "src-1", in: 10, out: 14, at: 0, track: 0, speed: 2 },
    { src: "other", in: 0, out: 1, at: 0, track: 1 },
  ];
  const options = { emphasisWords: [{
    id: "e-0001", word: "D", t_start: 13, t_end: 14, emotion: "joy", style_hint: "size-pulse",
  }] };
  const actual = generateCaptionOverlays([cue], stacked, options);
  const serialReference = generateCaptionOverlays([cue], [{ src: "src-1", in: 12, out: 14, speed: 2 }], options);
  assert.equal(actual.length, 1);
  assert.equal(actual[0].start, 1);
  assert.equal(actual[0].duration, 1);
  assert.match(actual[0].html, /data-emphasis-id="e-0001"/);
  assert.equal(actual[0].html, serialReference[0].html, "source window and emphasis scale must match the equivalent trimmed serial cut");
});

test("empty visible runs do not fall back to the output clock", () => {
  assert.deepEqual(sourceRangeToTimeline(0, 1, [{ in: 0, out: 0, track: 1 }]), []);
});
