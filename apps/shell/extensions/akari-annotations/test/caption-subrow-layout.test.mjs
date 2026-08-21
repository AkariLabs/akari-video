import assert from "node:assert/strict";
import test from "node:test";

import { computeCaptionSubrowLayout } from "../lib/common/caption-subrow-layout.js";

test("段割りと描画が同じ output 区間を見る", () => {
  const sourceRanges = new Map([
    ["0:1", [[10, 12]]],
    ["2:3", [[11, 13]]],
  ]);
  const layout = computeCaptionSubrowLayout(
    [
      { id: "first", start: 0, end: 1 },
      { id: "second", start: 2, end: 3 },
    ],
    0.15,
    (start, end) => sourceRanges.get(`${start}:${end}`) ?? [],
  );

  assert.deepEqual(layout.get("first"), { start: 10, end: 12, row: 0 });
  assert.deepEqual(layout.get("second"), { start: 11, end: 13, row: 1 });
});

test("MINIMUM_ITEM_DURATION で伸ばした区間を output 変換と段割りの両方に使う", () => {
  const convertedSourceRanges = [];
  const layout = computeCaptionSubrowLayout(
    [
      { id: "short", start: 1, end: 1.01 },
      { id: "following", start: 1.1, end: 1.3 },
    ],
    0.15,
    (start, end) => {
      convertedSourceRanges.push([start, end]);
      return [[start, end]];
    },
  );

  assert.deepEqual(convertedSourceRanges, [[1, 1.15], [1.1, 1.3]]);
  assert.deepEqual(layout.get("short"), { start: 1, end: 1.15, row: 0 });
  assert.deepEqual(layout.get("following"), { start: 1.1, end: 1.3, row: 1 });
});

test("削除区間へ完全に落ちた字幕を除いても残りの字幕の段はずれない", () => {
  const captions = [
    { id: "first", start: 0, end: 2 },
    { id: "deleted", start: 2, end: 3 },
    { id: "second", start: 4, end: 6 },
  ];
  const convert = (start, end) => {
    if (start === 2) {
      return [];
    }
    if (start === 0) {
      return [[0, 5]];
    }
    return [[4, 6]];
  };

  const withDeletedCaption = computeCaptionSubrowLayout(captions, 0.15, convert);
  const withoutDeletedCaption = computeCaptionSubrowLayout(
    captions.filter(caption => caption.id !== "deleted"),
    0.15,
    convert,
  );

  assert.equal(withDeletedCaption.has("deleted"), false);
  assert.deepEqual(
    [...withDeletedCaption.entries()],
    [...withoutDeletedCaption.entries()],
  );
  assert.equal(withDeletedCaption.get("second").row, 1);
});

test("複数 output 区間に分かれる字幕は描画契約どおり最初から最後までの 1 本の帯にする", () => {
  const layout = computeCaptionSubrowLayout(
    [{ id: "split", start: 2, end: 8 }],
    0.15,
    () => [[20, 22], [22, 25]],
  );

  assert.deepEqual(layout.get("split"), { start: 20, end: 25, row: 0 });
});
