import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// page-runtime.js はブラウザ用 IIFE（inline 前提・import 不可）なので、出口の素材選択の本体だけを
// 切り出して node:vm で評価する（runtime-cuts.test.mjs と同じ方式）。判定そのものは生成バンドルの
// frame-engine（chooseSource / needsCodecProbe = 正本 packages/frame-engine/src/decode/source-selection.ts）
// を実物のまま使い、ネットワークに出る probeSourceCodec だけ差し替える。
// 契約: tasks/2026-09-03-export-original-source（出口は既定で原本を読む）。
async function loadSelection(url) {
  const source = await readFile(url, "utf8");
  const start = source.indexOf("  function exportSourceMode(value) {");
  assert.ok(start >= 0, `${url}: exportSourceMode not found`);
  const bodyStart = source.indexOf("  async function resolveSourceSelections(sources, options) {", start);
  assert.ok(bodyStart > start, `${url}: resolveSourceSelections not found`);
  const end = source.indexOf("\n  }\n", bodyStart);
  assert.ok(end > bodyStart, `${url}: resolveSourceSelections end not found`);
  const body = source.slice(start, end + "\n  }\n".length);
  // 現実行レルムで評価する（vm の別レルムだと Map / Object の同一性が崩れて deepEqual が通らない）。
  return vm.runInThisContext(`(function () {\n${body}\nreturn { exportSourceMode, declaredSources, resolveSourceSelections };\n})()`);
}

async function loadFrameEngine(url) {
  const source = await readFile(url, "utf8");
  const context = { console, setTimeout, clearTimeout, queueMicrotask, TextDecoder, TextEncoder, URL, performance };
  context.globalThis = context;
  context.self = context;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.AkariFrameEngine;
}

const RUNTIMES = [
  ["gpu-export", new URL("../src/page-runtime.js", import.meta.url), new URL("../generated/frame-engine.js", import.meta.url)],
  ["osr-export", new URL("../../osr-export/src/page-runtime.js", import.meta.url), new URL("../../osr-export/generated/frame-engine.js", import.meta.url)],
];

const H264_SUPPORTED = {
  info: { codec: "avc1.640028", codedWidth: 1920, codedHeight: 1080 },
  support: { codec: "avc1.640028", hw: true, sw: true, any: true },
};
const HEVC_SUPPORTED = {
  info: { codec: "hvc1.1.6.L150.B0", codedWidth: 1920, codedHeight: 1080 },
  support: { codec: "hvc1.1.6.L150.B0", hw: true, sw: false, any: true },
};
const UNSUPPORTED = {
  info: { codec: "hvc1.2.4.H156.B0", codedWidth: 1920, codedHeight: 1080 },
  support: { codec: "hvc1.2.4.H156.B0", hw: false, sw: false, any: false },
};
const PROXY_PROBE = {
  info: { codec: "avc1.42C01E", codedWidth: 406, codedHeight: 720 },
  support: { codec: "avc1.42C01E", hw: true, sw: true, any: true },
};

function mediaUrl(value) {
  return "/media/" + String(value).replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
}

function isImage(value) {
  return /\.(png|jpe?g|webp|bmp|gif)(?:$|[?#])/i.test(value);
}

function harness(frameEngine, probeTable) {
  const warnings = [];
  const probed = [];
  return {
    warnings,
    probed,
    options: (mode) => ({
      engine: {
        needsCodecProbe: frameEngine.needsCodecProbe,
        chooseSource: frameEngine.chooseSource,
        probeSourceCodec: async (url) => {
          probed.push(url);
          return probeTable[url] ?? { info: null, support: null, error: "not stubbed" };
        },
      },
      toUrl: mediaUrl,
      looksLikeImage: isImage,
      onWarning: (message) => warnings.push(String(message)),
      mode,
    }),
  };
}

const SOURCES = [
  { id: "s1", path: ".akari/work/silent/IMG_3328.MOV", proxy: ".akari/sidecars/assets/IMG_3328.MOV.analysis/proxy.mp4" },
  { id: "s2", path: ".akari/work/silent/IMG_3335.mov", proxy: ".akari/sidecars/assets/IMG_3335.mov.analysis/proxy.mp4" },
];

for (const [name, runtimeUrl, bundleUrl] of RUNTIMES) {
  test(`${name}: 既定（mode 未設定）は原本を読み、proxy 宣言があっても proxy へ落ちない`, async () => {
    const { resolveSourceSelections } = await loadSelection(runtimeUrl);
    const frameEngine = await loadFrameEngine(bundleUrl);
    const table = {
      [mediaUrl(SOURCES[0].path)]: H264_SUPPORTED,
      [mediaUrl(SOURCES[1].path)]: HEVC_SUPPORTED,
    };
    const bench = harness(frameEngine, table);
    const result = await resolveSourceSelections(SOURCES, bench.options(undefined));
    assert.deepEqual([...result.urls.entries()], [
      ["s1", mediaUrl(SOURCES[0].path)],
      ["s2", mediaUrl(SOURCES[1].path)],
    ]);
    assert.deepEqual(result.records, [
      {
        id: "s1", chosen: "original", reason: "hardware-ok", path: SOURCES[0].path,
        width: 1920, height: 1080, codec: "avc1.640028",
      },
      {
        id: "s2", chosen: "original", reason: "hardware-ok", path: SOURCES[1].path,
        width: 1920, height: 1080, codec: "hvc1.1.6.L150.B0",
      },
    ]);
    // 既定でも needsCodecProbe は true。プローブしたのは原本だけで、プロキシは触らない。
    assert.deepEqual(bench.probed, [mediaUrl(SOURCES[0].path), mediaUrl(SOURCES[1].path)]);
    assert.deepEqual(bench.warnings, []);
  });

  test(`${name}: 原本が decode 不能かつ proxy 実在のときだけ proxy へ退避し warning 1 件`, async () => {
    const { resolveSourceSelections } = await loadSelection(runtimeUrl);
    const frameEngine = await loadFrameEngine(bundleUrl);
    const table = {
      [mediaUrl(SOURCES[0].path)]: H264_SUPPORTED,
      [mediaUrl(SOURCES[1].path)]: UNSUPPORTED,
      [mediaUrl(SOURCES[1].proxy)]: PROXY_PROBE,
    };
    const bench = harness(frameEngine, table);
    const result = await resolveSourceSelections(SOURCES, bench.options("original"));
    assert.equal(result.urls.get("s1"), mediaUrl(SOURCES[0].path));
    assert.equal(result.urls.get("s2"), mediaUrl(SOURCES[1].proxy));
    assert.deepEqual(result.records[1], {
      id: "s2", chosen: "proxy", reason: "codec-unsupported", path: SOURCES[1].proxy,
      width: 406, height: 720, codec: "avc1.42C01E",
    });
    assert.deepEqual(bench.warnings, ["原本を再生できないためプロキシで書き出しました: s2"]);
  });

  test(`${name}: AKARI_EXPORT_SOURCE=proxy 相当の mode は probe せず proxy を読む`, async () => {
    const { resolveSourceSelections } = await loadSelection(runtimeUrl);
    const frameEngine = await loadFrameEngine(bundleUrl);
    const table = {
      [mediaUrl(SOURCES[0].proxy)]: PROXY_PROBE,
      [mediaUrl(SOURCES[1].proxy)]: PROXY_PROBE,
    };
    const bench = harness(frameEngine, table);
    const result = await resolveSourceSelections(SOURCES, bench.options("proxy"));
    assert.deepEqual([...result.urls.values()], [mediaUrl(SOURCES[0].proxy), mediaUrl(SOURCES[1].proxy)]);
    assert.deepEqual(result.records.map((entry) => [entry.chosen, entry.reason, entry.width, entry.height]), [
      ["proxy", "preference:proxy", 406, 720],
      ["proxy", "preference:proxy", 406, 720],
    ]);
    // 判定のための原本プローブは走らない（needsCodecProbe('proxy', true) === false）。
    assert.deepEqual(bench.probed, [mediaUrl(SOURCES[0].proxy), mediaUrl(SOURCES[1].proxy)]);
    assert.deepEqual(bench.warnings, []);
  });

  test(`${name}: プローブ不能（support == null）は原本のまま進む`, async () => {
    const { resolveSourceSelections } = await loadSelection(runtimeUrl);
    const frameEngine = await loadFrameEngine(bundleUrl);
    const bench = harness(frameEngine, {});
    const result = await resolveSourceSelections([SOURCES[0]], bench.options("original"));
    assert.equal(result.urls.get("s1"), mediaUrl(SOURCES[0].path));
    assert.deepEqual(result.records, [{
      id: "s1", chosen: "original", reason: "probe-unavailable", path: SOURCES[0].path,
      width: null, height: null,
    }]);
    assert.deepEqual(bench.warnings, []);
  });

  test(`${name}: mode 'auto' は宣言 proxy を選ぶので出口の既定にはしない`, async () => {
    const { exportSourceMode, resolveSourceSelections } = await loadSelection(runtimeUrl);
    assert.equal(exportSourceMode(undefined), "original");
    assert.equal(exportSourceMode(""), "original");
    assert.equal(exportSourceMode("ORIGINAL"), "original");
    assert.equal(exportSourceMode("nonsense"), "original");
    assert.equal(exportSourceMode(" Proxy "), "proxy");
    assert.equal(exportSourceMode("auto"), "auto");
    const frameEngine = await loadFrameEngine(bundleUrl);
    const bench = harness(frameEngine, { [mediaUrl(SOURCES[0].proxy)]: PROXY_PROBE });
    const result = await resolveSourceSelections([SOURCES[0]], bench.options("auto"));
    assert.equal(result.records[0].chosen, "proxy");
    assert.equal(result.records[0].reason, "declared");
  });

  test(`${name}: 静止画ソースはプローブせず原本のまま`, async () => {
    const { resolveSourceSelections } = await loadSelection(runtimeUrl);
    const frameEngine = await loadFrameEngine(bundleUrl);
    const bench = harness(frameEngine, {});
    const result = await resolveSourceSelections([{ id: "img", path: "assets/board.png" }], bench.options("original"));
    assert.equal(result.urls.get("img"), mediaUrl("assets/board.png"));
    assert.deepEqual(result.records, [{
      id: "img", chosen: "original", reason: "probe-unavailable", path: "assets/board.png",
      width: null, height: null,
    }]);
    assert.deepEqual(bench.probed, []);
  });

  test(`${name}: v0 の単一 source も同じ判定へ流す`, async () => {
    const { declaredSources } = await loadSelection(runtimeUrl);
    assert.deepEqual(declaredSources({ source: { path: "assets/a.mp4", proxy: "assets/a.proxy.mp4" } }), [
      { id: "default", path: "assets/a.mp4", proxy: "assets/a.proxy.mp4" },
    ]);
    assert.deepEqual(declaredSources({ sources: SOURCES }), SOURCES);
    assert.deepEqual(declaredSources({}), []);
  });

  test(`${name}: page-runtime は proxy を無条件に選ぶ式を持たない`, async () => {
    const source = await readFile(runtimeUrl, "utf8");
    assert.equal(source.includes("source.proxy || source.path"), false);
    assert.match(source, /resolveSourceSelections/u);
  });
}

test("GPU ページ config は sourceMode を運ぶ（既定 original・切り戻しは env 相当の引数）", async () => {
  const { buildGpuPage } = await import("../src/page-builder.mjs");
  const edit = {
    version: 2,
    output: { width: 320, height: 180, fps: 30 },
    sources: [{ id: "main", path: "assets/main.mp4", proxy: "assets/main.proxy.mp4" }],
    cuts: [{ id: "cut", src: "main", in: 0, out: 2 }],
    overlays: [],
  };
  const base = {
    edit, projectRoot: "/unused", duration: 2,
    frameEngineBundle: "window.AkariFrameEngine={};", pageRuntime: "void 0;",
  };
  assert.match(buildGpuPage(base).html, /"sourceMode":"original"/u);
  assert.match(buildGpuPage({ ...base, sourceMode: "proxy" }).html, /"sourceMode":"proxy"/u);
});

test("GPU レシートは素材ごとの chosen / reason / path / 寸法を残す", async () => {
  const { buildGpuReceipt } = await import("../src/receipt.mjs");
  const receipt = buildGpuReceipt({
    tier: 1,
    run: {
      sources: [
        { id: "s1", chosen: "original", reason: "hardware-ok", path: ".akari/work/silent/IMG_3328.MOV", width: 1920, height: 1080, codec: "avc1.640028" },
        { id: "s2", chosen: "original", reason: "hardware-ok", path: ".akari/work/silent/IMG_3335.mov", width: 1920, height: 1080, codec: "hvc1.1.6.L150.B0" },
      ],
    },
  });
  assert.deepEqual(receipt.sources.map((entry) => [entry.id, entry.chosen, entry.width, entry.height]), [
    ["s1", "original", 1920, 1080],
    ["s2", "original", 1920, 1080],
  ]);
  assert.equal(buildGpuReceipt({ tier: 1, run: {} }).sources, null);
});

test("GPU page-runtime は選択結果を run.json（.akari/gpu-run.json）へ載せる", async () => {
  const source = await readFile(new URL("../src/page-runtime.js", import.meta.url), "utf8");
  assert.match(source, /sources: sourceSelection\.records,/u);
  assert.match(source, /new GpuFrameEngineRuntime\(config, sourceSelection\.urls\)/u);
});
