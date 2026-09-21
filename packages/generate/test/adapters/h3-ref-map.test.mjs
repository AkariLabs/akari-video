import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { after, before } from "node:test";

import { adapter, MAP } from "../../src/adapters/fal-h3-ref.mjs";
import { adapter as seedance } from "../../src/adapters/fal-seedance-2-ref.mjs";
import { getAdapter, MAP_KEYS } from "../../src/adapters/index.mjs";

let originalFetch;
let fetches = 0;
before(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetches += 1; throw new Error("network forbidden"); };
});
after(() => { globalThis.fetch = originalFetch; assert.equal(fetches, 0); });

const schema = JSON.parse(readFileSync(new URL("../../../schemas/fixtures/gen-models/openapi/fal_h3-ref.json", import.meta.url)))
  .components.schemas.H3ReferenceToVideoInput;
const catalog = JSON.parse(readFileSync(new URL("../../../schemas/gen-models.json", import.meta.url)))
  .models.find(({ id }) => id === adapter.id);
const media = (path) => ({ path });
const resolveMedia = (ref) => `data:application/octet-stream;base64,${Buffer.from(ref.path).toString("base64")}`;
const map = (inputs = {}, output = {}) => adapter.map({ prompt: "歩く", ...inputs }, output, { resolveMedia });
const EXPECTED = {
  prompt: { param: "prompt", format: "text" },
  negative_prompt: "drop-if-empty",
  first_frame: "reject",
  last_frame: "reject",
  reference_images: { param: "reference_image_urls", format: "media-url-array", max: 9, tag: "Image", tag_joiner: " " },
  reference_videos: { param: "reference_video_urls", format: "media-url-array", max: 3, tag: "Video", tag_joiner: " " },
  reference_audios: { param: "reference_audio_urls", format: "media-url-array", max: 3, tag: "Audio", tag_joiner: " " },
  source_video: "reject",
  camera: { into: "prompt", notation: "prose" },
  seed: { param: "seed", format: "integer-any" },
  extra: { allow: ["enable_safety_checker", "prompt_expansion_mode", "sync_mode"] },
  duration_s: { param: "duration", format: "integer", min: 5, max: 15 },
  resolution: { param: "resolution", format: "enum", enum: ["480P", "768P", "2K", "4K"] },
  aspect: { param: "aspect_ratio", format: "enum", enum: ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] },
  audio_out: "reject",
};

test("H3 reference: 全15セル・登録・endpoint・required はカタログと OpenAPI に一致する", () => {
  assert.deepEqual(Object.keys(MAP), MAP_KEYS);
  assert.deepEqual(MAP, EXPECTED);
  assert.equal(getAdapter(adapter.id), adapter);
  assert.equal(adapter.endpoint, catalog.endpoint);
  assert.deepEqual(adapter.required, schema.required);
});

for (const key of MAP_KEYS) {
  test(`H3 reference: ${key} の写像・拒否と OpenAPI Input 根拠`, () => {
    const cell = MAP[key];
    assert.deepEqual(cell, EXPECTED[key]);
    if (typeof cell === "string") {
      const result = key === "audio_out" ? map({}, { audio_out: true })
        : map({ [key]: key === "negative_prompt" ? "no" : media("unused") });
      assert.equal(result.ok, false);
      assert.ok(result.rejected.some(({ slot }) => slot === key));
      assert.equal(Object.hasOwn(result, "body"), false);
      return;
    }
    for (const param of cell.allow ?? [cell.param ?? cell.into]) {
      assert.ok(Object.hasOwn(schema.properties, param), param);
    }
    if (cell.format === "text") {
      assert.equal(schema.properties.prompt.type, "string");
      assert.equal(map({ prompt: "Text" }).body.prompt, "Text");
    }
    if (cell.format === "media-url-array") {
      const prop = schema.properties[cell.param];
      assert.equal(prop.type, "array");
      assert.equal(prop.items.type, "string");
      assert.equal(cell.max, prop.maxItems);
      assert.equal(cell.max, catalog.inputs[key].max);
      assert.equal(cell.tag, catalog.inputs[key].tag);
      assert.equal(cell.tag_joiner, catalog.inputs[key].tag_joiner);
      assert.ok(prop.description.includes(`${cell.tag}${cell.tag_joiner}1`));
      const refs = [media("second"), media("first")];
      assert.deepEqual(map({ [key]: refs }).body[cell.param], refs.map(resolveMedia));
    }
    if (cell.enum) {
      assert.deepEqual(cell.enum, schema.properties[cell.param].enum);
      for (const value of cell.enum) assert.equal(map({}, { [key]: value }).body[cell.param], value);
      assert.equal(map({}, { [key]: "invalid" }).ok, false);
    }
    if (cell.format === "integer") {
      assert.equal(schema.properties.duration.type, "integer");
      assert.equal(cell.min, schema.properties.duration.minimum);
      assert.equal(cell.max, schema.properties.duration.maximum);
      for (let duration = 5; duration <= 15; duration += 1) {
        assert.equal(map({}, { duration_s: duration }).body.duration, duration);
      }
      for (const duration_s of [4, 16, 5.5, "6"]) assert.equal(map({}, { duration_s }).ok, false);
    }
    if (cell.format === "integer-any") {
      assert.ok(schema.properties.seed.anyOf.some(({ type }) => type === "integer"));
      for (const seed of [-1, 0, 42]) assert.equal(map({ seed }).body.seed, seed);
      assert.equal(map({ seed: 1.5 }).ok, false);
    }
    if (cell.into) {
      assert.equal(cell.notation, catalog.inputs.camera);
      assert.equal(map({ camera: { notation: "prose", value: "追う" } }).body.prompt, "追う. 歩く");
      assert.equal(map({ camera: { notation: "trajectory", value: "x" } }).ok, false);
    }
    if (cell.allow) {
      assert.deepEqual(cell.allow, catalog.inputs.extra_allowed);
      const extra = { enable_safety_checker: true, prompt_expansion_mode: "disabled", sync_mode: false };
      assert.deepEqual(map({ extra }).body, { prompt: "歩く", ...extra });
      assert.equal(schema.properties.enable_safety_checker.type, "boolean");
      assert.equal(schema.properties.sync_mode.type, "boolean");
      assert.deepEqual(schema.properties.prompt_expansion_mode.anyOf.map(({ type }) => type), ["string", "null"]);
      assert.equal(map({ extra: { prompt_expansion_mode: null } }).body.prompt_expansion_mode, null);
      for (const invalid of [{ unknown: true }, { enable_safety_checker: "true" }, { sync_mode: 1 }, { prompt_expansion_mode: 1 }]) {
        assert.equal(map({ extra: invalid }).ok, false);
      }
    }
  });
}

test("H3: 全参照・camera・seed・出力を写し入力を変更しない", () => {
  const inputs = {
    prompt: "@画像2 と @画像1 が @動画1 と @音声1 に合わせる",
    reference_images: [media("a"), media("b")], reference_videos: [media("v")], reference_audios: [media("s")],
    camera: { notation: "prose", value: "追う" }, seed: 0,
    extra: { enable_safety_checker: true, prompt_expansion_mode: "balanced", sync_mode: false },
  };
  const output = { duration_s: 6, resolution: "768P", aspect: "9:16" };
  const original = structuredClone({ inputs, output });
  assert.deepEqual(map(inputs, output), { ok: true, endpoint: adapter.endpoint, body: {
    prompt: "追う. Image 2 と Image 1 が Video 1 と Audio 1 に合わせる", seed: 0, ...inputs.extra,
    duration: 6, resolution: "768P", aspect_ratio: "9:16",
    reference_image_urls: inputs.reference_images.map(resolveMedia),
    reference_video_urls: inputs.reference_videos.map(resolveMedia),
    reference_audio_urls: inputs.reference_audios.map(resolveMedia),
  } });
  assert.deepEqual({ inputs, output }, original);
});

test("H3: 範囲外・0・負数・非整数の日本語札はメディア解決前に拒否", () => {
  for (const prompt of ["@画像3", "@画像0", "@画像-1", "@画像1.5", "@動画1", "@音声1"]) {
    let resolves = 0;
    const result = adapter.map({ prompt, reference_images: [media("a"), media("b")] }, {}, {
      resolveMedia() { resolves += 1; throw new Error("must not resolve"); },
    });
    assert.equal(result.ok, false, prompt);
    assert.ok(result.rejected.some(({ slot }) => slot === "prompt"));
    assert.equal(resolves, 0);
  }
});

test("H3・Seedance: 素の英文は本数に関係なく保持し日本語札だけ行の記法に置換", () => {
  for (const item of [adapter, seedance]) {
    for (const prompt of ["Image 1 of 3", "Image 3, Video 3, Audio 3"]) {
      for (const reference_images of [[], [media("a")]]) {
        const result = item.map({ prompt, reference_images }, {}, { resolveMedia });
        assert.equal(result.ok, true);
        assert.equal(result.body.prompt, prompt);
      }
    }
    const result = item.map({ prompt: "Image 1 of 3: @画像1", reference_images: [media("a")] }, {}, { resolveMedia });
    assert.equal(result.body.prompt, `Image 1 of 3: ${item === adapter ? "Image 1" : "@Image1"}`);
  }
});

test("H3: 種別上限9/3/3と合計12、配列型・未知キーを fail closed", () => {
  for (const slot of ["reference_images", "reference_videos", "reference_audios"]) {
    const max = MAP[slot].max;
    assert.equal(map({ [slot]: Array(max).fill(media("a")) }).ok, true);
    for (const value of ["bad", {}, [null], [{}], Array(max + 1).fill(media("a"))]) {
      assert.equal(map({ [slot]: value }).ok, false);
    }
  }
  const references = { reference_images: Array(8).fill(media("a")), reference_videos: Array(3).fill(media("v")), reference_audios: [media("s")] };
  assert.equal(map(references).ok, true);
  assert.equal(map({ ...references, reference_images: Array(9).fill(media("a")) }).ok, false);
  assert.equal(map({ unknown: 1 }).ok, false);
  assert.equal(map({}, { fps: 24 }).ok, false);
  assert.equal(map({ prompt: "" }).ok, false);
  assert.deepEqual(map().body, { prompt: "歩く" });
});
