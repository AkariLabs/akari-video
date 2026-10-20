import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { resolveFfmpeg } from "../../media-bin/src/index.mjs";
import { decodeTile } from "../src/geo/raster.mjs";

const FIXTURE = new URL("./fixtures/geo/photo-sample.jpg", import.meta.url);

/** 写真タイルの展開は ffmpeg に依存する。無い環境では理由を出してスキップする。 */
function requireFfmpeg(t) {
  try {
    resolveFfmpeg();
    return true;
  } catch (error) {
    t.skip(`ffmpeg が見つからないためスキップ: ${String(error.message).split("\n")[0]}`);
    return false;
  }
}

function assertNear(actual, expected, tolerance = 6) {
  for (let channel = 0; channel < 3; channel += 1) {
    assert.ok(
      Math.abs(actual[channel] - expected[channel]) <= tolerance,
      `画素 ${actual.join(",")} が期待 ${expected.join(",")} から外れています`,
    );
  }
}

test("geo jpeg: fixture の寸法と代表画素を ffmpeg 経由で読む", async (t) => {
  if (!requireFfmpeg(t)) return;
  const bytes = await readFile(FIXTURE);
  const image = decodeTile(bytes, "photo");

  assert.equal(image.width, 32);
  assert.equal(image.height, 32);
  assert.equal(image.rgb.length, 32 * 32 * 3);

  // fixture は 16px 四方の 4 色（赤・緑・青・白）。各象限の中央を確かめる。
  const pixel = (x, y) => [...image.rgb.subarray((y * image.width + x) * 3, (y * image.width + x) * 3 + 3)];
  assertNear(pixel(8, 8), [220, 30, 30]);
  assertNear(pixel(24, 8), [30, 180, 60]);
  assertNear(pixel(8, 24), [40, 60, 200]);
  assertNear(pixel(24, 24), [240, 240, 240]);
});
