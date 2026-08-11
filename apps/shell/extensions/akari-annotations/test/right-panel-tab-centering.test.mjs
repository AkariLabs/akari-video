import assert from "node:assert/strict";
import test from "node:test";

import {
  computeReviewTabMarginTop,
  FALLBACK_TAB_HEIGHT_PX,
  MIN_GAP_ABOVE_PX,
  RESERVED_BELOW_PX,
} from "../lib/common/right-panel-tab-centering.js";

test("computeReviewTabMarginTop は既定サイズのウィンドウでタブをバー高の中央付近へ置く（実測 barHeight=646）", () => {
  const margin = computeReviewTabMarginTop({ barHeight: 646, heightAbove: 48, tabHeight: 48 });
  const center = 48 + margin + 24;
  assert.ok(Math.abs(center / 646 - 0.5) < 0.02, `center ratio should be near 50%, got ${center / 646}`);
});

test("computeReviewTabMarginTop は最大化相当の大きいウィンドウでも中央付近を保つ（実測 barHeight=978）", () => {
  const margin = computeReviewTabMarginTop({ barHeight: 978, heightAbove: 48, tabHeight: 48 });
  const center = 48 + margin + 24;
  assert.ok(Math.abs(center / 978 - 0.5) < 0.02, `center ratio should be near 50%, got ${center / 978}`);
});

test("computeReviewTabMarginTop は後続タブ（インスペクター）1 枚分を必ず下に残す", () => {
  const barHeight = 646;
  const heightAbove = 48;
  const tabHeight = 48;
  const margin = computeReviewTabMarginTop({ barHeight, heightAbove, tabHeight });
  const reviewBottom = heightAbove + margin + tabHeight;
  const nextTabBottom = reviewBottom + FALLBACK_TAB_HEIGHT_PX;
  assert.ok(nextTabBottom <= barHeight, `inspector tab must fit without overflow: ${nextTabBottom} <= ${barHeight}`);
});

test("computeReviewTabMarginTop は極小ウィンドウでも既存アイコン群からの最低ギャップを維持する", () => {
  const margin = computeReviewTabMarginTop({ barHeight: 150, heightAbove: 48, tabHeight: 48 });
  assert.equal(margin, MIN_GAP_ABOVE_PX);
});

test("computeReviewTabMarginTop はレイアウト前（barHeight<=0）に 0 を返す", () => {
  assert.equal(computeReviewTabMarginTop({ barHeight: 0, heightAbove: 48, tabHeight: 48 }), 0);
  assert.equal(computeReviewTabMarginTop({ barHeight: -10, heightAbove: 48, tabHeight: 48 }), 0);
});

test("computeReviewTabMarginTop: 大画面から極小画面へ縮めた直後でも新しい margin だけで後続タブが収まる (regression: L1 実測で lm-mod-invisible の張り付きを検出)", () => {
  // 実機 L1 検証で発見した回帰: barHeight=1178（最大化相当）から barHeight=358（極小）へ
  // 一気に縮めると、Lumino 側の SideTabBar.onResize() が margin 再計算前の古い値で
  // hideOverflowingTabs() を走らせ、インスペクタータブに lm-mod-invisible が張り付いたまま
  // 残ることを確認した（right-panel-tab-style.ts の tabBar.update() 強制再判定で解消）。
  // ここでは新しい barHeight に対する margin 自体が独立に正しく収まることを保証する。
  const tinyMargin = computeReviewTabMarginTop({ barHeight: 358, heightAbove: 48, tabHeight: 48 });
  const reviewBottom = 48 + tinyMargin + 48;
  const inspectorBottom = reviewBottom + RESERVED_BELOW_PX - 8; // インスペクターは 48px, gap 無し
  assert.ok(inspectorBottom <= 358, `inspector must fit at tiny barHeight: ${inspectorBottom} <= 358`);
});
