import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";

import { getAdapter } from "../../src/adapters/index.mjs";
import { createMediaResolver } from "../../src/cli/media-ref.mjs";
import { runVideoCommand } from "../../src/cli/video.mjs";

let originalFetch;
let networkCalls = 0;
before(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { networkCalls += 1; throw new Error("real fetch forbidden"); };
});
after(() => { globalThis.fetch = originalFetch; assert.equal(networkCalls, 0); });
const FIXTURE = fileURLToPath(new URL("../fixtures/cli-video/", import.meta.url));
const json = (body) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
const inputs = (prompt = "@画像2 の人物が @動画1 の動きで歩く") => ({
  prompt,
  reference_images: [{ path: "assets/stills/start.png" }, { path: "assets/stills/other.png" }],
  reference_videos: [{ path: "assets/generated/done.mp4" }],
});

async function run(t, raw, { model = "fal:h3-ref", next = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "akari-h3-ref-test-"));
  await cp(FIXTURE, root, { recursive: true });
  t.after(async () => {
    await new Promise((resolve) => setTimeout(resolve, 550));
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const payload = { model: { id: model }, inputs: raw, output: {
    duration_s: 6, resolution: model === "fal:h3-ref" ? "768P" : "720p",
  } };
  if (next) await writeFile(path.join(root, "assets/stills/start.png.meta.json"), JSON.stringify({
    version: 1, kind: "still", status: "done", next: { kind: "video", status: "planned", ...payload },
  }));
  const requests = [];
  const logs = [];
  const result = await runVideoCommand([root, "--item", "clip-a", "--yes", ...(next ? [] : ["--inputs", JSON.stringify(payload)])], {
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : null });
      if (url === `https://queue.fal.run/${getAdapter(model).endpoint}` && init?.method === "POST") {
        return json({ request_id: "h3-ref-test", status_url: "https://queue.fal.run/fake/status", response_url: "https://queue.fal.run/fake/response" });
      }
      if (url === "https://queue.fal.run/fake/status?logs=1") return json({ status: "COMPLETED" });
      if (url === "https://queue.fal.run/fake/response") return json({ video: { url: "https://queue.fal.run/fake/video.mp4" } });
      if (url === "https://queue.fal.run/fake/video.mp4") return new Response(await readFile(path.join(FIXTURE, "assets/generated/done.mp4")));
      throw new Error(`unexpected fake URL: ${url}`);
    },
    pollIntervalMs: 0, resolveFalKeyImpl: () => ({ key: "fake-key", key_source: "env:FAL_KEY" }),
    snapshotImpl: async () => {}, probeImpl: () => ({ duration_s_actual: 6, has_audio: false }),
    log: (line) => logs.push(line), errorLog: (line) => logs.push(line),
  });
  return { result, requests, logs, root };
}

for (const next of [false, true]) {
  test(`H3 ${next ? "next" : "--inputs"}: 偽fetchのbodyは画像2+動画1を配列順で写し日本語札を置換`, async (t) => {
    const raw = inputs();
    const value = await run(t, raw, { next });
    assert.equal(value.result.exitCode, 0, value.logs.join("\n"));
    assert.deepEqual(value.requests.map(({ method }) => method), ["POST", "GET", "GET", "GET"]);
    const body = value.requests[0].body;
    const resolveMedia = createMediaResolver(value.root);
    assert.deepEqual(body, {
      prompt: "Image 2 の人物が Video 1 の動きで歩く", duration: 6, resolution: "768P",
      reference_image_urls: raw.reference_images.map(resolveMedia),
      reference_video_urls: raw.reference_videos.map(resolveMedia),
    });
  });
}

for (const prompt of ["@画像3", "@画像0", "@画像-1", "@画像1.5", "@動画2", "@音声1"]) {
  test(`H3 ${prompt}: 参照番号エラーで偽fetchも0回`, async (t) => {
    const value = await run(t, inputs(prompt));
    assert.equal(value.result.exitCode, 1);
    assert.match(value.logs.join("\n"), /参照番号/u);
    assert.equal(value.requests.length, 0);
  });
}

for (const model of ["fal:h3-ref", "fal:seedance-2.0-ref"]) {
  test(`${model}: Image 1 of 3 は参照なしでも偽fetchまで届く`, async (t) => {
    const value = await run(t, { prompt: "Image 1 of 3" }, { model });
    assert.equal(value.result.exitCode, 0, value.logs.join("\n"));
    assert.equal(value.requests[0].body.prompt, "Image 1 of 3");
    assert.equal(value.requests[0].method, "POST");
  });
}

for (const slot of ["first_frame", "last_frame"]) {
  test(`H3 ${slot}: 明示入力は偽fetch0回で拒否`, async (t) => {
    const value = await run(t, { ...inputs(), [slot]: { path: "assets/stills/start.png" } });
    assert.equal(value.result.exitCode, 1);
    assert.equal(value.requests.length, 0);
  });
}
