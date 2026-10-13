import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from 'node:fs';
import { planTrackTransitions } from '@akari-video/edit-store';

import {
  BOUNDARY_BAND_MIN_WIDTH_PX,
  boundaryBandGeometry,
  mergeTransitionDeclaration,
  placeBoundary,
  primaryBoundaryBlock,
  sameBoundary,
  sourceEdgeMarks
} from "../lib/common/transition-boundary-model.js";

const cases = JSON.parse(readFileSync(new URL('../../../../../packages/edit-store/test/transition-plan-cases.json', import.meta.url), 'utf8'));
const clipOf = clip => ({ id: clip.id, startSeconds: clip.start, lengthSeconds: clip.length,
  headRoomSeconds: clip.head === 'inf' ? Infinity : clip.head,
  tailRoomSeconds: clip.tail === 'inf' ? Infinity : clip.tail === null ? undefined : clip.tail,
  ...(clip.out ? { transitionOut: { declaredSeconds: clip.out.declared, align: clip.out.align,
    fill: clip.out.fill === true } } : {}) });

for (const entry of cases.plan) {
  test(`計画から帯の位置: ${entry.name}`, () => {
    const plans = planTrackTransitions(entry.clips.map(clipOf), { fps: entry.fps });
    assert.equal(plans.length, entry.expected.length);
    for (let index = 0; index < plans.length; index++) {
      const plan = plans[index], expected = entry.expected[index];
      const placement = placeBoundary(plan);
      assert.equal(placement.state, expected.state === 'none' ? 'dead' : expected.state);
      assert.equal(placement.legacyOverlap, expected.legacy);
      assert.deepEqual(placement.reasons, expected.reasons);
      assert.ok(Math.abs(placement.effectiveSeconds - expected.effective) < 1e-9);
      assert.ok(Math.abs(plan.cutSeconds + placement.startOffsetSeconds - expected.start) < 1e-9);
      assert.ok(Math.abs(plan.cutSeconds + placement.endOffsetSeconds - expected.end) < 1e-9);
      const geometry = boundaryBandGeometry(placement, 100);
      const center = ((expected.start + expected.end) / 2 - plan.cutSeconds) * 100;
      assert.ok(Math.abs(geometry.leftPx + geometry.widthPx / 2 - center) < 1e-9);
      assert.ok(geometry.cutPx >= 0 && geometry.cutPx <= geometry.widthPx);
    }
  });
}

test('宣言があっても描かれない境目は効かない', () => {
  assert.equal(placeBoundary(undefined).state, 'dead');
  assert.equal(placeBoundary(undefined).effectiveSeconds, 0);
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
  const planFor = declared => planTrackTransitions([
    { id: 'a', startSeconds: 0, lengthSeconds: 4, headRoomSeconds: 5, tailRoomSeconds: 5,
      transitionOut: { declaredSeconds: declared, align: 'center', fill: false } },
    { id: 'b', startSeconds: 4, lengthSeconds: 4, headRoomSeconds: 5, tailRoomSeconds: 5 }
  ], { fps: 30 })[0];
  const wide = boundaryBandGeometry(placeBoundary(planFor(1)), 100);
  assert.deepEqual(wide, { leftPx: -50, widthPx: 100, cutPx: 50, freezeIncomingPx: 0, freezeOutgoingPx: 0 });

  const narrow = boundaryBandGeometry(placeBoundary(planFor(0.1)), 100);
  assert.equal(narrow.widthPx, BOUNDARY_BAND_MIN_WIDTH_PX);
  assert.equal(narrow.leftPx, -BOUNDARY_BAND_MIN_WIDTH_PX / 2);
  assert.equal(narrow.cutPx, BOUNDARY_BAND_MIN_WIDTH_PX / 2);
});

test("帯はカット点の片側だけの窓と止め絵の幅も描ける", () => {
  const beforeCut = boundaryBandGeometry({
    effectiveSeconds: 1, startOffsetSeconds: -1, endOffsetSeconds: 0,
    freezeOutgoingSeconds: 0, freezeIncomingSeconds: 0.25, state: "ok"
  }, 100);
  assert.deepEqual(beforeCut, { leftPx: -100, widthPx: 100, cutPx: 98, freezeIncomingPx: 25, freezeOutgoingPx: 0 });

  const afterCut = boundaryBandGeometry({
    effectiveSeconds: 1, startOffsetSeconds: 0, endOffsetSeconds: 1,
    freezeOutgoingSeconds: 0.5, freezeIncomingSeconds: 0, state: "ok"
  }, 100);
  assert.deepEqual(afterCut, { leftPx: 0, widthPx: 100, cutPx: 2, freezeIncomingPx: 0, freezeOutgoingPx: 50 });
  const centered = boundaryBandGeometry({
    effectiveSeconds: 1, startOffsetSeconds: -0.5, endOffsetSeconds: 0.5,
    freezeOutgoingSeconds: 0, freezeIncomingSeconds: 0, state: 'ok'
  }, 100);
  assert.equal(centered.cutPx, 50);
  for (const geometry of [beforeCut, centered, afterCut]) {
    assert.ok(geometry.cutPx >= 2 && geometry.cutPx <= geometry.widthPx - 2);
  }
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
