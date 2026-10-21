import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("GPU page runtime forwards [akari-three] sheet warnings into run warnings once", () => {
  const source = readFileSync(new URL("../src/page-runtime.js", import.meta.url), "utf8");
  // シートの threeRuntime が溜めた [akari-three] 警告を取り出し、first-seen で warnings へ足す。
  assert.match(source, /const threeWarningMessages = new Set\(\);/u);
  assert.match(source, /drainWarnings\?\.\(\)/u);
  assert.match(source, /threeWarningMessages\.has\(message\)/u);
  // 最初の 3D 描画（ready 待ち）の後と、毎コマの 3D 描画の後にも回収する。
  assert.equal(source.match(/collectThreeWarnings\(\);/gu)?.length, 2);
  // 既存の警告配列（run.json）へそのまま載る。
  assert.match(source, /warnings,\n      \};\n    \} finally/u);
});
