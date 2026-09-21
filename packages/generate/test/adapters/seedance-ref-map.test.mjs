import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test, { after, before } from "node:test";

import { adapter, MAP } from "../../src/adapters/fal-seedance-2-ref.mjs";
import { getAdapter, MAP_KEYS } from "../../src/adapters/index.mjs";

let originalFetch;
const unexpectedFetchUrls = [];
before(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    unexpectedFetchUrls.push(url);
    throw new Error(`real network forbidden: ${url}`);
  };
});
after(() => {
  globalThis.fetch = originalFetch;
  assert.deepEqual(unexpectedFetchUrls, [], "adapter mapping must not call globalThis.fetch");
});

const fixture = (name) => readFileSync(new URL(`../fixtures/openapi/${name}.json`, import.meta.url));
const schema = JSON.parse(fixture("bytedance_seedance-2.0_reference-to-video"))
  .components.schemas.Seedance20ReferenceToVideoInput;
const catalog = JSON.parse(readFileSync(new URL("../../../schemas/gen-models.json", import.meta.url)))
  .models.find((model) => model.id === adapter.id);
const media = (path) => ({ path });
const resolveMedia = (ref) => `data:application/octet-stream;base64,${Buffer.from(ref.path).toString("base64")}`;
const map = (inputs = {}, output = {}) => adapter.map({ prompt: "歩く", ...inputs }, output, { resolveMedia });

const EXPECTED = {
  prompt: { param: "prompt", format: "text" },
  negative_prompt: "drop-if-empty",
  first_frame: "reject",
  last_frame: "reject",
  reference_images: { param: "image_urls", format: "media-url-array", max: 9, tag: "@Image" },
  reference_videos: { param: "video_urls", format: "media-url-array", max: 3, tag: "@Video" },
  reference_audios: { param: "audio_urls", format: "media-url-array", max: 3, tag: "@Audio" },
  source_video: "reject",
  camera: { into: "prompt", notation: "prose" },
  seed: "reject",
  extra: { allow: ["bitrate_mode", "end_user_id"] },
  duration_s: { param: "duration", format: "string-int-or-auto", min: 4, max: 15 },
  resolution: { param: "resolution", format: "enum", enum: ["480p", "720p", "1080p", "4k"] },
  aspect: { param: "aspect_ratio", format: "enum", enum: ["auto", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] },
  audio_out: { param: "generate_audio", format: "boolean" },
};

test("Seedance reference: 全15セルと登録先を固定する", () => {
  assert.deepEqual(Object.keys(MAP), MAP_KEYS);
  assert.deepEqual(MAP, EXPECTED);
  assert.equal(getAdapter(adapter.id), adapter);
  assert.equal(adapter.endpoint, catalog.endpoint);
  assert.deepEqual(adapter.required, schema.required);
});

for (const key of MAP_KEYS) {
  test(`Seedance reference: ${key} の写像根拠は保存した Input schema にある`, () => {
    const cell = MAP[key];
    assert.deepEqual(cell, EXPECTED[key]);
    if (typeof cell === "string") {
      const value = key === "seed" ? 1 : key === "negative_prompt" ? "no" : media("unused");
      const result = map({ [key]: value });
      assert.equal(result.ok, false);
      assert.ok(result.rejected.some((entry) => entry.slot === key));
      return;
    }
    for (const param of cell.allow ?? [cell.param ?? cell.into]) {
      assert.ok(Object.hasOwn(schema.properties, param), param);
    }
    if (cell.enum) assert.deepEqual(cell.enum, schema.properties[cell.param].enum);
    if (cell.format === "text") assert.equal(schema.properties[cell.param].type, "string");
    if (cell.format === "boolean") assert.equal(schema.properties[cell.param].type, "boolean");
    if (cell.format === "media-url-array") {
      assert.equal(schema.properties[cell.param].type, "array");
      assert.equal(schema.properties[cell.param].items.type, "string");
      assert.equal(cell.max, schema.properties[cell.param].maxItems);
      assert.equal(cell.max, catalog.inputs[key].max);
      assert.equal(cell.tag, catalog.inputs[key].tag);
      assert.ok(schema.properties[cell.param].description.includes(`${cell.tag}1`));
    }
    if (cell.format === "string-int-or-auto") {
      assert.equal(schema.properties.duration.type, "string");
      assert.equal(map().body.duration, "auto");
      assert.equal(map({}, { duration_s: null }).body.duration, "auto");
      for (let duration = cell.min; duration <= cell.max; duration += 1) {
        assert.equal(map({}, { duration_s: duration }).body.duration, String(duration));
      }
      assert.deepEqual(schema.properties.duration.enum,
        ["auto", ...Array.from({ length: 12 }, (_, i) => String(i + 4))]);
    }
    if (cell.allow) assert.deepEqual(cell.allow, catalog.inputs.extra_allowed);
  });
}

test("全参照・全出力ノブ・camera・extra を写し、入力を変更しない", () => {
  const inputs = {
    prompt: "@画像2 と @画像1 が @動画1 と @音声1 に合わせる",
    reference_images: [media("a.png"), media("b.png")],
    reference_videos: [media("c.mp4")], reference_audios: [media("d.wav")],
    camera: { notation: "prose", value: "追いかける" },
    extra: { bitrate_mode: "high", end_user_id: "local-test" },
  };
  const before = structuredClone(inputs);
  assert.deepEqual(map(inputs, { duration_s: 7, resolution: "4k", aspect: "9:16", audio_out: false }), {
    ok: true, endpoint: adapter.endpoint, body: {
      prompt: "追いかける. @Image2 と @Image1 が @Video1 と @Audio1 に合わせる",
      image_urls: inputs.reference_images.map(resolveMedia),
      video_urls: inputs.reference_videos.map(resolveMedia),
      audio_urls: inputs.reference_audios.map(resolveMedia),
      bitrate_mode: "high", end_user_id: "local-test", duration: "7",
      resolution: "4k", aspect_ratio: "9:16", generate_audio: false,
    },
  });
  assert.deepEqual(inputs, before);
});

test("名指しなしなら prompt を追加・変更せず空の参照引数は送らない", () => {
  const prompt = "  画像と音の雰囲気を使う。  ";
  assert.deepEqual(map({ prompt }).body, { prompt, duration: "auto" });
  assert.equal(map({ prompt, reference_images: [media("a")] }).body.prompt, prompt);
});

test("番号の本数超え・0・負数・非整数は日本語 / provider 記法とも拒否する", () => {
  for (const prompt of ["@画像2", "@画像0", "@画像-1", "@画像1.5", "@動画1", "@音声1", "@Image2", "@Video0", "@Audio-1"]) {
    let resolves = 0;
    const result = adapter.map({ prompt, reference_images: [media("a")] }, {}, {
      resolveMedia() { resolves += 1; throw new Error("must not resolve"); },
    });
    assert.equal(result.ok, false, prompt);
    assert.ok(result.rejected.some((entry) => entry.slot === "prompt"), prompt);
    assert.equal(resolves, 0);
    assert.equal(Object.hasOwn(result, "body"), false);
  }
});

test("参照の上限・配列型・path 不在と未知のキーを fail closed で拒否する", () => {
  for (const slot of ["reference_images", "reference_videos", "reference_audios"]) {
    for (const value of ["bad", {}, [null], [{}], Array.from({ length: MAP[slot].max + 1 }, () => media("a"))]) {
      const result = map({ reference_images: [media("a")], [slot]: value });
      assert.equal(result.ok, false, `${slot}: ${JSON.stringify(value)}`);
      assert.equal(Object.hasOwn(result, "body"), false);
    }
  }
  assert.equal(map({ unknown: true }).ok, false);
  assert.equal(map({}, { fps: 24 }).ok, false);
  assert.equal(map({ reference_images: Array(9).fill(media("a")), reference_videos: Array(3).fill(media("b")), reference_audios: [media("c")] }).ok, false);
  assert.equal(map({ reference_audios: [media("c")] }).ok, false);
});

test("不正な出力ノブ・extra・camera を拒否する", () => {
  for (const output of [{ duration_s: 3 }, { duration_s: 16 }, { duration_s: 4.5 }, { resolution: "2K" }, { aspect: "adaptive" }, { audio_out: "true" }]) {
    assert.equal(map({}, output).ok, false);
  }
  for (const inputs of [{ extra: { seed: 1 } }, { extra: { bitrate_mode: "bad" } }, { extra: { end_user_id: 42 } }, { camera: { notation: "trajectory", value: "x" } }, { prompt: "" }]) {
    assert.equal(map(inputs).ok, false);
  }
});

test("取得済み OpenAPI は指定 SHA-256 と同一 / H3 記法の不一致を保持する", () => {
  for (const [name, sha] of [
    ["bytedance_seedance-2.0_reference-to-video", "7ea18e4b80cbcabdb015f43c1ce83bce6ddcb7e1868f0a93d863169ddcea24dd"],
    ["minimax_h3_reference-to-video", "e4daee0d35bfa8f8e486efaccec463898896dc245a11ed3d9c1bb880215b22f3"],
  ]) assert.equal(createHash("sha256").update(fixture(name)).digest("hex"), sha);
  const h3 = JSON.parse(fixture("minimax_h3_reference-to-video")).components.schemas.H3ReferenceToVideoInput;
  assert.match(h3.properties.prompt.description, /Image 1, Image 2, Video 1, Audio 1/u);
  assert.equal(getAdapter("fal:h3-ref"), undefined);
});
