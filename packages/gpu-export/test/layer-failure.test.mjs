import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import vm from "node:vm";

import { runCli } from "../bin/akari-gpu-export.mjs";
import { assertNoSkippedLayers, captureFramesWithGpu, exportWithGpu } from "../src/index.mjs";
import { renderMediaReferencesPath } from "../../osr-export/src/static-server.mjs";

// 実案件で、akari-gpu-export を直接叩くと素材ライブラリの写真 12 層が 404 で黙って抜け、
// run.json の skippedLayers: 750 だけを残して completed になった（render-cut 経由は 0 層）。
// (a) 直接実行も render-cut と同じ媒体表で子を走らせる、(b) 層の欠けた書き出しを成功にしない、の回帰検知。

const LAYER_404 = "image fetch failed (404): /media/assets/still/bg-canvas/bg.png";

async function loadFrameAt(url, marker, endMarker, FE, globals = {}) {
  const source = await readFile(url, "utf8");
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${url}: ${marker.trim()} not found`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, `${url}: method end not found`);
  return vm.runInNewContext(`(class Runtime { ${source.slice(start, end)} }).prototype`, { FE, ...globals });
}

function failingLayerFE(calls) {
  return {
    evaluationPlanFromResolvedTimeline(_timeline, timeUs, _sources, output) {
      return { timeUs, base: [], layers: [{ id: "image-2", kind: "image" }], output };
    },
    // frame-engine の evaluateFrame と同じく、層の準備失敗は onLayerFailure へ渡してから続行しようとする
    async evaluateFrame(_plan, context) {
      calls.push(typeof context.onLayerFailure);
      context.onLayerFailure?.("image-2", new Error(LAYER_404));
      return { surface: "without-layer", close() {} };
    },
  };
}

function runtimeFixture() {
  return {
    timeline: { totalDuration: 6 },
    sources: new Map(),
    output: { width: 320, height: 180 },
    compositor: {},
    metrics: {},
    fps: 30,
    reaper: { reap() { return { liveStreams: 0 }; }, released() { return 0; } },
    canvas: { getContext() { return null; } },
  };
}

test("GPU 書き出しランタイムは層の準備失敗を層 id と原因つきの失敗にする（黙って抜かない）", async () => {
  const calls = [];
  const runtime = await loadFrameAt(
    new URL("../src/page-runtime.js", import.meta.url),
    "    async frameAt(seconds) {",
    "\n    prefetchSummary() {",
    failingLayerFE(calls),
  );
  await assert.rejects(runtime.frameAt.call(runtimeFixture(), 3), (error) => {
    assert.match(error.message, /layer image-2 を描けないため書き出しを中止します/u);
    assert.ok(error.message.includes(LAYER_404), error.message);
    return true;
  });
  assert.deepEqual(calls, ["function"]);
});

test("OSR 書き出しランタイムも層の準備失敗を失敗にする（GPU→OSR へ逃がしても層は抜けない）", async () => {
  const calls = [];
  const runtime = await loadFrameAt(
    new URL("../../osr-export/src/page-runtime.js", import.meta.url),
    "    async renderAt(seconds) {",
    "\n    dispose() {",
    failingLayerFE(calls),
    // renderAt は IIFE の config（media plane の有無）を閉包で読む
    { config: { mediaPlaneSummary: null } },
  );
  await assert.rejects(runtime.renderAt.call(runtimeFixture(), 3),
    /layer image-2 を描けないため書き出しを中止します.*404/u);
  assert.deepEqual(calls, ["function"]);
});

test("skippedLayers が 1 以上の run は親でも成果物として受け取らない", () => {
  assert.doesNotThrow(() => assertNoSkippedLayers({ frameEngineMetrics: { skippedLayers: 0 } }));
  assert.doesNotThrow(() => assertNoSkippedLayers({}));
  assert.throws(() => assertNoSkippedLayers({ frameEngineMetrics: { skippedLayers: 750 } }),
    /skipped 750 layer draw\(s\)/u);
  assert.throws(() => assertNoSkippedLayers({ frameEngineMetrics: { skippedLayers: "many" } }), /skipped many/u);
});

test("GPU export は completed でも skippedLayers が残る run を失敗にし、中間ファイルを残さない", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "gpu-skipped-layers-"));
  const renderDirectory = join(projectRoot, "render");
  const out = join(renderDirectory, "composite.mp4");
  await mkdir(renderDirectory, { recursive: true });
  try {
    let verified = false;
    await assert.rejects(exportWithGpu({
      projectRoot, out, fps: 30, width: 320, height: 180, duration: 1, frames: 30,
      eligibility: { eligible: true, entries: [] },
      launcher: { tier: 2, kind: "npm-electron", executable: "/electron" },
      launcherRunner: async (_launcher, options) => {
        await writeFile(options.out, "encoded-video");
        await writeFile(join(renderDirectory, "run.json"), JSON.stringify({
          status: "completed", gpu: {}, memory: {}, frameEngineMetrics: { skippedLayers: 12 },
        }));
      },
      finalVerifier: async () => { verified = true; return { matched: true, checks: {} }; },
    }), /skipped 12 layer draw\(s\)/u);
    assert.equal(verified, false);
    await assert.rejects(access(out));
    await assert.rejects(access(`${out}.gpu-video.mp4`));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("GPU capture も skippedLayers が残る run を失敗にする", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "gpu-capture-skipped-"));
  const outputDirectory = join(projectRoot, "frames");
  try {
    await assert.rejects(captureFramesWithGpu({
      projectRoot, outputDirectory, frameNumbers: [0], fps: 30, width: 320, height: 180, duration: 1,
      eligibility: { eligible: true, entries: [] },
      launcher: { tier: 2, kind: "npm-electron", executable: "/electron" },
      launcherRunner: async (_launcher, options) => {
        await writeFile(options.out, JSON.stringify({
          status: "completed", operation: "capture", verify: { matched: true }, frameEngineMetrics: { skippedLayers: 1 },
        }));
      },
    }), /skipped 1 layer draw\(s\)/u);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

async function put(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}

test("GPU CLI の直接実行は render-cut と同じ媒体表で子を走らせ、素材ライブラリの静止画を /media/ から配信できる", async (t) => {
  const temp = await mkdtemp(join(tmpdir(), "gpu-cli-library-still-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const projectRoot = join(temp, "project");
  const library = join(temp, "library");
  const still = "assets/still/bg-canvas/bg.png";
  await put(join(projectRoot, "assets", "clip.mp4"), "clip");
  // 静止画はプロジェクト内に実体が無く、参照台帳経由でライブラリへ解決される（実案件と同じ形）
  await put(join(library, "still", "bg-canvas", "bg.png"), "library-png");
  await put(join(projectRoot, ".akari", "asset-references.json"), JSON.stringify({
    version: 0, references: [{ id: "bg-canvas", category: "still" }],
  }));
  await put(join(projectRoot, "edit.json"), JSON.stringify({
    version: 2,
    output: { width: 320, height: 180, fps: 30 },
    sources: [{ id: "clip", path: "assets/clip.mp4" }, { id: "src-1", path: still }],
    tracks: [
      { id: "video", lane: "visual", items: [{ id: "c1", at: 0, duration: 30, source: { kind: "media", src: "clip", in: 0, out: 1 } }] },
      { id: "v1", lane: "visual", items: [{ id: "image-1", at: 0, duration: 30, source: { kind: "media", src: "src-1", in: 0, out: 1 } }] },
    ],
  }));
  const env = { ...process.env, AKARI_HOME: join(temp, "home"), AKARI_LIBRARY_ROOT: library };
  const errors = [];
  let served = null;
  let exportedRoot = null;
  const previousToken = process.env.AKARI_RENDER_MEDIA_REFERENCES_TOKEN;
  const exitCode = await runCli([projectRoot, "--out", join(temp, "out.mp4"), "--duration", "1"], {
    env,
    io: { log() {}, error(message) { errors.push(message); } },
    loadAndBuildGpuPage: async () => ({ eligibility: { eligible: true, entries: [] } }),
    resolveGpuRuntimeOptions: () => ({}),
    exportWithGpu: async (options) => {
      exportedRoot = options.projectRoot;
      // Electron と同じ「直接の子プロセス」から、引数なしで媒体表を引けることを確かめる
      const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
        import { createStaticRequestHandler } from ${JSON.stringify(new URL("../../osr-export/src/static-server.mjs", import.meta.url).href)};
        import { Writable } from 'node:stream';
        import { once } from 'node:events';
        const chunks = [];
        const response = new Writable({ write(chunk, encoding, callback) { chunks.push(chunk); callback(); } });
        response.setHeader = () => {};
        response.writeHead = status => { response.statusCode = status; };
        const finished = once(response, 'finish');
        await createStaticRequestHandler({ projectRoot: ${JSON.stringify(options.projectRoot)}, pageHtml: '', overlaySheetHtml: '' })(
          { url: '/media/${still}', headers: {} }, response);
        await finished;
        if (response.statusCode !== 200) throw new Error('status ' + response.statusCode);
        process.stdout.write(Buffer.concat(chunks));
      `], { encoding: "utf8", env: process.env });
      assert.equal(child.status, 0, child.stderr);
      served = child.stdout;
    },
  });
  assert.equal(exitCode, 0, errors.join("\n"));
  assert.equal(served, "library-png");
  assert.equal(exportedRoot, projectRoot);
  // 表は子の終了後に必ず消す（render-cut と同じ寿命）
  await assert.rejects(access(renderMediaReferencesPath(projectRoot, process.pid)));
  assert.equal(process.env.AKARI_RENDER_MEDIA_REFERENCES_TOKEN, previousToken);
});
