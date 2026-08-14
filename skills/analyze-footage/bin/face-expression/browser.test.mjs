import assert from "node:assert/strict";
import test from "node:test";

import { BROWSER_ARGS } from "./browser.mjs";

test("headless MediaPipe は avatar-vrm と同じ SwiftShader WebGL flags を使う", () => {
  assert.ok(BROWSER_ARGS.includes("--disable-gpu"));
  assert.ok(BROWSER_ARGS.includes("--enable-unsafe-swiftshader"));
  assert.ok(BROWSER_ARGS.includes("--use-angle=swiftshader"));
});
