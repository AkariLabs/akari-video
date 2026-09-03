import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  cleanupFailedRunTemporaryDirectory,
  cleanupStaleRunDirectories,
  createRunTemporaryDirectory,
  isProcessAlive,
  parseRunDirectoryOwner,
} from "../src/render-cut.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function makeRunDirectory(root, name, { owner, ageMs, nowMs }) {
  const directory = join(root, name);
  await mkdir(directory, { recursive: true });
  if (owner !== undefined) {
    await writeFile(
      join(directory, "owner.json"),
      typeof owner === "string" ? owner : `${JSON.stringify(owner)}\n`,
      "utf8",
    );
  }
  const modified = new Date(nowMs - ageMs);
  await utimes(directory, modified, modified);
  return directory;
}

test("owner parsing and pid liveness fail safe", () => {
  assert.deepEqual(
    parseRunDirectoryOwner('{"pid":123,"started":"2026-09-02T00:00:00.000Z"}'),
    { pid: 123, started: "2026-09-02T00:00:00.000Z" },
  );
  assert.equal(parseRunDirectoryOwner("{"), null);
  assert.equal(parseRunDirectoryOwner("null"), null);

  assert.equal(isProcessAlive(process.pid), true);
  assert.equal(isProcessAlive(123, () => {}), true);
  assert.equal(isProcessAlive(123, () => { throw Object.assign(new Error("gone"), { code: "ESRCH" }); }), false);
  assert.equal(isProcessAlive(123, () => { throw Object.assign(new Error("denied"), { code: "EPERM" }); }), true);
  assert.equal(isProcessAlive(123, () => { throw new Error("unknown"); }), true);
  assert.equal(isProcessAlive(1.5, () => { throw new Error("must not be called"); }), true);
});

test("stale sweep removes dead owners immediately and retains live owners", async () => {
  const root = await mkdtemp(join(tmpdir(), "render-tmp-owner-sweep-"));
  const nowMs = Date.parse("2026-09-02T12:00:00.000Z");
  try {
    const deadFresh = await makeRunDirectory(root, "dead-fresh", {
      owner: { pid: 1001, started: "2026-09-02T12:00:00.000Z" },
      ageMs: 0,
      nowMs,
    });
    const liveOld = await makeRunDirectory(root, "live-old", {
      owner: { pid: process.pid, started: "2026-08-31T12:00:00.000Z" },
      ageMs: 2 * DAY_MS,
      nowMs,
    });
    const invalidPidOld = await makeRunDirectory(root, "invalid-pid-old", {
      owner: { pid: "1001", started: "2026-08-31T12:00:00.000Z" },
      ageMs: 2 * DAY_MS,
      nowMs,
    });

    await cleanupStaleRunDirectories(root, {
      now: () => nowMs,
      isPidAlive: (pid) => pid === process.pid,
    });

    assert.equal(await pathExists(deadFresh), false);
    assert.equal(await pathExists(liveOld), true);
    assert.equal(await pathExists(invalidPidOld), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ownerless and corrupt-owner directories retain the 24h fallback", async () => {
  const root = await mkdtemp(join(tmpdir(), "render-tmp-legacy-sweep-"));
  const nowMs = Date.parse("2026-09-02T12:00:00.000Z");
  try {
    const ownerlessFresh = await makeRunDirectory(root, "ownerless-fresh", {
      ageMs: DAY_MS - 1,
      nowMs,
    });
    const ownerlessOld = await makeRunDirectory(root, "ownerless-old", {
      ageMs: DAY_MS + 1,
      nowMs,
    });
    const corruptFresh = await makeRunDirectory(root, "corrupt-fresh", {
      owner: "{broken",
      ageMs: DAY_MS - 1,
      nowMs,
    });
    const corruptOld = await makeRunDirectory(root, "corrupt-old", {
      owner: "{broken",
      ageMs: DAY_MS + 1,
      nowMs,
    });

    await cleanupStaleRunDirectories(root, { now: () => nowMs });

    assert.equal(await pathExists(ownerlessFresh), true);
    assert.equal(await pathExists(ownerlessOld), false);
    assert.equal(await pathExists(corruptFresh), true);
    assert.equal(await pathExists(corruptOld), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("run directory records its owner and failed-run cleanup honors the escape hatch", async () => {
  const root = await mkdtemp(join(tmpdir(), "render-tmp-owner-create-"));
  const started = "2026-09-02T12:34:56.789Z";
  try {
    const removed = await createRunTemporaryDirectory(root, {
      pid: 4321,
      now: () => Date.parse(started),
    });
    assert.deepEqual(JSON.parse(await readFile(join(removed, "owner.json"), "utf8")), {
      pid: 4321,
      started,
    });
    assert.equal(await cleanupFailedRunTemporaryDirectory(removed, {}), true);
    assert.equal(await pathExists(removed), false);

    const kept = await createRunTemporaryDirectory(root, {
      pid: 4322,
      now: () => Date.parse(started) + 1,
    });
    assert.equal(
      await cleanupFailedRunTemporaryDirectory(kept, { AKARI_KEEP_FAILED_RENDER_TMP: "1" }),
      false,
    );
    assert.equal(await pathExists(kept), true);
    assert.equal(await cleanupFailedRunTemporaryDirectory(undefined, {}), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("failed-run cleanup never replaces the render error when removal fails", async () => {
  const renderError = new Error("render failed");
  await assert.rejects(
    async () => {
      try {
        throw renderError;
      } catch (error) {
        await cleanupFailedRunTemporaryDirectory("ignored", {}, async () => {
          throw new Error("handle still open");
        });
        throw error;
      }
    },
    (error) => error === renderError,
  );
});
