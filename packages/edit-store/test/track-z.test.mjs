import assert from "node:assert/strict";
import test from "node:test";

import {
  collectTrackZByItemId,
  resolveCaptionTrackZ,
  resolveDeclaredCaptionTrackZ,
  resolveRecordTrackZ,
} from "../lib/index.js";

test("collectTrackZByItemId は入れ子を含む item id を最初に現れた段へ対応づける", () => {
  const tracks = [
    { items: [{ id: "back", children: [{ id: "nested", children: [{ id: "deep" }] }] }] },
    { items: [{ id: "front", items: [{ id: "raw-child" }] }, { id: "nested" }] },
  ];
  assert.deepEqual([...collectTrackZByItemId(tracks)], [
    ["back", 0],
    ["nested", 0],
    ["deep", 0],
    ["front", 1],
    ["raw-child", 1],
  ]);
});

test("字幕段の z は袋形・旧 content 形・legacy 形を配列順から解決する", () => {
  assert.equal(resolveDeclaredCaptionTrackZ([
    { items: [{ id: "html", source: { kind: "html" } }] },
    { items: [{ id: "captions", source: { kind: "captions" } }] },
  ]), 1);
  assert.equal(resolveDeclaredCaptionTrackZ([
    { items: [] },
    { content: { from: "captions.json" }, items: [] },
  ]), 1);
  assert.equal(resolveDeclaredCaptionTrackZ([
    { legacy: { kind: "overlays" }, items: [] },
    { legacy: { kind: "captions" }, items: [] },
  ]), 1);
});

test("字幕段が未宣言なら暗黙段を最前面へ足した z を返す", () => {
  const tracks = [{ items: [] }, { items: [] }];
  assert.equal(resolveDeclaredCaptionTrackZ(tracks), null);
  assert.equal(resolveCaptionTrackZ(tracks), 2);
});

test("resolveRecordTrackZ は id・parentId・袋の合成 id の順に段 z を解決する", () => {
  const zById = new Map([["direct", 3], ["parent", 2], ["bag", 1]]);
  assert.equal(resolveRecordTrackZ(zById, { id: "direct", parentId: "parent" }), 3);
  assert.equal(resolveRecordTrackZ(zById, { id: "missing", parentId: "parent" }), 2);
  assert.equal(resolveRecordTrackZ(zById, { id: "bag#part" }), 1);
  assert.equal(resolveRecordTrackZ(zById, { id: "missing" }), 0);
});
