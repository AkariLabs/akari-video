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
  assert.equal(source.match(/rendererWarnings,\n\s+\}\);/gu)?.length, 2);
  assert.match(source, /const seekResult = await windowRef\.webContents\.executeJavaScript/u);
  assert.match(source, /collectRendererWarnings\(rendererWarnings, seekResult\)/u);
});
