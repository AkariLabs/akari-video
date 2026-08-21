import assert from "node:assert/strict";
import test from "node:test";

import {
  clearNotice,
  dismissNotice,
  EMPTY_NOTICE_BANNER_STATE,
  hasNoticeMessage,
  isNoticeVisible,
  setNoticeMessage,
} from "../lib/common/notice-banner-state.js";

test("文言が無いあいだは帯を出さない", () => {
  assert.equal(isNoticeVisible(EMPTY_NOTICE_BANNER_STATE), false);
  assert.equal(hasNoticeMessage(EMPTY_NOTICE_BANNER_STATE), false);
});

test("文言を設定すると帯が出る", () => {
  const state = setNoticeMessage(EMPTY_NOTICE_BANNER_STATE, "ffmpeg が見つかりません");
  assert.equal(isNoticeVisible(state), true);
  assert.equal(hasNoticeMessage(state), true);
});

test("× で閉じたら帯が消える", () => {
  const shown = setNoticeMessage(EMPTY_NOTICE_BANNER_STATE, "ffmpeg が見つかりません");
  assert.equal(isNoticeVisible(dismissNotice(shown)), false);
});

test("× で閉じた後に同じ文言で再描画されても復活しない（これが無いと × が無意味になる）", () => {
  const dismissed = dismissNotice(setNoticeMessage(EMPTY_NOTICE_BANNER_STATE, "ffmpeg が見つかりません"));
  const redrawn = setNoticeMessage(dismissed, "ffmpeg が見つかりません");
  assert.equal(isNoticeVisible(redrawn), false);
});

test("× で閉じた後も hasMessage は true（既存通知を別の通知で上書きしないため）", () => {
  const dismissed = dismissNotice(setNoticeMessage(EMPTY_NOTICE_BANNER_STATE, "ffmpeg が見つかりません"));
  assert.equal(hasNoticeMessage(dismissed), true);
});

test("別の文言なら閉じた後でも出る", () => {
  const dismissed = dismissNotice(setNoticeMessage(EMPTY_NOTICE_BANNER_STATE, "ffmpeg が見つかりません"));
  const next = setNoticeMessage(dismissed, "素材の実尺が取得できません");
  assert.equal(isNoticeVisible(next), true);
});

test("警告が解消（clear）したら閉じた記憶も捨て、同じ文言が再発したときは改めて出す", () => {
  const dismissed = dismissNotice(setNoticeMessage(EMPTY_NOTICE_BANNER_STATE, "ffmpeg が見つかりません"));
  assert.equal(hasNoticeMessage(dismissed), true);
  const cleared = clearNotice();
  assert.equal(isNoticeVisible(cleared), false);
  assert.equal(hasNoticeMessage(cleared), false);
  const again = setNoticeMessage(cleared, "ffmpeg が見つかりません");
  assert.equal(isNoticeVisible(again), true);
});

test("文言が無い状態で × を押しても状態は変わらない", () => {
  assert.deepEqual(dismissNotice(EMPTY_NOTICE_BANNER_STATE), EMPTY_NOTICE_BANNER_STATE);
});

test("setNoticeMessage は入力を書き換えない（純関数）", () => {
  const before = setNoticeMessage(EMPTY_NOTICE_BANNER_STATE, "A");
  const snapshot = { ...before };
  setNoticeMessage(before, "B");
  assert.deepEqual(before, snapshot);
});
