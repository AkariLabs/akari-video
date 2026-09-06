import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { buildOsrPage, loadAndBuildOsrPage } from "../src/page-builder.mjs";

const animator = [{ id: "a", basis: "chars", shape: "ramp", start: 0, end: 1, offset: 0, amount: { y: 24, opacity: -1 } }];
const points = [{ t: 0, animator: { a: { offset: -0.3 } } }, { t: 15, animator: { a: { offset: 1 } } }];
const configOf = page => JSON.parse(page.html.match(/window\.__AKARI_OSR_CONFIG__=(.*?);<\/script>/u)[1]);
const edit = { output: { width: 640, height: 360, fps: 30 }, sources: [], cuts: [{ in: 0, out: 5 }] };
const cue = { id: "c", start: 0, end: 2, text: "字幕 ABC", time_domain: "output" };
const build = options => buildOsrPage({ edit, captions: [cue], projectRoot: import.meta.dirname,
  duration: 5, frameEngineBundle: "", pageRuntime: "", ...options });

test("OSR は animator と整数フレーム keyframes を overlay id ごとに埋め込む", () => {
  const page = build({ captions: [{ ...cue, animator, animatorKeyframes: points, animatorStart: 0 }] });
  assert.deepEqual(configOf(page).captionAnimators, {
    "c-01": { animator, keyframes: points, start: 0, duration: 2, animatorStart: 0 },
  });
  assert.match(page.overlaySheetHtml, /class="akari-caption__char" data-akari-char="0"/u);
  assert.match(page.html, /<iframe id="akari-overlays" src="\/overlay-sheet.html"/u);
  assert.equal(page.html, build({ captions: [{ ...cue, animator, animatorKeyframes: points, animatorStart: 0 }] }).html);
});

test("OSR は宣言なし・空宣言で余計な config キーや字幕 markup を増やさない", () => {
  const baseline = build();
  const empty = build({ captions: [{ ...cue, animator: [] }], internal: {
    output: edit.output, tracks: [{ id: "subtitles", lane: "visual", items: [{
      id: "bag", at: 0, duration: 5, source: { kind: "captions" }, declaration: { animator: [] },
    }] }],
  } });
  assert.equal(empty.html, baseline.html);
  assert.equal(empty.overlaySheetHtml, baseline.overlaySheetHtml);
  assert.equal(Object.hasOwn(configOf(baseline), "captionAnimators"), false);
  assert.doesNotMatch(baseline.overlaySheetHtml, /akari-caption__char/u);
});

test("宣言なしの HTML と overlay sheet は基底のバイト列を保つ", () => {
  // a930a107 の buildOsrPage から採取。埋め込みスクリプトは両版とも空に固定。
  const page = build({ captions: [{ ...cue, text: "Caption ABC" }] });
  const digest = value => createHash("sha256").update(value).digest("hex");
  assert.equal(digest(page.html), "fbd423496883180bb711931de726461c6728d725fa35ddba8ccfc450cb820236");
  assert.equal(digest(page.overlaySheetHtml), "cc31ef08f97bdeeea3d09c800c25de10d7c3bc6443a34bb4cebd6f26a8d849aa");
});

test("分割された source-domain cue の全 overlay に宣言と item 時計が届く", () => {
  const page = build({ edit: { ...edit, cuts: [{ in: 0, out: 1 }, { in: 2, out: 3 }] },
    captions: [{ ...cue, start: 0, end: 3, time_domain: undefined, animator, animatorKeyframes: points, animatorStart: 0.5 }],
  });
  const entries = configOf(page).captionAnimators;
  assert.deepEqual(Object.keys(entries), ["c-01", "c-02"]);
  assert.deepEqual(Object.values(entries).map(value => [value.start, value.duration, value.animatorStart]), [[0, 1, 0.5], [1, 1, 0.5]]);
});

async function project(t, { bag = false, detached = false, sidecar = false, hidden = false } = {}) {
  const projectRoot = await mkdtemp(join(tmpdir(), "akari-osr-caption-animator-"));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  if (sidecar) {
    await mkdir(join(projectRoot, "motion"));
    await writeFile(join(projectRoot, "motion", "cue.json"), JSON.stringify({ version: 0, group: "detached", items: { detached: points } }));
  }
  const source = { version: 2, output: edit.output, sources: [{ id: "s", path: "source.mp4" }], tracks: [
    { id: "video", lane: "visual", items: [{ id: "cut", at: 0, duration: 150, source: { kind: "media", src: "s", in: 0, out: 5 } }] },
    { id: "subtitles", lane: "visual", items: [{ id: "bag", at: 15, duration: 135, source: { kind: "captions", path: "captions.json", exclude: ["c2"] },
      ...(bag ? { animator, keyframes: points } : {}) }] },
    { id: "detached-track", lane: "visual", items: [{ id: "detached", at: 60, duration: 30, source: { kind: "caption", path: "captions.json", id: "c2" },
      ...(hidden ? { hidden: true } : {}),
      ...(detached ? { animator, keyframes: sidecar ? { path: "motion/cue.json", count: 2 } : points, transform: { y: -200 }, opacity: 0.8 } : {}) }] },
  ] };
  const captions = { captions: [0, 1, 2].map(i => ({ id: `c${i + 1}`, start: i, end: i + 1, text: "字幕 ABC", time_domain: "output" })) };
  await writeFile(join(projectRoot, "edit.json"), JSON.stringify(source));
  await writeFile(join(projectRoot, "captions.json"), JSON.stringify(captions));
  return loadAndBuildOsrPage({ projectRoot, duration: 5 });
}

test("袋 item の宣言は含まれる全 cue に投影し、未宣言の分離 cue は既存経路を保つ", async t => {
  const page = await project(t, { bag: true });
  const entries = configOf(page).captionAnimators;
  assert.deepEqual(Object.keys(entries), ["bag::c1-01", "bag::c3-01"]);
  for (const entry of Object.values(entries)) {
    assert.deepEqual(entry.animator, animator);
    assert.deepEqual(entry.keyframes, points);
    assert.equal(entry.animatorStart, 0.5);
  }
  assert.equal(entries["bag::c3-01"].start, 2);
  assert.ok(page.edit.overlays.some(overlay => overlay.id === "detached"));
});

for (const sidecar of [false, true]) test(`分離 cue の宣言は参照先だけに適用する（${sidecar ? "袋参照" : "inline"}）`, async t => {
  const page = await project(t, { detached: true, sidecar });
  const entries = configOf(page).captionAnimators;
  assert.deepEqual(Object.keys(entries), ["detached::c2-01"]);
  assert.deepEqual(entries["detached::c2-01"], { animator, keyframes: points, start: 2, duration: 1, animatorStart: 2 });
  assert.equal(page.edit.overlays.some(overlay => overlay.id === "detached"), false);
  assert.doesNotMatch(page.overlaySheetHtml, /data-overlay-id="detached"/u);
  assert.equal((page.overlaySheetHtml.match(/data-overlay-id="detached::c2-01"/gu) ?? []).length, 1);
  assert.match(page.overlaySheetHtml, /data-overlay-id="c1-01"/u);
  assert.match(page.overlaySheetHtml, /data-overlay-id="c3-01"/u);
  assert.match(page.overlaySheetHtml, /--y:-200px/u);
});

test("hidden の分離 cue は投影しない", async t => {
  const page = await project(t, { detached: true, hidden: true });
  assert.equal(Object.hasOwn(configOf(page), "captionAnimators"), false);
  assert.doesNotMatch(page.overlaySheetHtml, /data-overlay-id="detached/u);
});

const runtimeSource = readFileSync(new URL("../src/page-runtime.js", import.meta.url), "utf8");
function runtime(captionAnimators) {
  const events = [], applications = [], warningMessages = [];
  const roots = new Map(Object.keys(captionAnimators ?? {}).filter(id => id !== "missing").map(id => [id, {
    getAttribute: name => name === "data-overlay-id" ? id : null,
  }]));
  const overlayFrame = {
    contentDocument: { readyState: "complete", querySelectorAll: () => [...roots.values()] },
    contentWindow: { __akariReady: Promise.resolve(), __akariSeek: async seconds => { events.push(["overlay", seconds]); return { warnings: ["overlay warning"] }; } },
  };
  const stamp = { style: {} };
  const canvas = { getContext: () => ({ clearColor() {}, clear() {} }) };
  const FE = {
    WebGL2Compositor: class {}, FrameMetrics: class {},
    StreamReaper: class { reap() { return { liveStreams: 0 }; } released() { return 0; } },
    buildResolvedTimelinePlan: () => ({ totalDuration: 5 }),
    evaluationPlanFromResolvedTimeline: (_timeline, micros) => { events.push(["engine", micros / 1e6]); return { base: [], layers: [] }; },
    applyCaptionAnimatorDom(root, declaration) {
      applications.push({ root, declaration });
      events.push(["animator", root.getAttribute("data-overlay-id")]);
      declaration.warn("animator.segments-fallback", "segments uses words in v1");
    },
  };
  const window = {
    __AKARI_OSR_CONFIG__: { edit: { cuts: [], sources: [] }, fps: 30, width: 640, height: 360,
      ...(captionAnimators ? { captionAnimators } : {}) },
    AkariFrameEngine: FE,
    __akariEncodeStamp: frame => ({ css: String(frame) }),
    addEventListener() {},
  };
  vm.runInNewContext(runtimeSource, { window,
    document: { fonts: { ready: Promise.resolve() }, getElementById: id => ({ "akari-overlays": overlayFrame, "akari-stamp": stamp, "akari-engine": canvas })[id] },
    requestAnimationFrame: callback => { events.push(["raf"]); callback(); },
    console: { warn: (...message) => warningMessages.push(message) },
  });
  return { window, events, applications, roots, warningMessages };
}

test("runtime は frame 0 と全 seek で iframe seek 直後に適用し、範囲外は触らない", async () => {
  const first = { animator, keyframes: points, start: 0, duration: 1, animatorStart: 0 };
  const second = { animator, keyframes: points, start: 2, duration: 1, animatorStart: 0.5 };
  const h = runtime({ first, 'cue"\\id': second });
  await h.window.__akariReady;
  assert.equal(h.applications.length, 1);
  assert.equal(h.applications[0].declaration.cueLocalSeconds, 0);
  for (const seconds of [0.2, 0.4, 1, 1.5, 2, 2.5, 3, 0.2]) {
    const before = h.applications.length;
    h.events.length = 0;
    const result = await h.window.__akariSeek(seconds, Math.round(seconds * 30));
    const active = seconds < 1 || (seconds >= 2 && seconds < 3);
    assert.equal(h.applications.length, before + Number(active));
    assert.deepEqual(h.events.slice(0, 2), [["engine", seconds], ["overlay", seconds]]);
    if (active) {
      assert.equal(h.events[2][0], "animator");
      const { root, declaration } = h.applications.at(-1);
      const id = seconds < 1 ? "first" : 'cue"\\id';
      assert.equal(root, h.roots.get(id));
      assert.equal(declaration.cueLocalSeconds, seconds - (seconds < 1 ? 0 : 2));
      assert.equal(declaration.keyframeOffsetSeconds, seconds < 1 ? 0 : 1.5);
      assert.equal(declaration.cueDurationSec, 1);
      assert.equal(declaration.fps, 30);
      assert.equal(declaration.outputWidth, 640);
      assert.equal(declaration.keyframes, points);
    }
    assert.ok(result.warnings.includes("overlay warning"));
  }
  assert.equal(h.warningMessages.length, 1);
});

test("runtime は宣言なしで適用器も iframe の単位探索も呼ばない", async () => {
  const h = runtime();
  delete h.window.AkariFrameEngine.applyCaptionAnimatorDom;
  await h.window.__akariReady;
  assert.ok(h.events.every(event => event[0] !== "overlay"));
  await h.window.__akariSeek(1, 30);
  assert.equal(h.applications.length, 0);
  assert.equal(h.warningMessages.length, 0);
});

test("runtime の存在しない overlay 警告は code ごとに一度だけ", async () => {
  const h = runtime({ missing: { animator, start: 0, duration: 2 } });
  await h.window.__akariReady;
  await h.window.__akariSeek(0.5, 15);
  await h.window.__akariSeek(1, 30);
  assert.equal(h.applications.length, 0);
  assert.equal(h.warningMessages.length, 1);
  assert.match(h.warningMessages[0][1], /animator.missing-overlay/u);
});
