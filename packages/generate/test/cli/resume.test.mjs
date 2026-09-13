import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadCatalog, findModel } from "../../src/cli/catalog.mjs";
import { makeReference } from "../../src/cli/media-ref.mjs";
import { writeGenerating } from "../../src/cli/meta-video.mjs";
import { runResumeCommand } from "../../src/cli/resume.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");
const FIXTURE = path.join(HERE, "../fixtures/cli-video");
const DONE_MP4 = path.join(FIXTURE, "assets/generated/done.mp4");
const VALIDATOR = path.join(REPO, "packages/schemas/bin/validate-generation-meta.mjs");

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "akari-resume-cli-"));
  await cp(FIXTURE, root, { recursive: true });
  await rm(path.join(root, "assets/generated/done.mp4"));
  t.after(async () => {
    await new Promise((resolve) => setTimeout(resolve, 550));
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return root;
}

async function generating(root, startedAt) {
  const catalog = await loadCatalog();
  const model = findModel(catalog, "fal:h3-i2v");
  const metaPath = path.join(root, "assets/generated/clip-a.mp4.meta.json");
  writeGenerating({
    metaPath,
    model,
    inputs: {
      prompt: "人物が庭へ歩く", negative_prompt: null,
      first_frame: makeReference(root, "assets/stills/start.png", { source_id: "still" }),
      last_frame: null, reference_images: [], reference_videos: [], reference_audios: [],
      source_video: null, mode: null, camera: null, seed: null, extra: {},
    },
    output: { duration_s: 6, resolution: "768P", aspect: null, audio_out: true },
    cost: { estimate_usd: 0.36, as_of: "2026-09-12", source: "estimate" },
    key_source: "env:FAL_KEY", request_id: "req-resume",
    status_url: "https://fake/status", response_url: "https://fake/response",
    started_at: startedAt, stale_after_s: 900,
  });
  return metaPath;
}

const key = () => ({ key: "resume-test-secret", key_source: "env:FAL_KEY" });
const jsonResponse = (value) => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });

test("resume: COMPLETED を done にして同じ item へ差し替える", async (t) => {
  const root = await fixture(t);
  const metaPath = await generating(root, "2026-09-13T09:30:00.000Z");
  const mp4 = await readFile(DONE_MP4);
  let fetches = 0;
  let snapshots = 0;
  const logs = [];
  const fetchImpl = async (url) => {
    fetches += 1;
    if (String(url).startsWith("https://fake/status")) return jsonResponse({ status: "COMPLETED" });
    if (url === "https://fake/response") return jsonResponse({ video: { url: "https://fake/video.mp4" }, expanded_prompt: "resume expanded" });
    if (url === "https://fake/video.mp4") return new Response(mp4, { status: 200 });
    throw new Error(`unexpected fake URL ${url}`);
  };
  const result = await runResumeCommand([root, "--item", "clip-a"], {
    fetchImpl, resolveFalKeyImpl: key,
    now: () => new Date("2026-09-13T09:32:00.000Z"),
    probeImpl: () => ({ duration_s_actual: 6.592, width: 64, height: 64, fps: "30/1", has_audio: false }),
    snapshotImpl: async () => { snapshots += 1; }, log: (line) => logs.push(line), errorLog: () => {},
  });
  assert.equal(result.exitCode, 0);
  assert.equal(fetches, 3);
  assert.equal(snapshots, 1);
  const meta = JSON.parse(await readFile(metaPath, "utf8"));
  assert.equal(meta.status, "done");
  assert.equal(meta.result.duration_s_actual, 6.592);
  assert.equal(meta.result.expanded_prompt, "resume expanded");
  assert.equal(spawnSync(process.execPath, [VALIDATOR, metaPath]).status, 0);
  const edit = JSON.parse(await readFile(path.join(root, "edit.json"), "utf8"));
  assert.equal(edit.tracks[0].items[0].source.src, "gen-clip-a-video");
  assert.equal(edit.tracks[0].items[0].source.out, 6);
  assert.equal(edit.tracks[0].items[0].source.freeze, null);
  assert.deepEqual(logs, ["clip-a: 生成動画に差し替えました: assets/generated/clip-a.mp4（out 6・freeze なし）"]);
});

test("resume: stale でも 1 回再取得し、応答なし表示のまま generating を保持する", async (t) => {
  const root = await fixture(t);
  const metaPath = await generating(root, "2026-09-13T07:30:00.000Z");
  let fetches = 0;
  const logs = [];
  const result = await runResumeCommand([root, "--item", "clip-a"], {
    fetchImpl: async () => { fetches += 1; return jsonResponse({ status: "IN_PROGRESS" }); },
    resolveFalKeyImpl: key,
    now: () => new Date("2026-09-13T09:30:00.000Z"),
    log: (line) => logs.push(line), errorLog: (line) => logs.push(line),
  });
  assert.equal(result.exitCode, 0);
  assert.equal(fetches, 1);
  assert.match(logs.join("\n"), /応答なし/u);
  assert.equal(JSON.parse(await readFile(metaPath, "utf8")).status, "generating");

  const failed = await runResumeCommand([root, "--item", "clip-a"], {
    fetchImpl: async () => { fetches += 1; return jsonResponse({ status: "FAILED", error: "provider error" }); },
    resolveFalKeyImpl: key,
    now: () => new Date("2026-09-13T09:30:00.000Z"),
    log: (line) => logs.push(line), errorLog: (line) => logs.push(line),
  });
  assert.equal(failed.exitCode, 1);
  assert.equal(fetches, 2);
  assert.equal(logs.at(-1), "clip-a: 失敗: provider error");
  assert.equal(JSON.parse(await readFile(metaPath, "utf8")).status, "failed");
});
