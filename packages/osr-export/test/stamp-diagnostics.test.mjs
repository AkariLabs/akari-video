import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = readFileSync(fileURLToPath(new URL("../src/page-runtime.js", import.meta.url)), "utf8");
const start = source.indexOf("  window.__akariStampDiagnostics = function (seconds) {");
const end = source.indexOf('  window.addEventListener("beforeunload"', start);
assert.ok(start >= 0 && end > start);
const diagnosticSource = source.slice(start, end);

function overlay(id, startSeconds, duration, children = []) {
  return {
    getAttribute(name) { return ({ "data-overlay-id": id, "data-start": startSeconds, "data-duration": duration })[name] ?? null; },
    hasAttribute(name) { return ["data-start", "data-duration"].includes(name); },
    querySelectorAll() { return children; },
    querySelector() { return null; },
  };
}

test("stamp diagnostics reports only active overlays and CSS from descendants", () => {
  const child = {};
  const active = overlay("warm", 9, 3, [child]);
  const inactive = overlay("old", 0, 5);
  const frame = {
    dataset: { blend: "multiply" },
    contentDocument: { querySelectorAll: () => [active, inactive] },
    contentWindow: { getComputedStyle(element) {
      return { getPropertyValue: (name) => name === "mix-blend-mode" ? (element === child ? "soft-light" : "normal") : "none" };
    } },
  };
  const context = { window: {}, activeOverlayFrames: [frame] };
  runInNewContext(diagnosticSource, context);
  const result = context.window.__akariStampDiagnostics(10);
  assert.equal(result.overlays.length, 1);
  assert.equal(result.overlays[0].id, "warm");
  assert.equal(result.overlays[0].blend, "multiply");
  assert.deepEqual([...result.overlays[0].cssFeatures], ["mix-blend-mode: soft-light"]);
});

test("stamp diagnostics tolerates a failing computed style lookup", () => {
  const frame = {
    dataset: {},
    contentDocument: { querySelectorAll: () => [overlay("warm", 9, 3, [{}])] },
    contentWindow: { getComputedStyle() { throw new Error("detached"); } },
  };
  const context = { window: {}, activeOverlayFrames: [frame] };
  runInNewContext(diagnosticSource, context);
  assert.doesNotThrow(() => context.window.__akariStampDiagnostics(10));
  assert.equal(context.window.__akariStampDiagnostics(10).overlays.length, 1);
});
