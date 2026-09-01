import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clipEdgeZonePx,
  planChipHitPadding,
  planInitialVisualTrackScroll,
  resolveTimelineEdgeMode,
} from '../lib/browser/timeline-chip-hit-area.js';

test('細いチップは空き区間の中点まで広げ、隣の当たり領域を奪わない', () => {
  const plans = planChipHitPadding([
    { group: 'cuts|0px', leftPercent: 0, widthPercent: 1 },
    { group: 'cuts|0px', leftPercent: 2, widthPercent: 1 },
    { group: 'cuts|0px', leftPercent: 4, widthPercent: 1 },
  ], { containerWidthPx: 1000, minHitWidthPx: 24 });

  assert.deepEqual(plans, [
    { padLeftPx: 7, padRightPx: 5 },
    { padLeftPx: 5, padRightPx: 5 },
    { padLeftPx: 5, padRightPx: 7 },
  ]);
});

test('重なった隣接方向は拡張せず、別レーンのチップは互いに制約しない', () => {
  const plans = planChipHitPadding([
    { group: 'cuts|0px', leftPercent: 10, widthPercent: 2 },
    { group: 'cuts|0px', leftPercent: 11, widthPercent: 2 },
    { group: 'cuts|40px', leftPercent: 11, widthPercent: 2 },
  ], { containerWidthPx: 100, minHitWidthPx: 8 });

  assert.deepEqual(plans, [
    { padLeftPx: 3, padRightPx: 0 },
    { padLeftPx: 0, padRightPx: 3 },
    { padLeftPx: 3, padRightPx: 3 },
  ]);
});

test('拡張チップは左右トリムと move の 3 領域を持ち、通常幅は従来の 6px を保つ', () => {
  assert.equal(clipEdgeZonePx(24, false, 6, 8), 6);
  assert.equal(clipEdgeZonePx(24, true, 6, 8), 8);
  assert.equal(clipEdgeZonePx(13.8, true, 6, 8), 4);
  assert.equal(resolveTimelineEdgeMode(3, 13.8, 4), 'start');
  assert.equal(resolveTimelineEdgeMode(6.9, 13.8, 4), 'move');
  assert.equal(resolveTimelineEdgeMode(11, 13.8, 4), 'end');
});

test('初期縦位置は visual レーンを余白付きで表示し、収まる場合は変更しない', () => {
  assert.equal(planInitialVisualTrackScroll({
    stripHeightPx: 1200, viewportHeightPx: 295, laneTopPx: 277, laneHeightPx: 72,
  }), 269);
  assert.equal(planInitialVisualTrackScroll({
    stripHeightPx: 600, viewportHeightPx: 295, laneTopPx: 250, laneHeightPx: 292,
  }), 247);
  assert.equal(planInitialVisualTrackScroll({
    stripHeightPx: 1200, viewportHeightPx: 295, laneTopPx: 277, laneHeightPx: 320,
  }), 277);
  assert.equal(planInitialVisualTrackScroll({
    stripHeightPx: 200, viewportHeightPx: 295, laneTopPx: 50, laneHeightPx: 72,
  }), undefined);
});
