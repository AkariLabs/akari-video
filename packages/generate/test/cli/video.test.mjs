import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { resolveFfprobe } from "../../../media-bin/src/index.mjs";
import { loadCatalog } from "../../src/cli/catalog.mjs";
import { runVideoCommand } from "../../src/cli/video.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");
const FIXTURE = path.join(HERE, "../fixtures/cli-video");
const VALIDATOR = path.join(REPO, "packages/schemas/bin/validate-generation-meta.mjs");
const DONE_MP4 = path.join(FIXTURE, "assets/generated/done.mp4");

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "akari-video-cli-"));
  await cp(FIXTURE, root, { recursive: true });
  await rm(path.join(root, "assets/generated/done.mp4"));
  t.after(async () => {
    await new Promise((resolve) => setTimeout(resolve, 550));
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return root;
}

const key = () => ({ key: "test-secret-never-print", key_source: "env:FAL_KEY" });
const baseArgs = (root) => [root, "--item", "clip-a", "--prompt", "人物が庭へ歩く", "--resolution", "768P"];

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

test("--dry-run は fetch も meta/edit 書き込みもせず、非 JSON の見積を 1 回だけ出す", async (t) => {
  const root = await fixture(t);
  const before = await readFile(path.join(root, "edit.json"), "utf8");
  let fetches = 0;
  const logs = [];
  const result = await runVideoCommand([...baseArgs(root), "--dry-run"], {
    fetchImpl: async () => { fetches += 1; throw new Error("network must not run"); },
    log: (line) => logs.push(line), errorLog: (line) => logs.push(line),
  });
  assert.equal(result.exitCode, 0);
  assert.equal(fetches, 0);
  assert.equal(await readFile(path.join(root, "edit.json"), "utf8"), before);
  assert.deepEqual(await readdir(path.join(root, "assets/generated")), []);
  assert.match(logs.at(-1), /minimax\/h3\/image-to-video/u);
  assert.match(logs.at(-1), /<data:image\/png;base64 … \d+ bytes>/u);
  assert.equal((logs.join("\n").match(/見積 \$0\.36・as_of 2026-09-12/gu) ?? []).length, 1);
});

test("非 TTY で --yes が無ければ費用承認 exit 2", async (t) => {
  const root = await fixture(t);
  let fetches = 0;
  const errors = [];
  const result = await runVideoCommand(baseArgs(root), {
    input: { isTTY: false }, output: { isTTY: false },
    fetchImpl: async () => { fetches += 1; throw new Error("network must not run"); },
    log: () => {}, errorLog: (line) => errors.push(line),
  });
  assert.equal(result.exitCode, 2);
  assert.equal(fetches, 0);
  assert.match(errors.join("\n"), /費用承認が必要です.*--yes/u);
});

test("価格 null は見積不可を表示し、--yes を要求する", async (t) => {
  const root = await fixture(t);
  const catalog = structuredClone(await loadCatalog());
  catalog.models.find((model) => model.id === "fal:h3-i2v").price = null;
  const output = [];
  let fetches = 0;
  const result = await runVideoCommand(baseArgs(root), {
    loadCatalogImpl: async () => catalog,
    input: { isTTY: false }, output: { isTTY: false },
    fetchImpl: async () => { fetches += 1; throw new Error("network must not run"); },
    log: (line) => output.push(line), errorLog: (line) => output.push(line),
  });
  assert.equal(result.exitCode, 2);
  assert.equal(fetches, 0);
  assert.match(output.join("\n"), /見積不可（価格の記録がありません）/u);
  assert.match(output.join("\n"), /費用承認が必要です/u);

  const dryOutput = [];
  const dryResult = await runVideoCommand([...baseArgs(root), "--dry-run"], {
    loadCatalogImpl: async () => catalog,
    fetchImpl: async () => { fetches += 1; throw new Error("network must not run"); },
    log: (line) => dryOutput.push(line), errorLog: (line) => dryOutput.push(line),
  });
  assert.equal(dryResult.exitCode, 0);
  assert.equal(fetches, 0);
  assert.equal((dryOutput.join("\n").match(/見積不可（価格の記録がありません）/gu) ?? []).length, 1);
});

let ffprobe = null;
try { ffprobe = resolveFfprobe({ env: process.env }); } catch { /* skip below */ }

test("正常系: queue 完了後に meta done と item 差し替えを 1 snapshot で行う", { skip: ffprobe ? false : "ffprobe が見つかりません" }, async (t) => {
  const root = await fixture(t);
  const before = JSON.parse(await readFile(path.join(root, "edit.json"), "utf8"));
  const mp4 = await readFile(DONE_MP4);
  let fetches = 0;
  let snapshots = 0;
  const fetchImpl = async (url, init) => {
    fetches += 1;
    if (String(url).startsWith("https://queue.fal.run/minimax/h3/image-to-video") && init?.method === "POST") {
      return jsonResponse({ request_id: "req-1", status_url: "https://fake/status", response_url: "https://fake/response" });
    }
    if (String(url).startsWith("https://fake/status")) {
      return jsonResponse(fetches === 2 ? { status: "IN_QUEUE" } : { status: "COMPLETED" });
    }
    if (url === "https://fake/response") return jsonResponse({ video: { url: "https://fake/video.mp4" }, expanded_prompt: "expanded" });
    if (url === "https://fake/video.mp4") return new Response(mp4, { status: 200 });
    throw new Error(`unexpected fake URL ${url}`);
  };
  const result = await runVideoCommand([...baseArgs(root), "--yes", "--json"], {
    fetchImpl, pollIntervalMs: 0, resolveFalKeyImpl: key,
    snapshotImpl: async () => { snapshots += 1; },
    log: () => {}, errorLog: () => {},
  });
  assert.equal(result.exitCode, 0);
  assert.equal(fetches, 5);
  assert.equal(snapshots, 1);
  const after = JSON.parse(await readFile(path.join(root, "edit.json"), "utf8"));
  assert.deepEqual(after.tracks[0].items[1], before.tracks[0].items[1]);
  assert.equal(after.tracks[0].items[0].id, before.tracks[0].items[0].id);
  assert.equal(after.tracks[0].items[0].at, before.tracks[0].items[0].at);
  assert.equal(after.tracks[0].items[0].duration, before.tracks[0].items[0].duration);
  assert.equal(after.tracks[0].items[0].source.src, "gen-clip-a-video");
  assert.equal(after.tracks[0].items[0].source.mute, true);
  assert.deepEqual(after.tracks[0].items[0].source.framing, before.tracks[0].items[0].source.framing);
  assert.deepEqual(after.tracks[0].items[0].source.transition_out, before.tracks[0].items[0].source.transition_out);
  assert.deepEqual(after.tracks[0].items[0].source.fx, before.tracks[0].items[0].source.fx);
  assert.equal(after.sources.length, before.sources.length + 1);
  assert.deepEqual(after.sources.at(-1), { id: "gen-clip-a-video", path: "assets/generated/clip-a.mp4", proxy: null });
  const metaPath = path.join(root, "assets/generated/clip-a.mp4.meta.json");
  const meta = JSON.parse(await readFile(metaPath, "utf8"));
  assert.equal(meta.status, "done");
  assert.equal(meta.provenance.key_source, "env:FAL_KEY");
  assert.equal(meta.result.expanded_prompt, "expanded");
  assert.equal(Object.hasOwn(meta.result, "provider_file"), false);
  assert.equal(spawnSync(process.execPath, [VALIDATOR, metaPath]).status, 0);
});

test("FAILED は meta failed にし edit.json を変更しない", async (t) => {
  const root = await fixture(t);
  const before = await readFile(path.join(root, "edit.json"), "utf8");
  let fetches = 0;
  const fetchImpl = async (url, init) => {
    fetches += 1;
    if (init?.method === "POST") return jsonResponse({ request_id: "req-fail", status_url: "https://fake/status", response_url: "https://fake/response" });
    return jsonResponse({ status: "FAILED", error: "provider error" });
  };
  const result = await runVideoCommand([...baseArgs(root), "--yes"], {
    fetchImpl, pollIntervalMs: 0, resolveFalKeyImpl: key, log: () => {}, errorLog: () => {},
  });
  assert.equal(result.exitCode, 1);
  assert.equal(fetches, 2);
  assert.equal(await readFile(path.join(root, "edit.json"), "utf8"), before);
  const metaPath = path.join(root, "assets/generated/clip-a.mp4.meta.json");
  const meta = JSON.parse(await readFile(metaPath, "utf8"));
  assert.equal(meta.status, "failed");
  assert.match(meta.history.at(-1).reason, /provider error/u);
  assert.equal(spawnSync(process.execPath, [VALIDATOR, metaPath]).status, 0);
});
