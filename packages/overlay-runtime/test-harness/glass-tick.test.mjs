import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "../src/overlay-runtime.js"), "utf8");

const GLASS_HTML =
  '<div class="scene-root"><canvas></canvas>'
  + '<script type="application/json" data-akari-glass-scene>{}</script></div>';
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
// querySelector は 3D 判定セレクタ（data-akari-glass-scene）だけ、注入 HTML 文字列で答える。
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
      return selector.includes("data-akari-glass-scene") && element.html.includes("data-akari-glass-scene")
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
      glassRuntime: {
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


test("glass tick seeks local time after CSS and disposes on hide/unmount", async () => {
  const animation = { pause() {}, currentTime: null, effect: { getComputedTiming: () => ({endTime: 800}) } };
  const host = createHost({ animations: () => [animation] });
  await host.runtime.mount({ overlays: [{id: "glass", html: GLASS_HTML, start: 2, duration: 3}] });
  host.runtime.tick(3.5, true);
  assert.equal(animation.currentTime, 1500);
  assert.equal(host.renderCalls.at(-1).seconds, 1.5);
  host.runtime.tick(2.5, true);
  assert.equal(host.renderCalls.at(-1).seconds, .5);
  host.runtime.tick(5, true);
  assert.equal(host.disposeCalls.length, 1);
  host.runtime.tick(3.5, true);
  assert.equal(host.renderCalls.at(-1).seconds, 1.5);
  host.runtime.unmount();
  assert.equal(host.disposeCalls.length, 2);
});
