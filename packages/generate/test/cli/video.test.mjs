import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { resolveFfprobe } from "../../../media-bin/src/index.mjs";
import { loadCatalog } from "../../src/cli/catalog.mjs";
import { makeReference } from "../../src/cli/media-ref.mjs";
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
      return jsonResponse({ request_id: "req-1", status_url: "https://queue.fal.run/fake/status", response_url: "https://queue.fal.run/fake/response" });
    }
    if (String(url).startsWith("https://queue.fal.run/fake/status")) {
      return jsonResponse(fetches === 2 ? { status: "IN_QUEUE" } : { status: "COMPLETED" });
    }
    if (url === "https://queue.fal.run/fake/response") return jsonResponse({ video: { url: "https://queue.fal.run/fake/video.mp4" }, expanded_prompt: "expanded" });
    if (url === "https://queue.fal.run/fake/video.mp4") return new Response(mp4, { status: 200 });
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
    if (init?.method === "POST") return jsonResponse({ request_id: "req-fail", status_url: "https://queue.fal.run/fake/status", response_url: "https://queue.fal.run/fake/response" });
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

for (const selection of ["frames", "references"]) {
  test(`--item は next (${selection}) から生成し placeholder を保持する`, async (t) => {
    const root = await fixture(t);
    const sourcePath = "assets/stills/start.png";
    const sourceMetaPath = path.join(root, `${sourcePath}.meta.json`);
    const draft = {
      kind: "video", status: "planned", model: { id: "fal:h3-i2v" },
      inputs: {
        prompt: "下書きの動き", first_frame: { path: "assets/stills/other.png" },
        last_frame: { path: "assets/stills/other.png" }, frames_or_refs: selection,
        // 非選択側をファイル読込前に落とす。保存済みの下書きはそのまま。
        reference_images: selection === "frames" ? [{ path: "missing-unused.png" }] : [],
        reference_videos: [], reference_audios: [],
      },
      output: { duration_s: 6, resolution: "768P" }, updated_at: "2026-09-21T10:00:00.000Z",
    };
    if (selection === "references") {
      draft.inputs.first_frame = { path: "missing-first.png" };
      draft.inputs.last_frame = { path: "missing-last.png" };
    }
    const original = JSON.stringify({ version: 1, kind: "still", status: "done", next: draft });
    await writeFile(sourceMetaPath, original);
    let sentBody;
    let generatingMeta;
    const logs = [];
    const fetchImpl = async (url, init) => {
      if (init?.method === "POST") {
        sentBody = JSON.parse(init.body);
        return jsonResponse({ request_id: "req-next", status_url: "https://queue.fal.run/fake/status", response_url: "https://queue.fal.run/fake/response" });
      }
      if (String(url).includes("/status")) {
        generatingMeta = JSON.parse(await readFile(path.join(root, "assets/generated/clip-a.mp4.meta.json"), "utf8"));
        return jsonResponse({ status: "COMPLETED" });
      }
      if (String(url).endsWith("/response")) return jsonResponse({ video: { url: "https://queue.fal.run/fake/video.mp4" } });
      if (String(url).endsWith("/video.mp4")) return new Response(await readFile(DONE_MP4));
      throw new Error(`unexpected fake URL ${url}`);
    };
    const result = await runVideoCommand([root, "--item", "clip-a", "--yes"], {
      fetchImpl, pollIntervalMs: 0, resolveFalKeyImpl: key,
      snapshotImpl: async () => {}, probeImpl: () => ({ duration_s_actual: 6, has_audio: false }),
      log: (line) => logs.push(line), errorLog: (line) => logs.push(line),
    });
    assert.equal(result.exitCode, 0, logs.join("\n"));
    assert.equal(sentBody.prompt, draft.inputs.prompt);
    assert.equal(sentBody.duration, 6);
    assert.equal(Object.hasOwn(sentBody, "image_url"), selection === "frames");
    assert.equal(Object.hasOwn(sentBody, "end_image_url"), selection === "frames");
    const reference = makeReference(root, sourcePath);
    assert.deepEqual(generatingMeta.placeholder, { path: sourcePath, sha256: reference.sha256, item_id: "clip-a" });
    assert.equal(Object.hasOwn(generatingMeta.inputs, "frames_or_refs"), false);
    assert.deepEqual(generatingMeta.inputs.reference_images, []);
    if (selection === "references") {
      assert.equal(generatingMeta.inputs.first_frame, null);
      assert.equal(generatingMeta.inputs.last_frame, null);
    } else {
      assert.equal(generatingMeta.inputs.first_frame.path, "assets/stills/other.png");
    }
    const metaPath = path.join(root, result.result.meta);
    const done = JSON.parse(await readFile(metaPath, "utf8"));
    assert.deepEqual(done.placeholder, generatingMeta.placeholder);
    assert.equal(Object.hasOwn(done.inputs, "frames_or_refs"), false);
    assert.equal(spawnSync(process.execPath, [VALIDATOR, metaPath]).status, 0);
    assert.equal(await readFile(sourceMetaPath, "utf8"), original);
  });
}

test("--inputs は next より優先する", async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, "assets/stills/start.png.meta.json"), JSON.stringify({
    next: { kind: "video", status: "planned", model: { id: "missing-model" }, inputs: { prompt: "不使用", first_frame: { path: "missing.png" } } },
  }));
  const logs = [];
  const result = await runVideoCommand([root, "--item", "clip-a", "--inputs", JSON.stringify({
    inputs: { prompt: "明示入力", first_frame: null }, output: { duration_s: 6, resolution: "768P" },
  }), "--dry-run"], { log: (line) => logs.push(line), errorLog: (line) => logs.push(line), fetchImpl: () => { throw new Error("network must not run"); } });
  assert.equal(result.exitCode, 0, logs.join("\n"));
  assert.equal(result.result.body.prompt, "明示入力");
  assert.equal(Object.hasOwn(result.result.body, "image_url"), false);
});

test('生成失敗でも placeholder を残し、next の入力と元クリップを保持する', async (t) => {
  const root = await fixture(t);
  const sidecarPath = path.join(root, 'assets/stills/start.png.meta.json');
  const original = JSON.stringify({ next: {
    kind: 'video', status: 'planned', model: { id: 'fal:h3-i2v' },
    inputs: { prompt: '動く', first_frame: null, last_frame: null, frames_or_refs: 'frames' },
    output: { duration_s: 6, resolution: '768P' },
  } });
  await writeFile(sidecarPath, original);
  const before = await readFile(path.join(root, 'edit.json'), 'utf8');
  const result = await runVideoCommand([root, '--item', 'clip-a', '--yes'], {
    fetchImpl: async (_url, init) => init?.method === 'POST'
      ? jsonResponse({ request_id: 'req-failed-next', status_url: 'https://queue.fal.run/fake/status', response_url: 'https://queue.fal.run/fake/response' })
      : jsonResponse({ status: 'FAILED', error: 'テスト用の失敗' }),
    pollIntervalMs: 0, resolveFalKeyImpl: key, log: () => {}, errorLog: () => {},
  });
  assert.equal(result.exitCode, 1);
  const meta = JSON.parse(await readFile(path.join(root, 'assets/generated/clip-a.mp4.meta.json'), 'utf8'));
  assert.equal(meta.status, 'failed');
  assert.deepEqual(meta.placeholder, {
    path: 'assets/stills/start.png', sha256: makeReference(root, 'assets/stills/start.png').sha256, item_id: 'clip-a',
  });
  assert.equal(meta.inputs.first_frame, null);
  assert.equal(Object.hasOwn(meta.inputs, 'frames_or_refs'), false);
  assert.equal(await readFile(sidecarPath, 'utf8'), original);
  assert.equal(await readFile(path.join(root, 'edit.json'), 'utf8'), before);
});
