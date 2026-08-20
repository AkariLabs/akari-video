import assert from "node:assert/strict";
import test from "node:test";

import { enableWindowExpr } from "../src/enable-window.mjs";

// 2026-08-14 回帰: 表示区間はかつて ffmpeg の between（閉区間）で書かれており、
// duration がフレーム格子にちょうど乗ると次のクリップの先頭フレームへ 1 フレーム漏れていた。
// 実測: 30fps・t=1.0・duration=3.4（= 102 フレーム）の窓の後ろに実コンテンツを続けると
// 103 フレーム描画され、t=4.4（次カットの最初のフレーム）にまでレイヤーが出ていた。
// 境界の帰属を一意にするため半開区間 [start, end) を唯一の定義とする。

test("enableWindowExpr: 半開区間 [start, end) を返す（閉区間 between は使わない）", () => {
  const expr = enableWindowExpr(1, 4.4, 30);
  assert.equal(expr, "gte(t,0.9833333333333333)*lt(t,4.383333333333334)");
  assert.doesNotMatch(expr, /between/);
});

test("enableWindowExpr: 終端のフレームは含まれず、次のクリップへ渡る", () => {
  const fps = 30;
  const start = 1;
  const duration = 3.4; // ちょうど 102 フレーム。閉区間だとここで漏れていた
  const end = start + duration;
  const expr = enableWindowExpr(start, end, fps);

  // 式を JS の述語として評価し、フレーム時刻で境界の帰属を確かめる
  const active = (t) => {
    const [, lo, hi] = expr.match(/^gte\(t,([^\)]+)\)\*lt\(t,([^\)]+)\)$/).map(Number);
    return t >= lo && t < hi;
  };

  const frameAt = (index) => index / fps;
  const firstFrame = Math.round(start * fps); // 30
  const lastFrame = Math.round(end * fps) - 1; // 131
  const nextClipFirstFrame = Math.round(end * fps); // 132

  assert.equal(active(frameAt(firstFrame - 1)), false, "開始の 1 つ前は出ない");
  assert.equal(active(frameAt(firstFrame)), true, "開始フレームは出る");
  assert.equal(active(frameAt(lastFrame)), true, "最終フレームは出る");
  assert.equal(
    active(frameAt(nextClipFirstFrame)),
    false,
    "次クリップの先頭フレームへ漏れない（閉区間のときここが true だった）",
  );

  // 描画されるフレーム数がちょうど duration ぶんであること
  let drawn = 0;
  for (let index = 0; index <= nextClipFirstFrame + 2; index += 1) {
    if (active(frameAt(index))) drawn += 1;
  }
  assert.equal(drawn, Math.round(duration * fps), "102 フレーム（閉区間では 103 になっていた）");
});

test("enableWindowExpr: 隣接するクリップ列が重ならない", () => {
  const windows = [
    [0, 3.4],
    [3.4, 7.7],
    [7.7, 11.6333],
  ];
  const predicates = windows.map(([start, end]) => {
    const [, lo, hi] = enableWindowExpr(start, end, 30)
      .match(/^gte\(t,([^\)]+)\)\*lt\(t,([^\)]+)\)$/)
      .map(Number);
    return (t) => t >= lo && t < hi;
  });
  for (const boundary of [3.4, 7.7]) {
    const activeCount = predicates.filter((predicate) => predicate(boundary)).length;
    assert.equal(activeCount, 1, `境界 ${boundary}s でちょうど 1 つのクリップだけが有効`);
  }
});

test("enableWindowExpr: 30fps の 77 フレーム境界を ffmpeg の時刻計算でも取りこぼさない", () => {
  const fps = 30;
  const expr = enableWindowExpr(77 / fps, 154 / fps, fps);
  const [, lo, hi] = expr.match(/^gte\(t,([^\)]+)\)\*lt\(t,([^\)]+)\)$/).map(Number);
  const active = (frame) => {
    const t = frame * (1 / fps);
    return t >= lo && t < hi;
  };

  // 旧実装の秒しきい値 gte(t,2.566666666666667) では、ffmpeg と同じ計算の
  // frame 77 = 77 * (1/30) = 2.5666666666666664 が false になっていた。
  assert.equal(active(76), false, "開始直前のフレーム 76 は含まない");
  assert.equal(active(77), true, "開始フレーム 77 を含む");
  assert.equal(active(153), true, "終端直前のフレーム 153 を含む");
  assert.equal(active(154), false, "終端フレーム 154 は含まない");
});

test("enableWindowExpr: fps は正の有限数を必須とする", () => {
  for (const fps of [undefined, 0, Number.NaN, -30]) {
    assert.throws(
      () => enableWindowExpr(0, 1, fps),
      { name: "TypeError" },
      `fps=${String(fps)} は拒否する`,
    );
  }
});
