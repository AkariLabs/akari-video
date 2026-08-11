import assert from "node:assert/strict";
import test from "node:test";

import { sourceCutRuns, sourceTimeToTimeline, runsInTimelineOrder } from "../src/eye-bar/time-map.mjs";

test("time-map: 単純カット（at/track 無し）は逐次配置される", () => {
  const cuts = [{ in: 0, out: 5 }, { in: 10, out: 15 }];
  const runs = sourceCutRuns(cuts);
  assert.deepEqual(
    runs.map((r) => ({ outStart: r.outStart, outEnd: r.outEnd, srcIn: r.srcIn, srcOut: r.srcOut })),
    [
      { outStart: 0, outEnd: 5, srcIn: 0, srcOut: 5 },
      { outStart: 5, outEnd: 10, srcIn: 10, srcOut: 15 },
    ],
  );
});

test("time-map: source 秒 → タイムライン秒（2 カット目の途中）", () => {
  const cuts = [{ in: 0, out: 5 }, { in: 10, out: 15 }];
  const runs = sourceCutRuns(cuts);
  // source 12 秒（2 カット目の in=10 から 2 秒後）→ タイムライン上は 5(1カット目の尺)+2=7 秒
  assert.deepEqual(sourceTimeToTimeline(runs, 12), [7]);
  // 1 カット目の範囲外（source 7 秒はどのカットにも含まれない）
  assert.deepEqual(sourceTimeToTimeline(runs, 7), []);
});

test("time-map: speed 2 倍のカットは半分の時間で消費される", () => {
  const cuts = [{ in: 0, out: 6, speed: 2 }, { in: 10, out: 14 }];
  const runs = sourceCutRuns(cuts);
  // 1 カット目: source 6 秒分が timeline 3 秒分（speed=2）
  assert.deepEqual(
    runs.map((r) => ({ outStart: r.outStart, outEnd: r.outEnd })),
    [{ outStart: 0, outEnd: 3 }, { outStart: 3, outEnd: 7 }],
  );
  // source 3 秒（speed=2 のカット内）→ timeline 1.5 秒
  assert.deepEqual(sourceTimeToTimeline(runs, 3), [1.5]);
});

test("time-map: at/track によるギャップ対応タイムライン（gap-aware 経路）", () => {
  const cuts = [{ in: 0, out: 5 }, { at: 8, in: 10, out: 15 }];
  const runs = sourceCutRuns(cuts);
  assert.deepEqual(
    runs.map((r) => ({ outStart: r.outStart, outEnd: r.outEnd, srcIn: r.srcIn, srcOut: r.srcOut })),
    [
      { outStart: 0, outEnd: 5, srcIn: 0, srcOut: 5 },
      { outStart: 8, outEnd: 13, srcIn: 10, srcOut: 15 },
    ],
  );
  // source 12 秒（2 カット目の in=10 から 2 秒後）→ outStart=8 から 2 秒後 = 10 秒
  assert.deepEqual(sourceTimeToTimeline(runs, 12), [10]);
});

test("time-map: 別 source の高位トラックに隠れた区間は対象 source の run から除かれる（occlusion）", () => {
  // v1（複数 source）: track1 の別 source カットが 3〜6 秒だけ track0（対象 source "main"）を覆う。
  const cuts = [
    { src: "main", in: 0, out: 10, track: 0 },
    { src: "other", in: 100, out: 103, at: 3, track: 1 },
  ];
  const runs = sourceCutRuns(cuts, "main");
  // "main" のカットは [0,3) と [6,10) の 2 断片に分かれる（3〜6 秒は "other" に隠れて run に出ない）
  assert.deepEqual(
    runs.map((r) => ({ outStart: r.outStart, outEnd: r.outEnd })),
    [{ outStart: 0, outEnd: 3 }, { outStart: 6, outEnd: 10 }],
  );
  // 隠れた区間（"main" の source 4 秒相当）はどの run にも属さない
  assert.deepEqual(sourceTimeToTimeline(runs, 4), []);
  // "other" 側で見れば、その区間は当然 1 run として拾える
  const otherRuns = sourceCutRuns(cuts, "other");
  assert.deepEqual(otherRuns.map((r) => ({ outStart: r.outStart, outEnd: r.outEnd })), [{ outStart: 3, outEnd: 6 }]);
});

test("time-map: sourceId で v1 の src 一致だけを拾う", () => {
  const cuts = [
    { src: "a", in: 0, out: 5 },
    { src: "b", in: 0, out: 3 },
  ];
  const runsA = sourceCutRuns(cuts, "a");
  const runsB = sourceCutRuns(cuts, "b");
  assert.equal(runsA.length, 1);
  assert.equal(runsA[0].cut.src, "a");
  assert.equal(runsB.length, 1);
  assert.equal(runsB[0].cut.src, "b");
});

test("time-map: runsInTimelineOrder は outStart 昇順に並べ替える", () => {
  const runs = [{ outStart: 5 }, { outStart: 1 }, { outStart: 3 }];
  assert.deepEqual(runsInTimelineOrder(runs).map((r) => r.outStart), [1, 3, 5]);
});
