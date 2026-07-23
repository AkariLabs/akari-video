import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { createSkillAdapterLink, installSkillAdapters } from "../src/index.mjs";

async function withScratchRoot(callback) {
  const root = await mkdtemp(join(tmpdir(), "akari-scaffold-adapter-link-test-"));
  try {
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/**
 * Builds a fake `fs/promises`-shaped object backed by an in-memory call log, so the
 * symlink / junction / copy fallback chain can be exercised deterministically from mac
 * without a real Windows machine. Delegates directory operations (mkdir/readdir/writeFile/
 * readFile) to the real `node:fs/promises` against a scratch directory — only `symlink`
 * behavior is faked.
 */
function fakeFsWithSymlinkBehavior(realFs, symlinkImpl) {
  return {
    mkdir: realFs.mkdir,
    readdir: realFs.readdir,
    readFile: realFs.readFile,
    writeFile: realFs.writeFile,
    symlink: symlinkImpl
  };
}

function eperm(message) {
  const error = new Error(message);
  error.code = "EPERM";
  return error;
}

function eexist(message) {
  const error = new Error(message);
  error.code = "EEXIST";
  return error;
}

test("createSkillAdapterLink: passes an explicit 'dir' type through to fs.symlink (skills are directories)", async () => {
  await withScratchRoot(async (root) => {
    const realFs = await import("node:fs/promises");
    const source = join(root, "skill-source");
    const linkPath = join(root, "adapter", "skill-source");
    await mkdir(source, { recursive: true });
    await mkdir(dirname(linkPath), { recursive: true });

    const calls = [];
    const fsImpl = fakeFsWithSymlinkBehavior(realFs, async (target, path, type) => {
      calls.push({ target, path, type });
      return realFs.symlink(target, path, type);
    });

    const result = await createSkillAdapterLink("../skill-source", linkPath, { fsImpl, platform: "darwin" });

    assert.equal(result.method, "symlink");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].type, "dir");
  });
});

test("createSkillAdapterLink: on win32, EPERM from a plain symlink falls back to an absolute-path junction", async () => {
  await withScratchRoot(async (root) => {
    const realFs = await import("node:fs/promises");
    const source = join(root, "skill-source");
    const linkPath = join(root, "adapter", "skill-source");
    await mkdir(source, { recursive: true });
    await mkdir(dirname(linkPath), { recursive: true });

    const calls = [];
    const fsImpl = fakeFsWithSymlinkBehavior(realFs, async (target, path, type) => {
      calls.push({ target, path, type });
      if (type === "dir") {
        throw eperm("plain symlink denied (no admin rights / developer mode)");
      }
      // Simulate junction creation succeeding by materializing a real symlink in its place
      // (macOS/Linux fs.symlink ignores the 'junction' type and just makes a normal link,
      // which is enough to prove createSkillAdapterLink reached this branch with an
      // absolute, resolved target).
      return realFs.symlink(target, path, "dir");
    });

    const result = await createSkillAdapterLink("../skill-source", linkPath, { fsImpl, platform: "win32" });

    assert.equal(result.method, "junction");
    assert.equal(calls.length, 2);
    assert.equal(calls[0].type, "dir");
    assert.equal(calls[1].type, "junction");
    // Junctions require an absolute target path (relative targets are not valid junctions).
    assert.ok(calls[1].target.startsWith("/") || /^[A-Za-z]:/.test(calls[1].target));
    assert.equal(calls[1].target, source);
  });
});

test("createSkillAdapterLink: on win32, when junction creation also fails, falls back to a recursive copy", async () => {
  await withScratchRoot(async (root) => {
    const realFs = await import("node:fs/promises");
    const source = join(root, "skill-source");
    const linkPath = join(root, "adapter", "skill-source");
    await mkdir(join(source, "nested"), { recursive: true });
    await realFs.writeFile(join(source, "top.md"), "top-level file\n", "utf8");
    await realFs.writeFile(join(source, "nested", "child.md"), "nested file\n", "utf8");
    await mkdir(dirname(linkPath), { recursive: true });

    const fsImpl = fakeFsWithSymlinkBehavior(realFs, async (target, path, type) => {
      if (type === "dir") {
        throw eperm("plain symlink denied");
      }
      throw eperm("junction denied (e.g. cross-volume target)");
    });

    const result = await createSkillAdapterLink("../skill-source", linkPath, { fsImpl, platform: "win32" });

    assert.equal(result.method, "copy");
    assert.equal(await readFile(join(linkPath, "top.md"), "utf8"), "top-level file\n");
    assert.equal(await readFile(join(linkPath, "nested", "child.md"), "utf8"), "nested file\n");
  });
});

test("createSkillAdapterLink: on non-Windows platforms, symlink errors other than EEXIST are not retried as junction/copy", async () => {
  await withScratchRoot(async (root) => {
    const realFs = await import("node:fs/promises");
    const linkPath = join(root, "adapter", "skill-source");
    await mkdir(dirname(linkPath), { recursive: true });

    const calls = [];
    const fsImpl = fakeFsWithSymlinkBehavior(realFs, async (target, path, type) => {
      calls.push({ target, path, type });
      throw eperm("hypothetical restricted sandbox");
    });

    await assert.rejects(
      () => createSkillAdapterLink("../skill-source", linkPath, { fsImpl, platform: "darwin" }),
      (error) => error.code === "EPERM"
    );
    // Junctions are an NTFS-only concept; there is nothing sensible to fall back to on
    // POSIX platforms, so only the original attempt should have been made.
    assert.equal(calls.length, 1);
  });
});

test("createSkillAdapterLink: EEXIST propagates unchanged (idempotent re-install keeps existing links)", async () => {
  await withScratchRoot(async (root) => {
    const realFs = await import("node:fs/promises");
    const linkPath = join(root, "adapter", "skill-source");
    await mkdir(dirname(linkPath), { recursive: true });

    const fsImpl = fakeFsWithSymlinkBehavior(realFs, async () => {
      throw eexist("already linked");
    });

    await assert.rejects(
      () => createSkillAdapterLink("../skill-source", linkPath, { fsImpl, platform: "win32" }),
      (error) => error.code === "EEXIST"
    );
  });
});

test("installSkillAdapters: on win32 with symlink EPERM, all adapters degrade to junctions and the caller learns which ones", async () => {
  await withScratchRoot(async (root) => {
    const realFs = await import("node:fs/promises");
    const skillsDir = join(root, ".claude", "skills");
    await mkdir(join(skillsDir, "analyze-footage"), { recursive: true });

    const fsImpl = fakeFsWithSymlinkBehavior(realFs, async (target, path, type) => {
      if (type === "dir") {
        throw eperm("plain symlink denied");
      }
      return realFs.symlink(target, path, "dir");
    });

    const report = await installSkillAdapters(root, { fsImpl, platform: "win32" });

    assert.deepEqual(report.created.sort(), [
      ".agents/skills/analyze-footage",
      ".codex/skills/analyze-footage"
    ]);
    assert.deepEqual(report.skippedExisting, []);
    assert.equal(report.degraded.length, 2);
    assert.ok(report.degraded.every((entry) => entry.method === "junction"));
  });
});

test("installSkillAdapters: real fs on the current platform still creates plain symlinks (no regression)", async () => {
  await withScratchRoot(async (root) => {
    const skillsDir = join(root, ".claude", "skills");
    await mkdir(join(skillsDir, "analyze-footage"), { recursive: true });

    const report = await installSkillAdapters(root);

    assert.deepEqual(report.created.sort(), [
      ".agents/skills/analyze-footage",
      ".codex/skills/analyze-footage"
    ]);
    assert.deepEqual(report.degraded, []);
  });
});
