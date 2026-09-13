import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { adapter as h3 } from "../../src/adapters/fal-h3-i2v.mjs";
import { adapter as kling } from "../../src/adapters/fal-kling-v3-i2v.mjs";
import { adapter as seedance } from "../../src/adapters/fal-seedance-2-i2v.mjs";
import { adapter as veo } from "../../src/adapters/fal-veo-3.1-flf.mjs";

const resolveMedia = (ref) => `https://example.invalid/${ref.path}`;

const CASES = [
  {
    fixture: "h3-first-last-6s-768p.json",
    adapter: h3,
    inputs: {
      prompt: "A person stands up from a dim night desk and walks toward warm window light.",
      first_frame: { path: "assets/stills/s03-leaving-desk.png" },
      last_frame: { path: "assets/stills/s03-family-garden.png" },
      camera: { notation: "bracket", value: "[Tracking shot]" },
    },
    output: { duration_s: 6, resolution: "768P" },
  },
  {
    fixture: "h3-last-frame-only.json",
    adapter: h3,
    inputs: {
      prompt: "Warm morning light fills a quiet garden.",
      first_frame: null,
      last_frame: { path: "assets/stills/garden.png" },
    },
    output: { duration_s: 5 },
  },
  {
    fixture: "kling-elements-two-refs-7s.json",
    adapter: kling,
    inputs: {
      prompt: "The subject turns toward the camera.",
      first_frame: { path: "assets/stills/subject-start.png" },
      reference_images: [
        { path: "assets/refs/subject-front.png" },
        { path: "assets/refs/subject-side.png" },
      ],
    },
    output: { duration_s: 7, audio_out: true },
  },
  {
    fixture: "seedance-duration-auto.json",
    adapter: seedance,
    inputs: {
      prompt: "A paper bird glides across the room.",
      first_frame: { path: "assets/stills/paper-bird.png" },
    },
    output: { duration_s: null, resolution: "720p", aspect: "16:9" },
  },
  {
    fixture: "veo-6s-negative.json",
    adapter: veo,
    inputs: {
      prompt: "Clouds part above a mountain lake.",
      negative_prompt: "text, watermark",
      first_frame: { path: "assets/stills/lake-cloudy.png" },
      last_frame: { path: "assets/stills/lake-sunrise.png" },
      seed: 42,
    },
    output: { duration_s: 6, resolution: "1080p" },
  },
  {
    fixture: "reject-h3-reference-audios.json",
    adapter: h3,
    inputs: {
      prompt: "A quiet room.",
      reference_audios: [{ path: "assets/audio/voice.wav" }],
    },
    output: {},
  },
  {
    fixture: "reject-veo-missing-last-frame.json",
    adapter: veo,
    inputs: {
      prompt: "A lantern crosses the river.",
      first_frame: { path: "assets/stills/lantern-start.png" },
      last_frame: null,
    },
    output: {},
  },
  {
    fixture: "reject-kling-extra-foo.json",
    adapter: kling,
    inputs: {
      first_frame: { path: "assets/stills/kling-start.png" },
      extra: { foo: 1 },
    },
    output: {},
  },
];

for (const item of CASES) {
  test(item.fixture, async () => {
    const fixtureUrl = new URL(`../fixtures/adapters/${item.fixture}`, import.meta.url);
    const expected = JSON.parse(await readFile(fixtureUrl, "utf8"));
    const actual = item.adapter.map(item.inputs, item.output, { resolveMedia });
    assert.deepStrictEqual(actual, expected);
  });
}
