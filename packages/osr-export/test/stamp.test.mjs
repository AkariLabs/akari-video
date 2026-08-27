import assert from "node:assert/strict";
import test from "node:test";

import { decodeStampFromBgra, encodeStamp, stripStampRow } from "../src/stamp.mjs";

test("stamp は最下行の3点で mod 65536 を往復する", () => {
  const width = 5;
  const height = 3;
  for (const frame of [0, 1, 255, 256, 65_535, 65_536]) {
    const bitmap = Buffer.alloc(width * (height + 1) * 4, 0x22);
    const stamp = encodeStamp(frame);
    for (let x = 0; x < width; x += 1) {
      const offset = (width * height + x) * 4;
      bitmap.set([stamp.blue, stamp.green, stamp.red, stamp.alpha], offset);
    }
    const decoded = decodeStampFromBgra(bitmap, width, height);
    assert.equal(decoded.matched, true);
    assert.equal(decoded.frameNumber, frame % 65_536);
  }
});

test("スタンプ行の切り落としは映像 H 行だけを返す", () => {
  const width = 3;
  const height = 2;
  const bitmap = Buffer.from(Array.from({ length: width * (height + 1) * 4 }, (_, index) => index));
  const stripped = stripStampRow(bitmap, width, height);
  assert.equal(stripped.length, width * height * 4);
  assert.equal(stripped.at(-1), bitmap[width * height * 4 - 1]);
});
