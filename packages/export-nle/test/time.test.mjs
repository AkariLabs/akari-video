import test from "node:test";
import assert from "node:assert/strict";
import { frameDuration, fcpTime, fcpFrameDuration, toFrames, srtTime, xmemlRate } from "../src/time.mjs";

test("frameDuration: NTSC 系は 1001 系有理数へ", () => {
  assert.deepEqual(frameDuration(29.97), { numerator: 1001, denominator: 30000 });
  assert.deepEqual(frameDuration(23.976), { numerator: 1001, denominator: 24000 });
  assert.deepEqual(frameDuration(59.94), { numerator: 1001, denominator: 60000 });
});

test("frameDuration: 整数 fps は 1/fps", () => {
  assert.deepEqual(frameDuration(30), { numerator: 1, denominator: 30 });
  assert.deepEqual(frameDuration(24), { numerator: 1, denominator: 24 });
});

test("fcpTime: フレーム境界へ量子化して約分する", () => {
  const fd30 = frameDuration(30);
  assert.equal(fcpTime(0, fd30), "0s");
  assert.equal(fcpTime(5, fd30), "5s");
  assert.equal(fcpTime(1 / 3, fd30), "1/3s");
  assert.equal(fcpTime(3.5, fd30), "7/2s");
  // 30fps のフレーム境界に乗らない値は最近傍フレームへ
  assert.equal(fcpTime(0.034, fd30), "1/30s");
  const ntsc = frameDuration(29.97);
  assert.equal(fcpTime(1001 / 30000, ntsc), "1001/30000s");
  assert.equal(fcpFrameDuration(ntsc), "1001/30000s");
});

test("toFrames: NTSC の丸めがドリフトしない", () => {
  const ntsc = frameDuration(29.97);
  // 60 秒 = 1798.2 フレーム → 1798（29.97 の実フレーム数）
  assert.equal(toFrames(60, ntsc), Math.round((60 * 30000) / 1001));
});

test("srtTime: HH:MM:SS,mmm 形式", () => {
  assert.equal(srtTime(0), "00:00:00,000");
  assert.equal(srtTime(1.5), "00:00:01,500");
  assert.equal(srtTime(3661.042), "01:01:01,042");
});

test("xmemlRate: NTSC は整数 timebase + ntsc TRUE", () => {
  assert.deepEqual(xmemlRate(29.97), { timebase: 30, ntsc: true });
  assert.deepEqual(xmemlRate(23.976), { timebase: 24, ntsc: true });
  assert.deepEqual(xmemlRate(30), { timebase: 30, ntsc: false });
  assert.deepEqual(xmemlRate(25), { timebase: 25, ntsc: false });
});
