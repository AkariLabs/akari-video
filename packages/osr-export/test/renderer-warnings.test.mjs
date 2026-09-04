import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { collectRendererWarnings } from "../src/electron-main.mjs";

test("seek warnings are deduplicated in first-seen order and attached to every OSR run state", () => {
  const warnings = new Set(["page-builder warning"]);
  collectRendererWarnings(warnings, { warnings: ["perspective warning", "perspective warning"] });
  collectRendererWarnings(warnings, { warnings: ["perspective warning", "unknown field warning"] });
  collectRendererWarnings(warnings, null);
  assert.deepEqual([...warnings], [
    "page-builder warning",
    "perspective warning",
    "unknown field warning",
  ]);

  const source = readFileSync(new URL("../src/electron-main.mjs", import.meta.url), "utf8");
  assert.equal(source.match(/warnings: \[\.\.\.rendererWarnings\]/gu)?.length, 6);
  // 書き出し / capture の 2 経路とも captureFrameBitmap へ rendererWarnings を渡していること。
  // 書き出し側は memoryTelemetry（生存デコーダセッション数 / issue #52）も一緒に渡す。
  assert.equal(source.match(/rendererWarnings,\n(?:\s+memoryTelemetry,\n)?\s+\}\);/gu)?.length, 2);
  assert.match(source, /const seekResult = await windowRef\.webContents\.executeJavaScript/u);
  assert.match(source, /collectRendererWarnings\(rendererWarnings, seekResult\)/u);
});
