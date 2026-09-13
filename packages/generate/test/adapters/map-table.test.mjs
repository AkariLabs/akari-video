// 契約 task.md は 13 セル = 52 と数えるが、①が prompt/negative_prompt の 2 キーになるため
// 9 スロット = 9 キーの内訳は prompt / negative_prompt / first_frame / last_frame /
// reference_images / reference_videos / reference_audios / source_video / camera。⑨ seed と
// 逃げ道 extra は fail closed のために MAP セルが要るので追加 2 キー（計 15）で持つ。
import assert from "node:assert/strict";
import test from "node:test";

import { adapter as h3 } from "../../src/adapters/fal-h3-i2v.mjs";
import {
  adapter as kling,
  proAdapter as klingPro,
} from "../../src/adapters/fal-kling-v3-i2v.mjs";
import { adapter as seedance } from "../../src/adapters/fal-seedance-2-i2v.mjs";
import { adapter as veo } from "../../src/adapters/fal-veo-3.1-flf.mjs";
import {
  AUX_KEYS,
  KNOB_KEYS,
  MAP_KEYS,
  SLOT_KEYS,
} from "../../src/adapters/request-shape.mjs";

const EXPECTED = {
  [h3.id]: {
    prompt: { param: "prompt", format: "text" },
    negative_prompt: "drop-if-empty",
    first_frame: { param: "image_url", format: "media-url" },
    last_frame: { param: "end_image_url", format: "media-url" },
    reference_images: "reject",
    reference_videos: "reject",
    reference_audios: "reject",
    source_video: "reject",
    camera: { into: "prompt", notation: "bracket" },
    seed: { param: "seed", format: "integer-any" },
    extra: { allow: ["prompt_expansion_mode"] },
    duration_s: { param: "duration", format: "integer", min: 5, max: 15 },
    resolution: { param: "resolution", format: "enum", enum: ["480P", "768P", "2K", "4K"] },
    aspect: "reject",
    audio_out: "reject",
  },
  [kling.id]: {
    prompt: { param: "prompt", format: "text" },
    negative_prompt: { param: "negative_prompt", format: "text" },
    first_frame: { param: "start_image_url", format: "media-url" },
    last_frame: { param: "end_image_url", format: "media-url" },
    reference_images: { param: "elements", format: "kling-elements" },
    reference_videos: "reject",
    reference_audios: "reject",
    source_video: "reject",
    camera: { into: "prompt", notation: "prose" },
    seed: "reject",
    extra: { allow: ["cfg_scale", "shot_type"] },
    duration_s: { param: "duration", format: "string-int", min: 3, max: 15 },
    resolution: "reject",
    aspect: "reject",
    audio_out: { param: "generate_audio", format: "boolean" },
  },
  [seedance.id]: {
    prompt: { param: "prompt", format: "text" },
    negative_prompt: "drop-if-empty",
    first_frame: { param: "image_url", format: "media-url" },
    last_frame: { param: "end_image_url", format: "media-url" },
    reference_images: "reject",
    reference_videos: "reject",
    reference_audios: "reject",
    source_video: "reject",
    camera: { into: "prompt", notation: "prose" },
    seed: "reject",
    extra: { allow: ["bitrate_mode"] },
    duration_s: { param: "duration", format: "string-int-or-auto", min: 4, max: 15 },
    resolution: { param: "resolution", format: "enum", enum: ["480p", "720p", "1080p", "4k"] },
    aspect: { param: "aspect_ratio", format: "enum", enum: ["auto", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] },
    audio_out: { param: "generate_audio", format: "boolean" },
  },
  [veo.id]: {
    prompt: { param: "prompt", format: "text" },
    negative_prompt: { param: "negative_prompt", format: "text" },
    first_frame: { param: "first_frame_url", format: "media-url" },
    last_frame: { param: "last_frame_url", format: "media-url" },
    reference_images: "reject",
    reference_videos: "reject",
    reference_audios: "reject",
    source_video: "reject",
    camera: { into: "prompt", notation: "prose" },
    seed: { param: "seed", format: "integer-any" },
    extra: { allow: ["safety_tolerance", "auto_fix"] },
    duration_s: { param: "duration", format: "string-seconds", enum: [4, 6, 8] },
    resolution: { param: "resolution", format: "enum", enum: ["720p", "1080p", "4k"] },
    aspect: { param: "aspect_ratio", format: "enum", enum: ["auto", "16:9", "9:16"] },
    audio_out: { param: "generate_audio", format: "boolean" },
  },
};

const ADAPTERS = [h3, kling, seedance, veo];
const CONTRACT_CELLS = [...SLOT_KEYS, ...KNOB_KEYS];

test("4 アダプタの MAP は 15 セルの期待表と完全一致する", () => {
  assert.deepStrictEqual(Object.keys(EXPECTED), ADAPTERS.map((item) => item.id));
  for (const item of ADAPTERS) {
    assert.deepStrictEqual(Object.keys(EXPECTED[item.id]), MAP_KEYS);
    assert.deepStrictEqual(Object.keys(item.MAP), MAP_KEYS);
    for (const key of MAP_KEYS) assert.deepStrictEqual(item.MAP[key], EXPECTED[item.id][key]);
  }
});

test("契約 13 セル × 4 は 52、補助 2 セル × 4 は 8", () => {
  assert.equal(CONTRACT_CELLS.length, 13);
  assert.equal(ADAPTERS.reduce(
    (count, item) => count + CONTRACT_CELLS.filter((key) => Object.hasOwn(EXPECTED[item.id], key)).length,
    0,
  ), 52);
  assert.equal(ADAPTERS.reduce(
    (count, item) => count + AUX_KEYS.filter((key) => Object.hasOwn(EXPECTED[item.id], key)).length,
    0,
  ), 8);
  assert.equal(ADAPTERS.length * MAP_KEYS.length, 60);
});

test("Kling pro は standard と MAP が同一で endpoint だけが異なる", () => {
  assert.strictEqual(klingPro.MAP, kling.MAP);
  assert.strictEqual(klingPro.required, kling.required);
  assert.notEqual(klingPro.endpoint, kling.endpoint);
  assert.equal(klingPro.id, "fal:kling-v3-pro-i2v");
});
