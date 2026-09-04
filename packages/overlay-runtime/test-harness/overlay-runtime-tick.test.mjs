// 共有 overlay runtime の tick 性能配線を、ブラウザ無しの最小フェイク DOM（vm）で検証する。
// (a) 3D 断片の threeRuntime.render にプレビュー用 maxRenderSize（既定 720）が渡り、
//     mount(summary, options) / configure() / createOverlayRuntime() で上書き・無効化できること
// (b) 非 3D 断片の getAnimations({ subtree: true }) が 250ms 以内の連続 tick で 1 回しか
//     呼ばれず、可視化フリップと 250ms 経過で引き直されること（[data-akari-active] ゲートは維持）
// (c) 3D 断片でも同じ CSS アニメ同期を通すこと（three のシーンと断片の CSS は別物で、
//     後者を進めるのは tick の仕事。回帰: 2026-09-04）
// 実 DOM（CSS animation の生成・three の描画）は扱わない。実ブラウザでの挙動は
// entry-animation-hit-region.test.mjs / premount.test.mjs が担う。
// 実行: node --test packages/overlay-runtime/test-harness/overlay-runtime-tick.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "../src/overlay-runtime.js"), "utf8");

const THREE_HTML =
  '<div class="scene-root"><canvas></canvas>'
  + '<script type="application/json" data-akari-3d-scene>{}</script></div>';
const CAPTION_HTML = '<div class="cap"><span>字幕</span></div>';

function fakeStyle() {
  const properties = new Map();
  return {
    setProperty(name, value) { properties.set(name, String(value)); },
    getPropertyValue(name) { return properties.get(name) ?? ""; },
    removeProperty(name) { properties.delete(name); },
    properties,
  };
}

// overlay-runtime.js が mount / tick で触る DOM 面だけを持つ最小要素。
// querySelector は 3D 判定セレクタ（data-akari-3d-scene）だけ、注入 HTML 文字列で答える。
function fakeElement(tagName, host) {
  const attributes = new Map();
  const element = {
    tagName: tagName.toUpperCase(),
    nodeType: 1,
    dataset: {},
    style: fakeStyle(),
    children: [],
    html: "",
    innerHTML: "",
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; },
    hasAttribute(name) { return attributes.has(name); },
    removeAttribute(name) { attributes.delete(name); },
    toggleAttribute(name, force) {
      const next = force === undefined ? !attributes.has(name) : Boolean(force);
      if (next) attributes.set(name, "");
      else attributes.delete(name);
      return next;
    },
    appendChild(node) { element.children.push(node); return node; },
    replaceChildren(...nodes) {
      element.children = nodes.flatMap((node) => (node.nodeType === 11 ? node.children : [node]));
      for (const node of nodes) {
        if (typeof node.html === "string") element.html = node.html;
      }
    },
    querySelector(selector) {
      return selector.includes("data-akari-3d-scene") && element.html.includes("data-akari-3d-scene")
        ? { tagName: "SCRIPT" }
        : null;
    },
    querySelectorAll() { return []; },
    getAnimations(options) {
      host.getAnimationsCalls.push({ element, options });
      return host.animationsFor(element);
    },
  };
  if (tagName === "template") {
    element.content = {
      nodeType: 11,
      children: [],
      cloneNode() { return { nodeType: 11, children: [], html: element.innerHTML }; },
    };
  }
  return element;
}

function createHost({ animations = () => [] } = {}) {
  const host = {
    clock: 1000,
    getAnimationsCalls: [],
    renderCalls: [],
    disposeCalls: [],
    interactionCalls: [],
    animationsFor: animations,
  };
  const stage = fakeElement("div", host);
  const document = {
    getElementById: (id) => (id === "overlay-stage" ? stage : null),
    createElement: (tag) => fakeElement(tag, host),
    createDocumentFragment: () => ({
      nodeType: 11,
      children: [],
      appendChild(node) { this.children.push(node); return node; },
    }),
  };
  const window = {
    akari: {
      threeRuntime: {
        render(container, seconds, options) { host.renderCalls.push({ container, seconds, options }); },
        dispose(container) { host.disposeCalls.push(container); },
      },
      interaction: {
        syncOverlayHitRegion(container) { host.interactionCalls.push(["sync", container]); },
        applyOverlayHitPolicy(container) { host.interactionCalls.push(["apply", container]); },
        invalidateOverlayHitPolicy(container) { host.interactionCalls.push(["invalidate", container]); },
      },
    },
  };
  const context = { window, document, performance: { now: () => host.clock }, console };
  vm.runInNewContext(source, context, { filename: "overlay-runtime.js" });
  host.stage = stage;
  host.window = window;
  host.runtime = window.akari.runtime;
  return host;
}

// vm 側の realm で作られたオブジェクトは prototype が異なり deepEqual が落ちるため、
// own プロパティだけを外側 realm へ写してから比較する。
const own = (object) => ({ ...object });

test("3D 断片の render にプレビュー用 maxRenderSize（既定 720）を syncVideos と共に渡す", async () => {
  const host = createHost();
  await host.runtime.mount({ overlays: [{ id: "cube", start: 0, duration: 10, html: THREE_HTML }] });
  host.runtime.tick(1.5, true);

  assert.equal(host.renderCalls.length, 1);
  const [call] = host.renderCalls;
  assert.equal(call.container.dataset.overlayId, "cube");
  assert.equal(call.seconds, 1.5);
  assert.deepEqual(own(call.options), { syncVideos: true, maxRenderSize: 720 });
});

test("maxRenderSize は mount(summary, options) / configure / factory で上書き・無効化できる", async () => {
  const host = createHost();
  const summary = { overlays: [{ id: "cube", start: 0, duration: 10, html: THREE_HTML }] };
  const lastOptions = () => own(host.renderCalls.at(-1).options);

  await host.runtime.mount(summary, { maxRenderSize: 480 });
  host.runtime.tick(1, true);
  assert.deepEqual(lastOptions(), { syncVideos: true, maxRenderSize: 480 });

  // options 無しの再 mount は runtime に保持した値を引き継ぐ
  await host.runtime.mount(summary);
  host.runtime.tick(1, true);
  assert.equal(lastOptions().maxRenderSize, 480);

  // null / 0 は無効化（等倍）。three-runtime の rendererSize は null を「上限なし」として扱う
  await host.runtime.mount(summary, { maxRenderSize: null });
  host.runtime.tick(1, true);
  assert.equal(lastOptions().maxRenderSize, null);
  await host.runtime.mount(summary, { maxRenderSize: 0 });
  host.runtime.tick(1, true);
  assert.equal(lastOptions().maxRenderSize, null);

  // 不正値（負数・NaN）は既定 720 へ戻す
  await host.runtime.mount(summary, { maxRenderSize: -10 });
  host.runtime.tick(1, true);
  assert.equal(lastOptions().maxRenderSize, 720);

  // configure でも切り替えられ、現在値を返す
  const configured = host.runtime.configure({ maxRenderSize: 360 });
  assert.equal(configured.maxRenderSize, 360);
  host.runtime.tick(1, true);
  assert.equal(lastOptions().maxRenderSize, 360);

  // factory オプション
  const runtime = host.window.akari.createOverlayRuntime({ maxRenderSize: 540 });
  await runtime.mount(summary);
  runtime.tick(1, true);
  assert.equal(lastOptions().maxRenderSize, 540);
});

test("非 3D 断片の getAnimations は 250ms 以内の連続 tick で 1 回だけ呼ぶ", async () => {
  const animation = {
    paused: false,
    currentTime: null,
    pause() { this.paused = true; },
    effect: { getComputedTiming: () => ({ endTime: 800 }) },
  };
  const host = createHost({ animations: () => [animation] });
  await host.runtime.mount({ overlays: [{ id: "cap", start: 0, duration: 10, html: CAPTION_HTML }] });
  const container = host.stage.children[0];
  const captionCalls = () => host.getAnimationsCalls.filter((call) => call.element === container).length;

  host.clock = 1000;
  host.runtime.tick(0.1, true);
  host.clock = 1016;
  host.runtime.tick(0.2, true);
  host.clock = 1032;
  host.runtime.tick(0.3, true);
  assert.equal(captionCalls(), 1, "250ms 以内の 3 tick で getAnimations は 1 回");
  assert.deepEqual(own(host.getAnimationsCalls[0].options), { subtree: true });
  assert.equal(animation.paused, true);
  assert.equal(animation.currentTime, 300, "キャッシュ済みの Animation にも毎 tick currentTime を書く");
  assert.equal(container.hasAttribute("data-akari-active"), true, "可視中は data-akari-active ゲートを付ける");
  assert.equal(host.renderCalls.length, 0, "非 3D 断片は threeRuntime.render を呼ばない");

  host.clock = 1300; // 直近取得 1032 から 268ms > 250ms
  host.runtime.tick(0.4, true);
  assert.equal(captionCalls(), 2, "250ms 超過で引き直す");

  host.clock = 1310;
  host.runtime.tick(20, true); // 可視区間外
  assert.equal(container.style.visibility, "hidden");
  assert.equal(container.hasAttribute("data-akari-active"), false, "非表示ではゲートを外す");
  assert.equal(captionCalls(), 2, "非表示の tick では getAnimations を呼ばない");

  host.clock = 1320;
  host.runtime.tick(0.5, true); // 再可視化: 前回取得から 250ms 以内でもフリップで引き直す
  assert.equal(container.style.visibility, "visible");
  assert.equal(captionCalls(), 3, "可視化フリップで引き直す");
  assert.equal(animation.currentTime, 500);
});

test("入場アニメの確定判定（hitPolicyPending）もキャッシュ済み一覧で行う", async () => {
  const animation = {
    currentTime: null,
    pause() {},
    effect: { getComputedTiming: () => ({ endTime: 800 }) },
  };
  const host = createHost({ animations: () => [animation] });
  await host.runtime.mount({ overlays: [{ id: "cap", start: 0, duration: 10, html: CAPTION_HTML }] });
  const container = host.stage.children[0];
  const count = (kind) =>
    host.interactionCalls.filter(([name, target]) => name === kind && target === container).length;

  host.clock = 1000;
  host.runtime.tick(0.1, true); // currentTime 100 < endTime 800 → 未確定
  assert.equal(count("sync"), 1);
  assert.equal(count("invalidate"), 0);

  host.clock = 1016;
  host.runtime.tick(0.9, true); // 900 >= 800 → 確定
  assert.equal(count("sync"), 2);
  assert.equal(count("invalidate"), 1);

  host.clock = 1032;
  host.runtime.tick(1.0, true); // 確定後はヒット領域同期を呼ばない
  assert.equal(count("sync"), 2);
  assert.equal(count("invalidate"), 1);
  assert.equal(
    host.getAnimationsCalls.filter((call) => call.element === container).length,
    1,
    "確定判定も pause/currentTime 同期と同じキャッシュを使い、getAnimations は 1 回",
  );
});

// 回帰（2026-09-04 実機報告「3D モデルがずっと画面に残る」）:
// 3D 分岐が CSS アニメ同期の手前で continue していたため、3D 宣言を含む断片の CSS アニメが
// 1 本も pause / currentTime されず、壁時計で走り切って animation-fill-mode の最終姿勢へ
// 張り付いていた。実機の S4 断片は 3D ステージの出入りを 45 秒の CSS アニメだけで持って
// いるので、最終姿勢 = 画面中央に居座る絵になっていた。
// 書き出し（render-cut の rasterize.mjs）は __akariSyncAnimations を 3D コンテナにも等しく
// 掛けているため、飛ばすとプレビューと書き出しで絵が食い違う。
test("3D 断片の CSS アニメもタイムラインへ同期する（three の描画とは別口）", async () => {
  const animation = {
    paused: false,
    currentTime: null,
    pause() { this.paused = true; },
    effect: { getComputedTiming: () => ({ endTime: 800 }) },
  };
  const host = createHost({ animations: () => [animation] });
  await host.runtime.mount({ overlays: [{ id: "cube", start: 0, duration: 10, html: THREE_HTML }] });
  const container = host.stage.children[0];
  const cubeCalls = () => host.getAnimationsCalls.filter((call) => call.element === container).length;

  host.clock = 1000;
  host.runtime.tick(1.5, true);
  assert.equal(animation.paused, true, "3D 断片の CSS アニメも pause する（壁時計で走らせない）");
  assert.equal(animation.currentTime, 1500, "currentTime は断片のローカル時刻（= tick 時刻 - start）");
  assert.equal(cubeCalls(), 1);
  assert.deepEqual(own(host.getAnimationsCalls[0].options), { subtree: true });
  assert.equal(host.renderCalls.length, 1, "CSS 同期を通しても three の描画は従来どおり呼ぶ");
  assert.equal(host.renderCalls[0].seconds, 1.5);

  // 壁時計を大きく進めてもタイムライン位置にだけ追従する
  host.clock = 9000;
  host.runtime.tick(3, true);
  assert.equal(animation.currentTime, 3000, "壁時計ではなくタイムライン位置へ同期する");
  assert.equal(cubeCalls(), 2, "250ms 超過で引き直すのは非 3D 断片と同じ");

  // 巻き戻しても同じ（シークで過去へ戻す経路）
  host.clock = 9300;
  host.runtime.tick(0.5, true);
  assert.equal(animation.currentTime, 500);
});
