import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// page-runtime.js はブラウザ用 IIFE（inline 前提・import 不可）なので、normalizedCuts の本体だけを
// 切り出して node:vm で評価する。関数の形が変わったらここで気づく（issue #31 の回帰検知）。
async function loadNormalizedCuts(url) {
  const source = await readFile(url, "utf8");
  const start = source.indexOf("  function normalizedCuts(edit) {");
  assert.ok(start >= 0, `${url}: normalizedCuts not found`);
  const end = source.indexOf("\n  }\n", start);
  assert.ok(end > start, `${url}: normalizedCuts end not found`);
  const body = source.slice(start, end + "\n  }\n".length);
  return vm.runInNewContext(`${body}; normalizedCuts`, {});
}

const RUNTIMES = [
  ["gpu-export", new URL("../src/page-runtime.js", import.meta.url)],
  ["osr-export", new URL("../../osr-export/src/page-runtime.js", import.meta.url)],
];

for (const [name, url] of RUNTIMES) {
  test(`${name} normalizedCuts keeps at/track only for upper visual tracks (#31)`, async () => {
    const normalizedCuts = await loadNormalizedCuts(url);
    const cuts = normalizedCuts({
      sources: [{ id: "base", path: "assets/base.mp4" }],
      cuts: [
        { id: "base-bg", src: "base", in: 0, out: 20, at: 0, track: 0, freeze: { at_sec: 1, duration_sec: 2 } },
        { id: "b1", src: "b1-01", in: 0, out: 3, at: 5, track: 1 },
        { id: "b2", src: "b1-02", in: 1, out: 2, track: 2 },
        { in: 3, out: 4, transitionOut: { type: "dissolve", duration: 0.5 } },
      ],
    });
    // track 0: 逐次配置（at / track を外す。freeze で時間軸を伸ばす既存設計のまま）
    assert.equal("at" in cuts[0], false);
    assert.equal("track" in cuts[0], false);
    assert.deepEqual(cuts[0].freeze, { at_sec: 1, duration_sec: 2 });
    // track >= 1: 絶対配置（at / track を保持）
    assert.equal(cuts[1].at, 5);
    assert.equal(cuts[1].track, 1);
    // at 無し・track のみ → track だけ保持（per-track cursor で先頭から）
    assert.equal("at" in cuts[2], false);
    assert.equal(cuts[2].track, 2);
    // 従来の正規化（src 既定・数値化・transition_out・id）は不変
    assert.equal(cuts[3].src, "base");
    assert.equal(cuts[3].id, "cut-3");
    assert.deepEqual(cuts[3].transition_out, { type: "dissolve", duration: 0.5 });
    assert.equal("track" in cuts[3], false);
  });
}
