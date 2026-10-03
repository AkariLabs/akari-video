import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readFontCodepoints } from "../src/font-cmap.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const fixture = new URL("./fixtures/font-cmap/", import.meta.url);
const expected = JSON.parse(readFileSync(new URL("expected.json", fixture), "utf8"));
const digest = points => createHash("sha256").update([...points].sort((a, b) => a - b).map(cp => `${cp}\n`).join("")).digest("hex");

for (const [path, value] of Object.entries(expected)) test(`bundled cmap ${path}`, () => {
  const result = readFontCodepoints(join(root, path));
  assert.equal(result.ok, true, result.warnings.join(", "));
  assert.equal(result.codepoints.size, value.count);
  assert.equal(digest(result.codepoints), value.sha256);
});

test("small TTF, WOFF, WOFF2 and TTC match fontTools and each other", () => {
  const formats = ["ttf", "woff", "woff2", "ttc"];
  const results = formats.map(ext => readFontCodepoints(readFileSync(new URL(`sample.${ext}`, fixture))));
  for (const [i, result] of results.entries()) {
    assert.equal(result.ok, true, `${formats[i]}: ${result.warnings.join(", ")}`);
    assert.equal(result.format, formats[i]);
    assert.deepEqual(result.codepoints, results[0].codepoints);
    const value = expected[`packages/render-cut/test/fixtures/font-cmap/sample.${formats[i]}`];
    assert.equal(result.codepoints.size, value.count);
    assert.equal(digest(result.codepoints), value.sha256);
  }
});

test("truncated and unsupported fonts return a failure", () => {
  for (const bytes of [Buffer.alloc(0), Buffer.from("OTTO"), Buffer.from("nonsense")]) {
    const result = readFontCodepoints(bytes);
    assert.equal(result.ok, false);
    assert.ok(result.warnings.length);
  }
});

test("unknown and truncated magic have no guessed format", () => {
  for (const bytes of [Buffer.alloc(0), Buffer.from("nonsense"), Buffer.from("bad!")]) {
    const result = readFontCodepoints(bytes);
    assert.equal(result.ok, false);
    assert.equal(result.format, null);
  }
});

test("every sample container tolerates many truncation points", () => {
  for (const ext of ["ttf", "woff", "woff2", "ttc"]) {
    const bytes = readFileSync(new URL(`sample.${ext}`, fixture));
    const lengths = new Set([
      ...Array.from({ length: Math.min(601, bytes.length) }, (_, i) => i),
      ...Array.from({ length: Math.ceil(Math.max(0, bytes.length - 601) / 251) }, (_, i) => 601 + i * 251),
      bytes.length - 1,
    ]);
    for (const length of lengths) {
      if (length < 0 || length >= bytes.length) continue;
      assert.doesNotThrow(() => readFontCodepoints(bytes.subarray(0, length)), `${ext} at ${length}`);
    }
  }
});

function fontWithCmap(table, platform, encoding) {
  const cmap = Buffer.alloc(12 + table.length);
  cmap.writeUInt16BE(1, 2);
  cmap.writeUInt16BE(platform, 4);
  cmap.writeUInt16BE(encoding, 6);
  cmap.writeUInt32BE(12, 8);
  table.copy(cmap, 12);
  const bytes = Buffer.alloc(28 + cmap.length);
  bytes.writeUInt32BE(0x00010000, 0);
  bytes.writeUInt16BE(1, 4);
  bytes.write("cmap", 12);
  bytes.writeUInt32BE(28, 20);
  bytes.writeUInt32BE(cmap.length, 24);
  cmap.copy(bytes, 28);
  return bytes;
}

test("overlapping format 12 groups stop within the scan budget", () => {
  const groups = 100;
  const table = Buffer.alloc(16 + groups * 12);
  table.writeUInt16BE(12, 0);
  table.writeUInt32BE(table.length, 4);
  table.writeUInt32BE(groups, 12);
  for (let i = 0; i < groups; i++) {
    table.writeUInt32BE(0, 16 + i * 12);
    table.writeUInt32BE(0x10ffff, 20 + i * 12);
    table.writeUInt32BE(1, 24 + i * 12);
  }
  const start = performance.now();
  const result = readFontCodepoints(fontWithCmap(table, 3, 10));
  assert.equal(result.ok, false);
  assert.match(result.warnings[0], /scan limit/u);
  assert.ok(performance.now() - start < 1000);
});

test("overlapping format 4 segments stop within the scan budget", () => {
  const table = Buffer.alloc(32);
  table.writeUInt16BE(4, 0);
  table.writeUInt16BE(table.length, 2);
  table.writeUInt16BE(4, 6);
  for (let i = 0; i < 2; i++) {
    table.writeUInt16BE(0xfffe, 14 + i * 2);
    table.writeUInt16BE(0, 20 + i * 2);
    table.writeUInt16BE(1, 24 + i * 2);
  }
  const start = performance.now();
  const result = readFontCodepoints(fontWithCmap(table, 3, 1));
  assert.equal(result.ok, false);
  assert.match(result.warnings[0], /scan limit/u);
  assert.ok(performance.now() - start < 1000);
});

test("compressed cmap expansion is bounded", () => {
  const woff = Buffer.from(readFileSync(new URL("sample.woff", fixture)));
  for (let i = 0; i < woff.readUInt16BE(12); i++) {
    const at = 44 + i * 20;
    if (woff.toString("latin1", at, at + 4) === "cmap") woff.writeUInt32BE(1, at + 12);
  }
  assert.equal(readFontCodepoints(woff).ok, false);
  const woff2 = Buffer.from(readFileSync(new URL("sample.woff2", fixture)));
  const original = readFontCodepoints(woff2);
  assert.equal(original.ok, true);
  woff2.writeUInt32BE(1, 16);
  const altered = readFontCodepoints(woff2);
  assert.equal(altered.ok, true, altered.warnings.join(", "));
  assert.deepEqual(altered.codepoints, original.codepoints);

  const enormous = Buffer.alloc(53);
  enormous.write("wOF2", 0);
  enormous.writeUInt16BE(1, 12);
  Buffer.from([0, 0xc0, 0x80, 0x80, 0x01]).copy(enormous, 48);
  const rejected = readFontCodepoints(enormous);
  assert.equal(rejected.ok, false);
  assert.match(rejected.warnings[0], /expanded size exceeds limit/u);
});

test("retain-gids WOFF2 reads the fontTools cmap", () => {
  const path = "packages/render-cut/test/fixtures/font-cmap/retain-gids.woff2";
  const result = readFontCodepoints(join(root, path));
  assert.equal(result.ok, true, result.warnings.join(", "));
  assert.equal(result.codepoints.size, expected[path].count);
  assert.equal(digest(result.codepoints), expected[path].sha256);
});

test("WOFF2 collections fail with an explicit reason", () => {
  const bytes = Buffer.from(readFileSync(new URL("sample.woff2", fixture)));
  bytes.write("ttcf", 4);
  const result = readFontCodepoints(bytes);
  assert.equal(result.ok, false);
  assert.match(result.warnings[0], /collections are unsupported/u);
});

test("a broken format 14 record cannot throw", () => {
  const bytes = Buffer.alloc(48);
  bytes.writeUInt32BE(0x00010000, 0);
  bytes.writeUInt16BE(1, 4);
  bytes.write("cmap", 12);
  bytes.writeUInt32BE(28, 20);
  bytes.writeUInt32BE(20, 24);
  bytes.writeUInt16BE(1, 30);
  bytes.writeUInt16BE(0, 32);
  bytes.writeUInt16BE(5, 34);
  bytes.writeUInt32BE(12, 36);
  bytes.writeUInt16BE(14, 40);
  bytes.writeUInt32BE(0xffffffff, 42);
  assert.equal(readFontCodepoints(bytes).ok, false);
});

test("a damaged format 14 does not affect a valid Unicode cmap", () => {
  const path = join(root, "assets/font/mplus-rounded-1c/MPLUSRounded1c-Medium.ttf");
  const bytes = Buffer.from(readFileSync(path));
  const before = readFontCodepoints(bytes);
  assert.equal(before.ok, true);
  let changed = false;
  for (let i = 0; i < bytes.readUInt16BE(4); i++) {
    const entry = 12 + i * 16;
    if (bytes.toString("latin1", entry, entry + 4) !== "cmap") continue;
    const cmap = bytes.readUInt32BE(entry + 8);
    for (let j = 0; j < bytes.readUInt16BE(cmap + 2); j++) {
      const record = cmap + 4 + j * 8;
      if (bytes.readUInt16BE(record) !== 0 || bytes.readUInt16BE(record + 2) !== 5) continue;
      const subtable = cmap + bytes.readUInt32BE(record + 4);
      if (bytes.readUInt16BE(subtable) !== 14) continue;
      bytes.writeUInt32BE(0xffffffff, subtable + 2);
      changed = true;
    }
  }
  assert.equal(changed, true);
  const after = readFontCodepoints(bytes);
  assert.equal(after.ok, true, after.warnings.join(", "));
  assert.deepEqual(after.codepoints, before.codepoints);
});
