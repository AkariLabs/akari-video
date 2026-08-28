import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCaptionWordTiles,
  captionRevealGroupStateAt,
  captionWordTextureRect,
  captionWordStateAt,
  cubicBezierAt,
} from "../dist/index.js";

test("karaoke mixes the two raster states linearly with CSS both fill", () => {
  const timing = { role: "karaoke", delaySec: 1, durationSec: 2 };
  assert.equal(captionWordStateAt(timing, 0).mix, 0);
  assert.equal(captionWordStateAt(timing, 2).mix, 0.5);
  assert.equal(captionWordStateAt(timing, 4).mix, 1);
});

test("pop samples ease-out separately in both keyframe intervals", () => {
  const timing = { role: "pop", delaySec: 0, durationSec: 0.2, emPx: 50 };
  assert.deepEqual(captionWordStateAt(timing, 0), {
    mix: 0, visible: true, opacity: 1, translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
  });
  const peak = captionWordStateAt(timing, 0.1);
  assert.equal(peak.scaleX, 1.12);
  assert.equal(peak.translateY, -4);
  const quarter = captionWordStateAt(timing, 0.05);
  const intervalEase = cubicBezierAt(0.5, 0, 0, 0.58, 1);
  assert.ok(Math.abs(quarter.scaleX - (1 + 0.12 * intervalEase)) < 1e-9);
  assert.equal(captionWordStateAt(timing, 0.2).scaleX, 1);
});

test("reveal-word is invisible until its 0.01 second transition advances", () => {
  const timing = { role: "reveal-word", delaySec: 1, durationSec: 0.01 };
  assert.equal(captionWordStateAt(timing, 0.999).visible, false);
  assert.equal(captionWordStateAt(timing, 1).visible, false);
  assert.equal(captionWordStateAt(timing, 1.01).opacity, 1);
});

test("emphasis bang settles from hidden 1.6 scale to identity", () => {
  const timing = { role: "emphasis-bang", delaySec: 0, durationSec: 0.1 };
  assert.deepEqual(captionWordStateAt(timing, 0), {
    mix: 0, visible: false, opacity: 0, translateX: 0, translateY: 0, scaleX: 1.6, scaleY: 1.6,
  });
  const end = captionWordStateAt(timing, 0.1);
  assert.equal(end.opacity, 1);
  assert.equal(end.scaleX, 1);
});

test("reveal groups implement the 0/12/99.99/100 percent keyframes", () => {
  assert.deepEqual(captionRevealGroupStateAt(1, 2, 0, 100), { opacity: 0, translateY: 18 });
  assert.deepEqual(captionRevealGroupStateAt(1, 2, 1.24, 100), { opacity: 1, translateY: 0 });
  assert.deepEqual(captionRevealGroupStateAt(1, 2, 3, 100), { opacity: 0, translateY: 0 });
});

function rect(x, y, width, height) {
  return { x, y, width, height, right: x + width, bottom: y + height };
}

function intersects(left, right) {
  return left.x < right.x + right.width && right.x < left.x + left.width
    && left.y < right.y + right.height && right.y < left.y + left.height;
}

test("caption word tiles cover the frame once without overlap", () => {
  const timing = { role: "karaoke", delaySec: 0, durationSec: 1 };
  const measurement = {
    emPx: 10,
    lines: [rect(0, 40, 100, 20)],
    tokens: [10, 30, 50, 70].map((x, tokenIndex) => ({
      tokenIndex, lineIndex: 0, rect: rect(x, 45, 10, 10), timing,
    })),
  };
  const textureRect = captionWordTextureRect(measurement, { width: 100, height: 100 });
  const tiles = buildCaptionWordTiles(measurement, { width: 100, height: 100, textureRect });
  assert.ok(tiles);
  assert.deepEqual(textureRect, { x: 0, y: 16, width: 100, height: 68, right: 100, bottom: 84 });
  assert.equal(tiles.reduce((sum, tile) => sum + tile.static.width * tile.static.height, 0), 6_800);
  for (let left = 0; left < tiles.length; left += 1) {
    for (let right = left + 1; right < tiles.length; right += 1) {
      assert.equal(intersects(tiles[left].static, tiles[right].static), false);
    }
  }
});

test("one-line four-word partition uses line strips and adjacent-word midpoints", () => {
  const timings = [0, 1, 2, 3].map((delaySec) => ({ role: "karaoke", delaySec, durationSec: 1 }));
  const measurement = {
    emPx: 10,
    lines: [rect(0, 40, 100, 20)],
    tokens: [10, 30, 50, 70].map((x, tokenIndex) => ({
      tokenIndex, lineIndex: 0, rect: rect(x, 45, 10, 10), timing: timings[tokenIndex],
    })),
  };
  const textureRect = captionWordTextureRect(measurement, { width: 100, height: 100 });
  const tiles = buildCaptionWordTiles(measurement, { width: 100, height: 100, textureRect });
  assert.deepEqual(tiles.map((tile) => [tile.static.x, tile.static.y, tile.static.width, tile.static.height]), [
    [0, 16, 100, 20],
    [0, 36, 6, 28],
    [6, 36, 19, 28],
    [25, 36, 20, 28],
    [45, 36, 20, 28],
    [65, 36, 19, 28],
    [84, 36, 16, 28],
    [0, 64, 100, 20],
  ]);
  const wordTiles = tiles.filter((tile) => tile.timing);
  assert.deepEqual(wordTiles.map((tile) => tile.static.x), [6, 25, 45, 65]);
  assert.deepEqual(wordTiles.slice(0, -1).map((tile) => tile.static.x + tile.static.width), [25, 45, 65]);
  assert.ok(measurement.tokens.every((token, index) => {
    const tile = wordTiles[index].static;
    return token.rect.x >= tile.x && token.rect.right <= tile.x + tile.width
      && token.rect.y >= tile.y && token.rect.bottom <= tile.y + tile.height;
  }));
});

test("caption word tile builder returns null when no words were measured", () => {
  assert.equal(buildCaptionWordTiles({ emPx: 38, lines: [], tokens: [] }, { width: 1920, height: 1080 }), null);
});

test("caption texture crop includes the plate and a one-em vertical safety margin", () => {
  const measurement = {
    emPx: 30,
    plate: rect(0, 400, 1920, 100),
    lines: [rect(600, 420, 720, 60)],
    tokens: [{ lineIndex: 0, rect: rect(700, 430, 120, 40), timing: null }],
  };
  assert.deepEqual(captionWordTextureRect(measurement, { width: 1920, height: 1080 }), {
    x: 0, y: 370, width: 1920, height: 160, right: 1920, bottom: 530,
  });
});
