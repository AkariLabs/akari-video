import assert from "node:assert/strict";
import test from "node:test";

import { resolveTimelineExtentSeconds } from "../lib/common/timeline-extent.js";

test("全体表示の10秒には10%の余白を加える", () => {
  assert.equal(resolveTimelineExtentSeconds(10, undefined), 11);
});

test("全体表示の5秒には最低1秒の余白を加える", () => {
  assert.equal(resolveTimelineExtentSeconds(5, undefined), 6);
});

test("空の全体表示にも最低1秒を確保する", () => {
  assert.equal(resolveTimelineExtentSeconds(0, undefined), 1);
});

test("ズーム中は表示幅の半分を右余白にする", () => {
  assert.equal(resolveTimelineExtentSeconds(10, 4), 12);
});

test("ズーム中の右余白はコンテンツ終端の2%を下回らない", () => {
  assert.equal(resolveTimelineExtentSeconds(10, 0.2), 10.2);
});
