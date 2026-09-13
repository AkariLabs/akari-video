import assert from "node:assert/strict";
import test from "node:test";

import { adapter as h3 } from "../../src/adapters/fal-h3-i2v.mjs";
import { adapter as kling } from "../../src/adapters/fal-kling-v3-i2v.mjs";
import { adapter as seedance } from "../../src/adapters/fal-seedance-2-i2v.mjs";
import { adapter as veo } from "../../src/adapters/fal-veo-3.1-flf.mjs";

const resolveMedia = (ref) => `https://example.invalid/${ref.path}`;
const media = (path) => ({ path });
const validInputs = new Map([
  [h3, { prompt: "A scene." }],
  [kling, { first_frame: media("start.png") }],
  [seedance, { prompt: "A scene.", first_frame: media("start.png") }],
  [veo, { prompt: "A scene.", first_frame: media("start.png"), last_frame: media("end.png") }],
]);

for (const item of [h3, kling, seedance, veo]) {
  test(`${item.id}: MAP にない inputs.foo_slot を拒否する`, () => {
    const result = item.map({ ...validInputs.get(item), foo_slot: true }, {}, { resolveMedia });
    assert.equal(result.ok, false);
    assert.equal(result.rejected[0].slot, "foo_slot");
  });
}

const REJECT_CASES = [
  [h3, "source_video", media("source.mp4")],
  [kling, "reference_videos", [media("reference.mp4")]],
  [seedance, "reference_images", [media("reference.png")]],
  [veo, "reference_audios", [media("reference.wav")]],
];

for (const [item, slot, value] of REJECT_CASES) {
  test(`${item.id}: 値のある reject セル ${slot} を拒否する`, () => {
    const result = item.map({ ...validInputs.get(item), [slot]: value }, {}, { resolveMedia });
    assert.equal(result.ok, false);
    assert.equal(result.rejected.some((entry) => entry.slot === slot), true);
  });
}

test("output の未知ノブ fps を拒否する", () => {
  const result = h3.map(validInputs.get(h3), { fps: 24 }, { resolveMedia });
  assert.equal(result.ok, false);
  assert.equal(result.rejected[0].slot, "fps");
});

const DURATION_CASES = [
  [veo, 5],
  [h3, 20],
  [kling, 2],
  [seedance, 3],
];

for (const [item, duration_s] of DURATION_CASES) {
  test(`${item.id}: duration_s ${duration_s} を丸めず拒否する`, () => {
    const result = item.map(validInputs.get(item), { duration_s }, { resolveMedia });
    assert.equal(result.ok, false);
    assert.equal(result.rejected.some((entry) => entry.slot === "duration_s"), true);
  });
}

test("trajectory カメラ記法を prompt に近似せず拒否する", () => {
  const result = h3.map({
    ...validInputs.get(h3),
    camera: { notation: "trajectory", value: "0,0,1" },
  }, {}, { resolveMedia });
  assert.deepStrictEqual(result, {
    ok: false,
    rejected: [{ slot: "camera", reason: "camera notation cannot be mapped to prompt" }],
  });
});

test("reject 時は endpoint も body も返さず部分送信しない", () => {
  const result = h3.map({ ...validInputs.get(h3), source_video: media("source.mp4") }, {}, { resolveMedia });
  assert.equal(result.ok, false);
  assert.equal(Object.hasOwn(result, "body"), false);
  assert.equal(Object.hasOwn(result, "endpoint"), false);
});

test("複数の reject セルを MAP_KEYS 順ですべて返す", () => {
  const result = h3.map({
    ...validInputs.get(h3),
    reference_images: [media("reference.png")],
    reference_videos: [media("reference.mp4")],
  }, {}, { resolveMedia });
  assert.deepStrictEqual(result.rejected, [
    { slot: "reference_images", reason: "slot not supported by this model" },
    { slot: "reference_videos", reason: "slot not supported by this model" },
  ]);
});
