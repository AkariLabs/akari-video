import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { sha256File } from "../src/media/common.mjs";

test("sha256File が固定バイト列で createHash と一致し、Promise を返す", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "akari-sha256-"));
  try {
    const fixedPath = path.join(root, "fixed.bin");
    const fixed = Buffer.from("akari-media-sha256-fixed-bytes");
    await writeFile(fixedPath, fixed);

    const expected = createHash("sha256").update(await readFile(fixedPath)).digest("hex");
    const returned = sha256File(fixedPath);
    assert.equal(Promise.resolve(returned), returned);
    assert.equal(await returned, expected);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sha256File がランダムバイト列で createHash と一致し、Promise を返す", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "akari-sha256-"));
  try {
    const randomPath = path.join(root, "random.bin");
    const random = randomBytes(2048);
    await writeFile(randomPath, random);

    const expected = createHash("sha256").update(await readFile(randomPath)).digest("hex");
    const returned = sha256File(randomPath);
    assert.equal(Promise.resolve(returned), returned);
    assert.equal(await returned, expected);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
