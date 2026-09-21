import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rm, truncate, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";

import { resolveFfmpeg, resolveFfprobe } from "../../../media-bin/src/index.mjs";
import { adapter } from "../../src/adapters/fal-seedance-2-ref.mjs";
import { createMediaResolver, MAX_INLINE_BYTES } from "../../src/cli/media-ref.mjs";
import { runVideoCommand } from "../../src/cli/video.mjs";

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
  assert.deepEqual(unexpectedFetchUrls, [], "all fetches must use the injected fake");
});

const FIXTURE = fileURLToPath(new URL("../fixtures/cli-video/", import.meta.url));
const clipTemps = async () => (await readdir(os.tmpdir()))
  .filter((name) => name.startsWith("akari-gen-reference-audio-")).sort();

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "akari-ref-video-test-"));
  await cp(FIXTURE, root, { recursive: true });
  t.after(async () => {
    // edit-store closes its file watcher after the final save.
    await new Promise((resolve) => setTimeout(resolve, 550));
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return root;
}

const inputs = (prompt = "@画像2 の人物が @動画1 の動きで歩く") => ({
  prompt,
  reference_images: [{ path: "assets/stills/start.png" }, { path: "assets/stills/other.png" }],
  reference_videos: [{ path: "assets/generated/done.mp4" }],
});
const payload = (raw, model = adapter.id) => ({
  model: { id: model }, inputs: raw,
  output: { duration_s: 6, resolution: model === "fal:h3-ref" ? "768P" : "720p" },
});
const jsonResponse = (value) => new Response(JSON.stringify(value), {
  headers: { "content-type": "application/json" },
});

async function run(root, raw, { model = adapter.id, next = false } = {}) {
  const requests = [];
  const logs = [];
  const supplied = payload(raw, model);
  if (next) {
    await writeFile(path.join(root, "assets/stills/start.png.meta.json"), JSON.stringify({
      version: 1, kind: "still", status: "done", next: { kind: "video", status: "planned", ...supplied },
    }));
  }
  const fakeFetch = async (url, init) => {
    requests.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : null });
    if (url === `https://queue.fal.run/${adapter.endpoint}` && init?.method === "POST") {
      return jsonResponse({ request_id: "ref-test", status_url: "https://queue.fal.run/fake/status", response_url: "https://queue.fal.run/fake/response" });
    }
    if (url === "https://queue.fal.run/fake/status?logs=1") return jsonResponse({ status: "COMPLETED" });
    if (url === "https://queue.fal.run/fake/response") return jsonResponse({ video: { url: "https://queue.fal.run/fake/video.mp4" } });
    if (url === "https://queue.fal.run/fake/video.mp4") return new Response(await readFile(path.join(FIXTURE, "assets/generated/done.mp4")));
    throw new Error(`unexpected fake URL: ${url}`);
  };
  const result = await runVideoCommand([root, "--item", "clip-a", "--yes",
    ...(next ? [] : ["--inputs", JSON.stringify(supplied)])], {
    fetchImpl: fakeFetch, pollIntervalMs: 0,
    resolveFalKeyImpl: () => ({ key: "fake-key", key_source: "env:FAL_KEY" }),
    snapshotImpl: async () => {}, probeImpl: () => ({ duration_s_actual: 6, has_audio: false }),
    log: (line) => logs.push(line), errorLog: (line) => logs.push(line),
  });
  return { result, requests, logs };
}

function assertSuccess(value) {
  assert.equal(value.result.exitCode, 0, value.logs.join("\n"));
  assert.deepEqual(value.requests.map(({ url, method }) => ({ url, method })), [
    { url: `https://queue.fal.run/${adapter.endpoint}`, method: "POST" },
    { url: "https://queue.fal.run/fake/status?logs=1", method: "GET" },
    { url: "https://queue.fal.run/fake/response", method: "GET" },
    { url: "https://queue.fal.run/fake/video.mp4", method: "GET" },
  ]);
}

for (const next of [false, true]) {
  test(`${next ? "next" : "--inputs"}: 偽 fetch の body に画像2枚・動画1本を順序どおり送りタグを置換する`, async (t) => {
    const root = await fixture(t);
    const raw = inputs();
    if (next) Object.assign(raw, {
      frames_or_refs: "references", first_frame: { path: "missing-unused.png" }, last_frame: { path: "missing-unused.png" },
    });
    const value = await run(root, raw, { next });
    assertSuccess(value);
    const body = value.requests[0].body;
    const resolver = createMediaResolver(root);
    assert.deepEqual(body.image_urls, raw.reference_images.map(resolver));
    assert.deepEqual(body.video_urls, raw.reference_videos.map(resolver));
    assert.equal(body.prompt, "@Image2 の人物が @Video1 の動きで歩く");
    assert.equal(body.duration, "6");
    assert.equal(Object.hasOwn(body, "image_url"), false);
    assert.equal(Object.hasOwn(body, "end_image_url"), false);
  });
}

for (const prompt of ["@画像3", "@画像0", "@画像-1", "@動画2", "@音声1", "@Image3"]) {
  test(`${prompt}: 範囲外タグは fetch 0 回で失敗する`, async (t) => {
    const root = await fixture(t);
    const value = await run(root, inputs(prompt));
    assert.equal(value.result.exitCode, 1);
    assert.match(value.logs.join("\n"), /参照番号/u);
    assert.equal(value.requests.length, 0);
  });
}

test("音声 range_s [2,7]: 送信した data URI は実測5秒、原本・meta は保持、一時ファイルは残らない", async (t) => {
  const root = await fixture(t);
  const audioPath = path.join(root, "reference.wav");
  execFileSync(resolveFfmpeg(), [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-f", "lavfi",
    "-i", "sine=frequency=440:sample_rate=16000:duration=10", "-c:a", "pcm_s16le", audioPath,
  ]);
  const original = await readFile(audioPath);
  const before = await clipTemps();
  const raw = inputs("@画像1 に @音声1 を合わせる");
  raw.reference_audios = [{ path: "reference.wav", range_s: [2, 7] }];
  const value = await run(root, raw);
  assertSuccess(value);
  const body = value.requests[0].body;
  assert.equal(body.prompt, "@Image1 に @Audio1 を合わせる");
  assert.equal(body.audio_urls.length, 1);
  assert.match(body.audio_urls[0], /^data:audio\/wav;base64,/u);
  const sentPath = path.join(root, "sent.wav");
  await writeFile(sentPath, Buffer.from(body.audio_urls[0].split(",")[1], "base64"));
  const duration = Number(execFileSync(resolveFfprobe(), [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", sentPath,
  ], { encoding: "utf8" }).trim());
  assert.ok(Math.abs(duration - 5) <= 0.1, `actual duration: ${duration}`);
  t.diagnostic(`sent audio duration: ${duration} s`);
  assert.deepEqual(await clipTemps(), before);
  assert.deepEqual(await readFile(audioPath), original);
  const meta = JSON.parse(await readFile(path.join(root, value.result.result.meta), "utf8"));
  assert.deepEqual(meta.inputs.reference_audios[0].range_s, [2, 7]);
  assert.equal(meta.inputs.reference_audios[0].path, "reference.wav");
});

test("range_s なし: 音声 data URI は原本のバイト列をそのまま渡す", async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, "reference.mp3"), Buffer.from("untrimmed audio bytes"));
  const raw = inputs("名指しはしない");
  raw.reference_audios = [{ path: "reference.mp3" }];
  const before = await clipTemps();
  const value = await run(root, raw);
  assertSuccess(value);
  assert.equal(value.requests[0].body.prompt, raw.prompt);
  assert.deepEqual(value.requests[0].body.audio_urls, raw.reference_audios.map(createMediaResolver(root)));
  assert.deepEqual(await clipTemps(), before);
});

test("ffmpeg の切り出し失敗時も一時ファイルを削除し fetch 0 回", async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, "broken.wav"), "invalid audio");
  const raw = inputs();
  raw.reference_audios = [{ path: "broken.wav", range_s: [2, 7] }];
  const before = await clipTemps();
  const value = await run(root, raw);
  assert.equal(value.result.exitCode, 1);
  assert.match(value.logs.join("\n"), /reference_audios/u);
  assert.equal(value.requests.length, 0);
  assert.deepEqual(await clipTemps(), before);
});

test("不正な音声 range_s はアダプタ単体でも拒否し一時ファイルを作らない", async (t) => {
  const root = await fixture(t);
  const before = await clipTemps();
  for (const range_s of [[-1, 7], [7, 2], [2, 2], [2, Infinity], [2], "2,7"]) {
    const result = adapter.map({ ...inputs("歩く"), reference_audios: [{ path: "missing.wav", range_s }] }, {}, {
      resolveMedia: createMediaResolver(root),
    });
    assert.equal(result.ok, false);
    assert.match(result.rejected[0].reason, /range_s/u);
  }
  assert.deepEqual(await clipTemps(), before);
});

test("20 MB 超の画像・動画・音声参照は fetch 0 回で拒否する", async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, "oversize.bin"), "");
  await truncate(path.join(root, "oversize.bin"), MAX_INLINE_BYTES + 1);
  for (const slot of ["reference_images", "reference_videos", "reference_audios"]) {
    const value = await run(root, { ...inputs("歩く"), [slot]: [{ path: "oversize.bin" }] });
    assert.equal(value.result.exitCode, 1);
    assert.match(value.logs.join("\n"), /20 MB/u);
    assert.equal(value.requests.length, 0);
  }
});

test("first_frame / last_frame の明示入力は fetch 0 回で拒否する", async (t) => {
  const root = await fixture(t);
  for (const slot of ["first_frame", "last_frame"]) {
    const value = await run(root, { ...inputs(), [slot]: { path: "assets/stills/start.png" } });
    assert.equal(value.result.exitCode, 1);
    assert.equal(value.requests.length, 0);
  }
});

test("BLOCKED の fal:h3-ref はアダプタ未登録のため fetch 0 回で拒否する", async (t) => {
  const root = await fixture(t);
  const value = await run(root, inputs(), { model: "fal:h3-ref" });
  assert.equal(value.result.exitCode, 1);
  assert.match(value.logs.join("\n"), /アダプタがありません: fal:h3-ref/u);
  assert.equal(value.requests.length, 0);
});
