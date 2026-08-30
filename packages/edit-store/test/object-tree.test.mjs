import assert from "node:assert/strict";
import fs from "node:fs";
import fsPromises, { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { readInternalEdit, walkItems } from "../lib/index.js";

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "object-tree.json");

test("walkItems is depth-first and resolves parent-relative frames to absolute frames", async () => {
  const internal = readInternalEdit(await readFile(fixturePath, "utf8"));
  assert.deepEqual([...walkItems(internal)].map(item => item.id), [
    "root", "middle", "leaf", "bag", "bag.B", "captions", "cap-2", "telop-2", "front",
  ]);
  const [root, middle, leaf] = [...walkItems(internal)];
  assert.deepEqual([root.atFrames, middle.atFrames, leaf.atFrames], [10, 15, 22]);
  assert.deepEqual([root.at, middle.at, leaf.at], [10 / 30, 15 / 30, 22 / 30]);
  assert.equal(middle.parentId, "root");
  assert.equal(leaf.parentId, "middle");
  assert.equal(leaf.declaration.t, 7 / 30);
  assert.equal("at" in leaf.declaration, false);
  const htmlPart = [...walkItems(internal)].find(item => item.id === "bag.B");
  assert.equal(htmlPart.declaration.start, 6 / 30);
});

test("keyframes reference is retained without reading the referenced file", async (t) => {
  // motion/root.json intentionally does not exist beside this fixture. A successful synchronous read
  // and direct spies on every read/open family below prove A1 keeps the reference lazy.
  const text = await readFile(fixturePath, "utf8");
  const motionReads = [];
  const observe = (kind, file) => {
    if (String(file).replaceAll("\\", "/").includes("motion/")) motionReads.push({ kind, file: String(file) });
  };
  const readFileSync = fs.readFileSync.bind(fs);
  const openSync = fs.openSync.bind(fs);
  const readFilePromise = fsPromises.readFile.bind(fsPromises);
  const openPromise = fsPromises.open.bind(fsPromises);
  t.mock.method(fs, "readFileSync", (...args) => {
    observe("readFileSync", args[0]);
    return readFileSync(...args);
  });
  t.mock.method(fs, "openSync", (...args) => {
    observe("openSync", args[0]);
    return openSync(...args);
  });
  t.mock.method(fsPromises, "readFile", (...args) => {
    observe("readFile", args[0]);
    return readFilePromise(...args);
  });
  t.mock.method(fsPromises, "open", (...args) => {
    observe("open", args[0]);
    return openPromise(...args);
  });
  const internal = readInternalEdit(text);
  const leaf = [...walkItems(internal)].find(item => item.id === "leaf");
  assert.deepEqual(leaf.keyframesRef, { path: "motion/root.json", count: 2 });
  assert.equal("keyframes" in leaf.declaration, false);
  assert.deepEqual(motionReads, []);
});

test("legacy captions content and captions bag normalize to the same internal item shape", () => {
  const base = { version: 2, output: { width: 640, height: 360, fps: 30 }, sources: [] };
  const legacy = readInternalEdit({ ...base, tracks: [{ id: "captions", lane: "visual", content: { from: "captions.json" } }] });
  const bag = readInternalEdit({ ...base, tracks: [{ id: "captions", lane: "visual", items: [{
    id: "captions", at: 0, duration: 0, source: { kind: "captions", path: "captions.json" }, items: [],
  }] }] });
  const select = item => ({
    id: item.id, atFrames: item.atFrames, durationFrames: item.durationFrames,
    source: item.source, children: item.children,
  });
  assert.deepEqual(select(legacy.tracks[0].items[0]), select(bag.tracks[0].items[0]));
  assert.deepEqual(legacy.tracks[0].content, { from: "captions.json" });
});

test("existing leaf items expose children but keep BEFORE JSON serialization unchanged", () => {
  const internal = readInternalEdit({
    version: 2, output: { width: 640, height: 360, fps: 30 },
    sources: [], tracks: [{ id: "v1", lane: "visual", items: [{
      id: "title", at: 0, duration: 30, source: { kind: "telop", preset: "title" },
    }] }],
  });
  const item = internal.tracks[0].items[0];
  assert.deepEqual(item.children, []);
  assert.equal(JSON.stringify(item).includes("children"), false);
});
