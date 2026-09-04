import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { buildGpuPage } from "../src/page-builder.mjs";

const pageRuntimeSource = await readFile(
  join(import.meta.dirname, "..", "src", "page-runtime.js"),
  "utf8",
);
const rasterizeSource = await readFile(
  join(import.meta.dirname, "..", "..", "render-cut", "src", "rasterize.mjs"),
  "utf8",
);

const edit = {
  version: 2,
  output: { width: 320, height: 180, fps: 30 },
  sources: [{ id: "main", path: "assets/main.mp4" }],
  cuts: [{ id: "cut", src: "main", in: 0, out: 4 }],
  overlays: [],
};

function build(overlays, options = {}) {
  return buildGpuPage({
    edit: { ...edit, overlays },
    overlays,
    captions: [],
    projectRoot: "/unused",
    duration: 4,
    frameEngineBundle: "window.AkariFrameEngine={};",
    pageRuntime: "void 0;",
    ...options,
  });
}

test("(b) overlay の時刻は µs 量子化を挟まず OSR と同じ frameNumber / fps で作る", () => {
  assert.match(pageRuntimeSource, /const seconds = frameNumber \/ config\.fps;/u);
  assert.doesNotMatch(pageRuntimeSource, /const timeUs = Math\.round\(frameNumber \/ config\.fps \* 1e6\)/u);
  // OSR 側の正本（osr-export/src/electron-main.mjs の __akariSeek(frame / fps)）と同じ式であること
  // を、境界フレームの比較が両経路で一致する形で押さえる。µs へ丸めると overlay.start（= atFrames / fps）
  // との比較が 1 ulp で反転し、カット境界の 1 枚だけ食い違う。
  const fps = 30;
  let quantizedMismatches = 0;
  let exactMismatches = 0;
  for (let startFrame = 0; startFrame < 7320; startFrame += 1) {
    const start = startFrame / fps;
    const exact = startFrame / fps;
    const quantized = Math.round((startFrame / fps) * 1e6) / 1e6;
    if (!(exact >= start)) exactMismatches += 1;
    if (!(quantized >= start)) quantizedMismatches += 1;
  }
  assert.equal(exactMismatches, 0);
  assert.ok(quantizedMismatches > 0, "µs 量子化は境界フレームの判定を実際に落とす");
});

test("(a) DOM 層は非活性コンテナのアニメも毎コマ止めて時刻を書く", () => {
  const captureRun = pageRuntimeSource.slice(
    pageRuntimeSource.indexOf("async captureRun(run, seconds, frameNumber)"),
    pageRuntimeSource.indexOf("recordFrameCost(value)"),
  );
  const pinIndex = captureRun.indexOf("container.getAnimations({ subtree: true })");
  const skipIndex = captureRun.indexOf("if (!active) continue;");
  assert.ok(pinIndex >= 0 && skipIndex >= 0);
  assert.ok(pinIndex < skipIndex, "アニメの固定は active 判定の手前で行うこと（OSR の __akariSyncAnimations と同じ規律）");
  // OSR 側は全コンテナを対象にしている（active 判定を持たない）
  const syncAnimations = rasterizeSource.slice(
    rasterizeSource.indexOf("window.__akariSyncAnimations = function"),
    rasterizeSource.indexOf("window.__akariSeekVideos"),
  );
  assert.match(syncAnimations, /querySelectorAll\('\.akari-overlay-container'\)/u);
});

test("(a) 時間窓の外のコンテナは display で落とす（visibility だけでは子孫に打ち消される）", () => {
  const captureRun = pageRuntimeSource.slice(
    pageRuntimeSource.indexOf("async captureRun(run, seconds, frameNumber)"),
    pageRuntimeSource.indexOf("recordFrameCost(value)"),
  );
  // visibility は継承するだけで、子孫の visibility: visible に打ち消される。実制作の断片は
  // 「基本 hidden・ゲートアニメの 0% が visible」と書くため、非活性コンテナでその 0% を
  // 適用した瞬間に中身が出る（実測: 配置 110s の B ロールが 0s のフレームへ 3 枚出た）。
  // display: none は子孫から打ち消せないので、こちらを必ず併せて書くこと。issue #53 (a)
  assert.match(captureRun, /container\.style\.display = active \? "" : "none";/u);
  assert.match(captureRun, /container\.style\.visibility = active \? "visible" : "hidden";/u);
  const displayIndex = captureRun.indexOf("container.style.display");
  const pinIndex = captureRun.indexOf("container.getAnimations({ subtree: true })");
  assert.ok(displayIndex >= 0 && pinIndex >= 0);
  assert.ok(
    displayIndex < pinIndex,
    "display の切り替えはアニメ固定より手前で行うこと（活性へ戻ったフレームで先にボックスを作る）",
  );
});

test("(c) 動画テクスチャのシークは 1 実装をシートから共有する", () => {
  assert.match(rasterizeSource, /window\.__akariSeekVideos = async function\(seconds\)/u);
  assert.match(rasterizeSource, /const warnings = await window\.__akariSeekVideos\(seconds\);/u);
  assert.match(pageRuntimeSource, /await overlayFrame\.contentWindow\.__akariSeekVideos\(seconds\)/u);
});

test("(c) DOM ステージは OSR の #stage と同じく data-no-timeline を持つ", () => {
  const result = build([{ id: "forced", start: 0, duration: 1, html: "<iframe></iframe>", vars: {} }], { forceDegraded: true });
  assert.match(result.html, /<div id="akari-dom-stage" data-no-timeline><\/div>/u);
  assert.match(rasterizeSource, /id="stage"[^>]*data-no-timeline/u);
});

test("(c) 静的スプライトは overlay の transform を落とさない", () => {
  const spriteRoot = pageRuntimeSource.slice(
    pageRuntimeSource.indexOf("function foreignObjectSvg("),
    pageRuntimeSource.indexOf("async function rasterizeSprite("),
  );
  assert.match(spriteRoot, /transform:translate\(var\(--x, 0px\), var\(--y, 0px\)\) scale\(var\(--scale, 1\)\) rotate\(var\(--rotate, 0deg\)\);transform-origin:center;/u);
  // OSR のコンテナと同じ宣言であること
  assert.match(rasterizeSource, /\.akari-overlay-container \{[^}]*transform: translate\(var\(--x, 0px\), var\(--y, 0px\)\) scale\(var\(--scale, 1\)\) rotate\(var\(--rotate, 0deg\)\); transform-origin: center;/u);
  // 静的スプライトの vars に transform が載っていること（載っていなければ上の宣言は効かない）
  const result = build([{ id: "static", start: 0, duration: 1, html: "<div>x</div>", transform: { x: 120, y: -40, scale: 1.5 } }]);
  assert.equal(result.spriteManifest.statics[0].vars["--x"], "120px");
  assert.equal(result.spriteManifest.statics[0].vars["--y"], "-40px");
  assert.equal(result.spriteManifest.statics[0].vars["--scale"], "1.5");
});

test("start / duration が欠けた overlay は全尺表示にせず fail-closed にする", () => {
  assert.throws(
    () => build([{ id: "broken", duration: 1, html: "<div>x</div>", vars: {} }]),
    /overlay broken has no finite time window/u,
  );
  assert.throws(
    () => build([{ id: "broken", start: 0, html: "<div>x</div>", vars: {} }]),
    /overlay broken has no finite time window/u,
  );
  assert.throws(
    () => build([{ id: "broken", html: "<iframe></iframe>", vars: {} }], { forceDegraded: true }),
    /overlay broken has no finite time window/u,
  );
});
