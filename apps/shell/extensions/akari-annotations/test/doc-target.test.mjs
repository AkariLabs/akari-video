import assert from "node:assert/strict";
import test from "node:test";

import {
  parseDocTarget,
  parseImageTarget,
  collectBlockIds,
  extractBlocksManifest,
} from "../lib/common/doc-target.js";

test("parseDocTarget は doc:<path>#<block-id> をパースする", () => {
  const parsed = parseDocTarget("doc:.akari/reports/analysis-report.html#asset-facts:clip-01");
  assert.deepEqual(parsed, { path: ".akari/reports/analysis-report.html", blockId: "asset-facts:clip-01" });
});

test("parseDocTarget は doc: 以外・null・# 無しを undefined にする", () => {
  assert.equal(parseDocTarget(null), undefined);
  assert.equal(parseDocTarget("overlay:title-1"), undefined);
  assert.equal(parseDocTarget("doc:no-fragment.html"), undefined);
});

test("parseImageTarget は image:<path> をパースする", () => {
  assert.deepEqual(parseImageTarget("image:assets/thumbnails/candidate-1.png"), {
    path: "assets/thumbnails/candidate-1.png",
  });
  assert.equal(parseImageTarget("doc:foo.html#bar"), undefined);
});

test("collectBlockIds はマニフェストの形状に依存せず文字列の葉を全数集める", () => {
  const manifest = {
    version: 0,
    byRef: {
      "clip-01": {
        timeline: "asset-timeline:clip-01",
        facts: "asset-facts:clip-01",
        chapters: { unchaptered: "transcript-chapter:clip-01:unchaptered" },
        images: { "keyframes/kf-01.jpg": "image:clip-01:keyframes%2Fkf-01.jpg" },
        relations: {},
      },
    },
    questions: { "oq-01": "question:oq-01" },
    provenance: "provenance:section",
  };
  const ids = collectBlockIds(manifest);
  // timeline / facts / chapters.unchaptered / images["kf-01.jpg"] / questions["oq-01"] / provenance = 6
  // （version は数値なので対象外・relations は空 object なので寄与しない）。
  assert.equal(ids.size, 6);
  assert.ok(ids.has("asset-facts:clip-01"));
  assert.ok(ids.has("question:oq-01"));
  assert.ok(ids.has("provenance:section"));
});

test("extractBlocksManifest は script タグの中身を JSON として取り出す", () => {
  const html = `<!doctype html><html><head>
    <script type="application/json" id="akari-analysis-report-blocks">{"version":0,"provenance":"provenance:section"}</script>
  </head><body></body></html>`;
  const manifest = extractBlocksManifest(html);
  assert.deepEqual(manifest, { version: 0, provenance: "provenance:section" });
});

test("extractBlocksManifest はタグが無ければ undefined を返す", () => {
  assert.equal(extractBlocksManifest("<html><body>no manifest here</body></html>"), undefined);
});
