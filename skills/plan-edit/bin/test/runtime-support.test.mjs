import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { canonicalBytes, sha256 } from "../canonical-json.mjs";
import { CutCandidateError } from "../errors.mjs";
import {
  detectorArgv,
  normalizeProjectRelative,
  resolveProject,
  resolveProjectFile,
  reportBytes,
  runChild,
  snapshotFile,
  verifySnapshot,
  writeContentAddressed,
  probeArgv,
} from "../runtime-support.mjs";

async function project() {
  const root = await mkdtemp(path.join(tmpdir(), "akari-runtime-safety-"));
  await mkdir(path.join(root, ".akari"));
  await writeFile(path.join(root, ".akari", "connections.json"), "{}\n");
  return root;
}

test("project-relative input rejects absolute, URL, parent, backslash, symlink, and directory targets", async () => {
  for (const value of ["/tmp/a", "../a", "https://example.test/a", "a\\b"]) {
    assert.throws(() => normalizeProjectRelative(value), { code: "PATH_ESCAPE" });
  }
  const root = await project();
  try {
    await writeFile(path.join(root, "regular.json"), "{}\n");
    assert.equal((await resolveProjectFile(await resolveProject(root), "regular.json")).relative, "regular.json");
    await symlink(path.join(root, "regular.json"), path.join(root, "linked.json"));
    await assert.rejects(() => resolveProjectFile(root, "linked.json"), { code: "SYMLINK_REJECTED" });
    await mkdir(path.join(root, "directory.json"));
    await assert.rejects(() => resolveProjectFile(root, "directory.json"), { code: "NON_REGULAR_FILE" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("probe and detector argv close playlist, concat, and network demuxers", () => {
  const probe = probeArgv("/project/assets/source.mp4");
  const detector = detectorArgv("/project/assets/source.mp4", 2, {
    silence_detection_db: -35,
    minimum_silence_seconds: 0.45,
  });
  for (const argv of [probe, detector]) {
    assert.deepEqual(argv.slice(argv.indexOf("-protocol_whitelist"), argv.indexOf("-protocol_whitelist") + 2), [
      "-protocol_whitelist", "file,pipe",
    ]);
    assert.deepEqual(argv.slice(argv.indexOf("-format_whitelist"), argv.indexOf("-format_whitelist") + 2), [
      "-format_whitelist", "mov,matroska,webm",
    ]);
    assert.equal(argv.join(" ").includes("concat"), false);
    assert.equal(argv.join(" ").includes("http"), false);
  }
  assert.deepEqual(detector.slice(detector.indexOf("-map"), detector.indexOf("-map") + 2), ["-map", "0:2"]);
});

test("content-address writer reuses identical bytes and rejects smaller and larger collisions", async () => {
  const root = await project();
  try {
    const canonicalRoot = await resolveProject(root);
    const bytes = canonicalBytes({ review: true });
    const target = await writeContentAddressed(canonicalRoot, bytes);
    assert.equal(await writeContentAddressed(canonicalRoot, bytes), target);
    await rm(target);
    await writeFile(target, Buffer.alloc(bytes.length - 1, 120));
    await assert.rejects(() => writeContentAddressed(canonicalRoot, bytes), { code: "CONTENT_ADDRESS_COLLISION" });
    await rm(target);
    await writeFile(target, Buffer.alloc(bytes.length + 1, 120));
    await assert.rejects(() => writeContentAddressed(canonicalRoot, bytes), { code: "CONTENT_ADDRESS_COLLISION" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("output ancestor symlink is rejected without writing outside the project", async () => {
  const root = await project();
  const outside = await mkdtemp(path.join(tmpdir(), "akari-runtime-outside-"));
  try {
    const canonicalRoot = await resolveProject(root);
    await symlink(outside, path.join(root, ".akari", "reports"));
    await assert.rejects(() => writeContentAddressed(canonicalRoot, canonicalBytes({ safe: true })), { code: "OUTPUT_PATH_UNSAFE" });
    assert.deepEqual(await readdir(outside), []);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("global child deadline forbids expired spawn and bounds an active child", async () => {
  await assert.rejects(() => runChild("/definitely/not/a/tool", [], {
    kind: "detector",
    timeoutMs: 1_000,
    stdoutLimit: 1024,
    stderrLimit: 1024,
    deadlineAt: Date.now() - 1,
  }), { code: "INPUT_BUDGET_EXCEEDED" });
  await assert.rejects(() => runChild(process.execPath, ["-e", "setTimeout(() => {}, 1000)"], {
    kind: "detector",
    timeoutMs: 1_000,
    stdoutLimit: 1024,
    stderrLimit: 1024,
    deadlineAt: Date.now() + 30,
  }), { code: "INPUT_BUDGET_EXCEEDED" });
});

test("initial tool identity failure and observed identity drift remain distinct", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "akari-tool-identity-"));
  const target = path.join(root, "tool");
  try {
    await assert.rejects(() => snapshotFile({ absolute: target, relative: target }, 1024, false, "TOOL_BINARY_INVALID"), {
      code: "TOOL_BINARY_INVALID",
    });
    await writeFile(target, "first\n");
    const snapshot = await snapshotFile({ absolute: target, relative: target }, 1024, false, "TOOL_BINARY_INVALID");
    await writeFile(target, "second\n");
    await assert.rejects(() => verifySnapshot(snapshot, "TOOL_IDENTITY_DRIFT"), { code: "TOOL_IDENTITY_DRIFT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("detector streaming enforces the 8 MiB stderr cap without retaining full output", async () => {
  await assert.rejects(() => runChild(process.execPath, [
    "-e", "process.stderr.write(Buffer.alloc(8 * 1024 * 1024 + 1, 10))",
  ], {
    kind: "detector",
    timeoutMs: 10_000,
    stdoutLimit: 1024,
    stderrLimit: 8 * 1024 * 1024,
    stderrConsumer: () => {},
  }), { code: "DETECTOR_OUTPUT_LIMIT" });
});

test("child failure retains only the bounded 64 KiB stderr tail", async () => {
  let failure;
  try {
    await runChild(process.execPath, [
      "-e", "process.stderr.write(Buffer.alloc(100000, 120)); process.exitCode = 7",
    ], {
      kind: "detector",
      timeoutMs: 10_000,
      stdoutLimit: 1024,
      stderrLimit: 200_000,
      stderrConsumer: () => {},
    });
  } catch (error) {
    failure = error;
  }
  assert.equal(failure?.code, "FFMPEG_FAILED");
  assert.equal(failure?.stderrTail?.length, 65_536);
  assert.equal(failure.stderrTail.every((byte) => byte === 120), true);
  assert.equal(Object.keys(failure).includes("stderrTail"), false);
});

test("content-address writer rejects observed output parent identity replacement", async () => {
  const root = await project();
  try {
    const canonicalRoot = await resolveProject(root);
    await assert.rejects(() => writeContentAddressed(canonicalRoot, canonicalBytes({ safe: true }), {
      beforePublish: async ({ directory }) => {
        await rename(directory, `${directory}-replaced`);
        await mkdir(directory);
      },
    }), { code: "OUTPUT_PATH_UNSAFE" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("content-address writer revalidates an existing target after exact-byte reuse inspection", async () => {
  const root = await project();
  try {
    const canonicalRoot = await resolveProject(root);
    const bytes = canonicalBytes({ existing: true });
    await writeContentAddressed(canonicalRoot, bytes);
    await assert.rejects(() => writeContentAddressed(canonicalRoot, bytes, {
      beforeReuse: async ({ target }) => {
        await rename(target, `${target}.original`);
        await writeFile(target, Buffer.alloc(bytes.length, 120));
      },
    }), { code: "CONTENT_ADDRESS_COLLISION" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("content-address writer performs target verification after publish cleanup and parent checks", async () => {
  const root = await project();
  try {
    const canonicalRoot = await resolveProject(root);
    const bytes = canonicalBytes({ publish: true });
    await assert.rejects(() => writeContentAddressed(canonicalRoot, bytes, {
      beforeFinalTargetVerify: async ({ target }) => {
        await rename(target, `${target}.original`);
        await writeFile(target, Buffer.alloc(bytes.length, 120));
      },
    }), { code: "CONTENT_ADDRESS_COLLISION" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function replaceOutputParentWithIdenticalTarget({ directory, target }, bytes) {
  await rename(directory, `${directory}-original`);
  await mkdir(directory);
  await writeFile(path.join(directory, path.basename(target)), bytes);
}

test("content-address writer rejects final-window parent replacement on publish", async () => {
  const root = await project();
  try {
    const canonicalRoot = await resolveProject(root);
    const bytes = canonicalBytes({ publishParent: true });
    await assert.rejects(() => writeContentAddressed(canonicalRoot, bytes, {
      beforeFinalTargetVerify: (paths) => replaceOutputParentWithIdenticalTarget(paths, bytes),
    }), { code: "OUTPUT_PATH_UNSAFE" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("content-address writer rejects final-window parent replacement on reuse", async () => {
  const root = await project();
  try {
    const canonicalRoot = await resolveProject(root);
    const bytes = canonicalBytes({ reuseParent: true });
    await writeContentAddressed(canonicalRoot, bytes);
    await assert.rejects(() => writeContentAddressed(canonicalRoot, bytes, {
      beforeFinalTargetVerify: (paths) => replaceOutputParentWithIdenticalTarget(paths, bytes),
    }), { code: "OUTPUT_PATH_UNSAFE" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("snapshot hashing checks the helper resource guard at chunk boundaries", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "akari-snapshot-deadline-"));
  const target = path.join(root, "large-input.bin");
  try {
    await writeFile(target, Buffer.alloc(2 * 1024 * 1024 + 1, 97));
    let guardCalls = 0;
    await assert.rejects(() => snapshotFile(
      { absolute: target, relative: "large-input.bin" },
      3 * 1024 * 1024,
      false,
      "INPUT_HASH_DRIFT",
      () => {
        guardCalls += 1;
        if (guardCalls === 5) throw new CutCandidateError("INPUT_BUDGET_EXCEEDED");
      },
      root,
    ), { code: "INPUT_BUDGET_EXCEEDED" });
    assert.equal(guardCalls, 5);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("snapshot verification rejects a persistent ancestor-directory replacement", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "akari-snapshot-ancestor-"));
  const directory = path.join(root, "inputs");
  const displaced = path.join(root, "inputs-original");
  const target = path.join(directory, "analysis.json");
  try {
    await mkdir(directory);
    await writeFile(target, "same bytes\n");
    const snapshot = await snapshotFile(
      { absolute: target, relative: "inputs/analysis.json" }, 1024, false, "INPUT_HASH_DRIFT", () => {}, root,
    );
    await rename(directory, displaced);
    await mkdir(directory);
    await writeFile(target, "same bytes\n");
    await assert.rejects(() => verifySnapshot(snapshot), { code: "INPUT_HASH_DRIFT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("report serialization is byte-identical when bounded and fails before exceeding 64 MiB", () => {
  const ordinary = { z: [1, true], a: "ok" };
  assert.deepEqual(reportBytes(ordinary), canonicalBytes(ordinary));
  const sharedOneMiB = "x".repeat(1024 * 1024);
  assert.throws(() => reportBytes({ values: Array(65).fill(sharedOneMiB) }), { code: "REPORT_SIZE_LIMIT" });
});
