import assert from "node:assert/strict";
import test from "node:test";

import {
  BOUNDARY_BAND_MIN_WIDTH_PX,
  boundaryBandGeometry,
  mergeTransitionDeclaration,
  placeBoundary,
  primaryBoundaryBlock,
  sameBoundary,
  sourceEdgeMarks
} from "../lib/common/transition-boundary-model.js";

const room = { outgoingTailRoomSeconds: 5, incomingHeadRoomSeconds: 5, outgoingDurationSeconds: 4, incomingDurationSeconds: 4 };

test("余りが足りればカット点を中心に宣言どおりの窓を返す", () => {
  assert.deepEqual(placeBoundary({ declaredSeconds: 0.5, ...room }), {
    effectiveSeconds: 0.5, startOffsetSeconds: -0.25, endOffsetSeconds: 0.25,
    freezeOutgoingSeconds: 0, freezeIncomingSeconds: 0, state: "ok"
  });
});

test("余りが足りなければ短くなり、余りが無ければ効かない（描画と同じ規則）", () => {
  const shortened = placeBoundary({ declaredSeconds: 1, ...room, incomingHeadRoomSeconds: 0.2 });
  assert.equal(shortened.state, "shortened");
  assert.equal(shortened.effectiveSeconds, 0.4);
  assert.equal(shortened.startOffsetSeconds, -0.2);
  assert.equal(shortened.endOffsetSeconds, 0.2);

  const dead = placeBoundary({ declaredSeconds: 1, ...room, outgoingTailRoomSeconds: 0 });
  assert.equal(dead.state, "dead");
  assert.equal(dead.effectiveSeconds, 0);
  assert.equal(Object.is(dead.startOffsetSeconds, 0), true);
});

test("余りが分からない（無限）ときは短くしない", () => {
  const placement = placeBoundary({
    declaredSeconds: 0.5, ...room,
    outgoingTailRoomSeconds: Number.POSITIVE_INFINITY, incomingHeadRoomSeconds: Number.POSITIVE_INFINITY
  });
  assert.equal(placement.state, "ok");
  assert.equal(placement.effectiveSeconds, 0.5);
});

test("実際に重なっている古い形の境目は、後のクリップの始まりから重なりの終わりまでが窓", () => {
  // 後のクリップの in が 0（頭の余りなし）でも、重なりで保存されていれば窓はある
  const legacy = { ...room, incomingHeadRoomSeconds: 0 };
  assert.deepEqual(placeBoundary({ declaredSeconds: 0.5, ...legacy, actualOverlapSeconds: 0.5 }), {
    effectiveSeconds: 0.5, startOffsetSeconds: 0, endOffsetSeconds: 0.5,
    freezeOutgoingSeconds: 0, freezeIncomingSeconds: 0, state: "ok"
  });
  const shorter = placeBoundary({ declaredSeconds: 1, ...legacy, actualOverlapSeconds: 0.4 });
  assert.equal(shorter.state, "shortened");
  assert.equal(shorter.endOffsetSeconds, 0.4);
  // 宣言より長い重なりは窓を作らない（描画と同じ）
  assert.equal(placeBoundary({ declaredSeconds: 0.5, ...legacy, actualOverlapSeconds: 0.8 }).state, "dead");
  // 0 以下は突き合わせとして扱う
  assert.equal(placeBoundary({ declaredSeconds: 0.5, ...room, actualOverlapSeconds: 0 }).startOffsetSeconds, -0.25);
});

test("宣言の書き換えは種類と尺だけを差し替え、知らない項目を残す", () => {
  assert.deepEqual(
    mergeTransitionDeclaration({ type: "future-kind", duration: 1, align: "before-cut", extra: { a: 1 } }, { type: "fade", duration: 0.5 }),
    { type: "fade", duration: 0.5, align: "before-cut", extra: { a: 1 } }
  );
  assert.deepEqual(mergeTransitionDeclaration(undefined, { type: "fade", duration: 0.5 }), { type: "fade", duration: 0.5 });
  assert.deepEqual(mergeTransitionDeclaration(null, { type: "fade", duration: 0.5 }), { type: "fade", duration: 0.5 });
});

test("帯は窓の長さに比例し、最小幅より狭いときは中心を保って広げる", () => {
  const wide = boundaryBandGeometry(placeBoundary({ declaredSeconds: 1, ...room }), 100);
  assert.deepEqual(wide, { leftPx: -50, widthPx: 100, cutPx: 50, freezeIncomingPx: 0, freezeOutgoingPx: 0 });

  const narrow = boundaryBandGeometry(placeBoundary({ declaredSeconds: 0.1, ...room }), 100);
  assert.equal(narrow.widthPx, BOUNDARY_BAND_MIN_WIDTH_PX);
  assert.equal(narrow.leftPx, -BOUNDARY_BAND_MIN_WIDTH_PX / 2);
  assert.equal(narrow.cutPx, BOUNDARY_BAND_MIN_WIDTH_PX / 2);
});

test("帯はカット点の片側だけの窓と止め絵の幅も描ける", () => {
  const beforeCut = boundaryBandGeometry({
    effectiveSeconds: 1, startOffsetSeconds: -1, endOffsetSeconds: 0,
    freezeOutgoingSeconds: 0, freezeIncomingSeconds: 0.25, state: "ok"
  }, 100);
  assert.deepEqual(beforeCut, { leftPx: -100, widthPx: 100, cutPx: 100, freezeIncomingPx: 25, freezeOutgoingPx: 0 });

  const afterCut = boundaryBandGeometry({
    effectiveSeconds: 1, startOffsetSeconds: 0, endOffsetSeconds: 1,
    freezeOutgoingSeconds: 0.5, freezeIncomingSeconds: 0, state: "ok"
  }, 100);
  assert.deepEqual(afterCut, { leftPx: 0, widthPx: 100, cutPx: 0, freezeIncomingPx: 0, freezeOutgoingPx: 50 });
});

test("三角は素材の端と半コマ以内で一致したときだけ出る", () => {
  assert.deepEqual(
    sourceEdgeMarks({ inSeconds: 0, outSeconds: 10, sourceDurationSeconds: 10 }),
    { atSourceStart: true, atSourceEnd: true }
  );
  assert.deepEqual(
    sourceEdgeMarks({ inSeconds: 0.5, outSeconds: 9.5, sourceDurationSeconds: 10 }),
    { atSourceStart: false, atSourceEnd: false }
  );
  assert.deepEqual(
    sourceEdgeMarks({ inSeconds: 0.01, outSeconds: 9.99, sourceDurationSeconds: 10, sourceFps: 30 }),
    { atSourceStart: true, atSourceEnd: true }
  );
  assert.deepEqual(
    sourceEdgeMarks({ inSeconds: 0.01, outSeconds: 9.99, sourceDurationSeconds: 10, sourceFps: 120 }),
    { atSourceStart: false, atSourceEnd: false }
  );
});

test("素材の長さが分からないときと静止画には三角を出さない", () => {
  const none = { atSourceStart: false, atSourceEnd: false };
  assert.deepEqual(sourceEdgeMarks({ inSeconds: 0, outSeconds: 10, sourceDurationSeconds: undefined }), none);
  assert.deepEqual(sourceEdgeMarks({ inSeconds: 0, outSeconds: 10, sourceDurationSeconds: Number.NaN }), none);
  assert.deepEqual(sourceEdgeMarks({ inSeconds: 0, outSeconds: 3, sourceDurationSeconds: 3, still: true }), none);
});

test("境目は前後の item ID の組で比べ、理由は決まった順で 1 つ選ぶ", () => {
  const a = { earlierItemId: "a", laterItemId: "b" };
  assert.equal(sameBoundary(a, { earlierItemId: "a", laterItemId: "b" }), true);
  assert.equal(sameBoundary(a, { earlierItemId: "a", laterItemId: "c" }), false);
  assert.equal(sameBoundary(a, undefined), false);
  assert.equal(primaryBoundaryBlock(["locked", "gap"]), "gap");
  assert.equal(primaryBoundaryBlock(["locked", "multi-track"]), "multi-track");
  assert.equal(primaryBoundaryBlock([]), undefined);
});

test("置き方と埋め方は、省けば保ち、null で項目ごと消す", () => {
  const existing = { type: "fade", duration: 1, align: "after-cut", fill: "freeze", future: 1 };
  assert.deepEqual(mergeTransitionDeclaration(existing, { type: "dissolve", duration: 0.5 }),
    { type: "dissolve", duration: 0.5, align: "after-cut", fill: "freeze", future: 1 });
  assert.deepEqual(mergeTransitionDeclaration(existing, { type: "fade", duration: 1, align: null }),
    { type: "fade", duration: 1, fill: "freeze", future: 1 });
  assert.deepEqual(mergeTransitionDeclaration(existing, { type: "fade", duration: 1, align: "before-cut", fill: null }),
    { type: "fade", duration: 1, align: "before-cut", future: 1 });
  assert.deepEqual(mergeTransitionDeclaration({ type: "fade", duration: 1, align: "future-side" },
    { type: "wipe-left", duration: 1 }), { type: "wipe-left", duration: 1, align: "future-side" });
  assert.deepEqual(mergeTransitionDeclaration(undefined, { type: "fade", duration: 1, align: null }),
    { type: "fade", duration: 1 });
});
