import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { runStatusCommand } from "../src/status-command.mjs";
import {
  detectStatusScope,
  resolveWorkspaceStatus,
  formatWorkspaceStatusSummary,
} from "../src/status-core/workspace.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const SESSION_START_SCRIPT = join(REPO_ROOT, "plugin", "hooks", "scripts", "session-start.mjs");

async function withTempDir(callback) {
  const root = await mkdtemp(join(tmpdir(), "akari-status-workspace-"));
  try {
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeJson(path, value) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeRootManifest(root, { channels = ["my-channel"] } = {}) {
  await writeJson(join(root, ".akari", "root.json"), {
    schema: "creator-root/v1",
    createdAt: "2026-08-08T00:00:00.000Z",
    channels,
  });
}

// A real createCreatorRoot() also writes .akari/connections.json at the workspace root — this
// is the exact shape that caused the project-state.mjs regression fixed in b5f8df6.
async function writeWorkspaceConnections(root) {
  await writeJson(join(root, ".akari", "connections.json"), { providers: [], policy: {}, memory: [] });
}

async function addProject(root, channel, name, { withEdit = true, intake } = {}) {
  const projectDir = join(root, "channels", channel, "videos", name);
  await mkdir(projectDir, { recursive: true });
  if (withEdit) {
    await writeJson(join(projectDir, "edit.json"), {
      version: 1,
      output: { width: 1920, height: 1080, fps: 30 },
      sources: [],
      cuts: [],
      overlays: [],
    });
  }
  if (intake !== undefined) {
    await writeJson(join(projectDir, ".akari", "intake.json"), intake);
  }
}

test("detectStatusScope: three-way branch on cwd markers", async () => {
  await withTempDir(async (root) => {
    assert.equal(detectStatusScope(root), "none");

    const projectByEdit = join(root, "project-by-edit");
    await mkdir(projectByEdit, { recursive: true });
    await writeJson(join(projectByEdit, "edit.json"), { version: 1, output: {}, sources: [], cuts: [], overlays: [] });
    assert.equal(detectStatusScope(projectByEdit), "project");

    const projectByAkari = join(root, "project-by-akari");
    await mkdir(join(projectByAkari, ".akari"), { recursive: true });
    assert.equal(detectStatusScope(projectByAkari), "project");

    const workspaceRoot = join(root, "workspace");
    await writeRootManifest(workspaceRoot);
    assert.equal(detectStatusScope(workspaceRoot), "workspace");
  });
});

test("detectStatusScope: root.json takes precedence over the workspace's own connections.json", async () => {
  await withTempDir(async (root) => {
    // Regression guard for the misdetection that project-state.mjs fixed in b5f8df6: a
    // workspace root also carries .akari/connections.json and must never be read as a project.
    await writeRootManifest(root);
    await writeWorkspaceConnections(root);
    assert.equal(detectStatusScope(root), "workspace");
  });
});

test("resolveWorkspaceStatus: enumerates channels/*/videos/*/edit.json and counts inbox arrivals", async () => {
  await withTempDir(async (root) => {
    await writeRootManifest(root, { channels: ["my-channel", "second-channel"] });
    await addProject(root, "my-channel", "b-project");
    await addProject(root, "my-channel", "a-project");
    await addProject(root, "second-channel", "c-project");
    // A videos/ subdirectory without edit.json yet must not be counted as a project.
    await mkdir(join(root, "channels", "my-channel", "videos", "not-a-project-yet"), { recursive: true });
    await mkdir(join(root, "inbox"), { recursive: true });
    await writeFile(join(root, "inbox", "clip-01.mp4"), "media", "utf8");
    await writeFile(join(root, "inbox", "clip-02.mp4"), "media", "utf8");
    await writeFile(join(root, "inbox", ".DS_Store"), "junk", "utf8");

    const status = resolveWorkspaceStatus(root);
    assert.equal(status.scope, "workspace");
    assert.deepEqual(status.channels, ["my-channel", "second-channel"]);
    assert.deepEqual(status.projects, [
      { channel: "my-channel", name: "a-project", path: "channels/my-channel/videos/a-project", display_name: "a-project" },
      { channel: "my-channel", name: "b-project", path: "channels/my-channel/videos/b-project", display_name: "b-project" },
      { channel: "second-channel", name: "c-project", path: "channels/second-channel/videos/c-project", display_name: "c-project" },
    ]);
    assert.equal(status.inbox.new_count, 2);
    assert.deepEqual(status.next_action, {
      kind: "human",
      action: "review-inbox",
      reason: "inbox has 2 new items",
    });
    assert.match(formatWorkspaceStatusSummary(status), /3 projects, inbox 2 new/u);
  });
});

test("resolveWorkspaceStatus: display_name resolves title ?? folder name (task 2026-08-09-project-display-title)", async () => {
  await withTempDir(async (root) => {
    await writeRootManifest(root);
    // 1) title あり: intake.json の title を display_name に使う。
    await addProject(root, "my-channel", "with-title", {
      intake: { version: 1, tasks: [], target: { duration_s: null, keep_length: true }, autonomy: "checkpoint", status: "submitted", submitted_at: "2026-08-09T00:00:00.000Z", title: "夏祭りレポート" },
    });
    // 2) title: null（明示）: フォルダ名にフォールバックする。
    await addProject(root, "my-channel", "with-null-title", {
      intake: { version: 1, tasks: [], target: { duration_s: null, keep_length: true }, autonomy: "checkpoint", status: "draft", submitted_at: null, title: null },
    });
    // 3) intake.json 自体が無い（title キーも無い = 既存プロジェクト）: フォルダ名にフォールバックする。
    await addProject(root, "my-channel", "no-intake-at-all");

    const status = resolveWorkspaceStatus(root);
    assert.deepEqual(status.projects, [
      { channel: "my-channel", name: "no-intake-at-all", path: "channels/my-channel/videos/no-intake-at-all", display_name: "no-intake-at-all" },
      { channel: "my-channel", name: "with-null-title", path: "channels/my-channel/videos/with-null-title", display_name: "with-null-title" },
      { channel: "my-channel", name: "with-title", path: "channels/my-channel/videos/with-title", display_name: "夏祭りレポート" },
    ]);
  });
});

test("resolveWorkspaceStatus: next_action recommends create-project once inbox is empty and no projects exist", async () => {
  await withTempDir(async (root) => {
    await writeRootManifest(root);
    const status = resolveWorkspaceStatus(root);
    assert.deepEqual(status.projects, []);
    assert.equal(status.inbox.new_count, 0);
    assert.deepEqual(status.next_action, {
      kind: "human",
      action: "create-project",
      reason: "workspace has no projects yet",
    });
  });
});

test("resolveWorkspaceStatus: next_action is null once projects exist and inbox is clear", async () => {
  await withTempDir(async (root) => {
    await writeRootManifest(root);
    await addProject(root, "my-channel", "only-project");
    const status = resolveWorkspaceStatus(root);
    assert.equal(status.projects.length, 1);
    assert.equal(status.next_action, null);
  });
});

test("resolveWorkspaceStatus: missing channels/ and inbox/ directories enumerate to empty, not a crash", async () => {
  await withTempDir(async (root) => {
    await writeRootManifest(root);
    const status = resolveWorkspaceStatus(root);
    assert.deepEqual(status.projects, []);
    assert.equal(status.inbox.new_count, 0);
  });
});

test("resolveWorkspaceStatus: fail-safe — missing, malformed, or unknown-schema root.json returns null", async () => {
  await withTempDir(async (root) => {
    assert.equal(resolveWorkspaceStatus(root), null);

    await mkdir(join(root, ".akari"), { recursive: true });
    await writeFile(join(root, ".akari", "root.json"), "{not json", "utf8");
    assert.equal(resolveWorkspaceStatus(root), null);

    await writeJson(join(root, ".akari", "root.json"), { schema: "creator-root/v99", channels: [] });
    assert.equal(resolveWorkspaceStatus(root), null);
  });
});

test("runStatusCommand (terminal entry): shows workspace status at a workspace root instead of misreading it as a project", async () => {
  await withTempDir(async (root) => {
    await writeRootManifest(root);
    await writeWorkspaceConnections(root);
    await addProject(root, "my-channel", "only-project");

    const lines = [];
    const result = await runStatusCommand([root, "--json"], { log: (line) => lines.push(line) });
    assert.equal(result.exitCode, 0);
    const parsed = JSON.parse(lines.join(""));
    assert.equal(parsed.scope, "workspace");
    assert.equal(parsed.projects.length, 1);
  });
});

test("runStatusCommand (terminal entry): a broken root.json falls back to the unchanged project-scope path", async () => {
  await withTempDir(async (root) => {
    await mkdir(join(root, ".akari"), { recursive: true });
    await writeFile(join(root, ".akari", "root.json"), "{not json", "utf8");

    const lines = [];
    const result = await runStatusCommand([root, "--json"], { log: (line) => lines.push(line) });
    const parsed = JSON.parse(lines.join(""));
    assert.equal(parsed.workflow_stage, "not_scaffolded");
    assert.equal(result.exitCode, 0);
  });
});

test("runStatusCommand: human output shows CLI and install-ref body versions", async () => {
  await withTempDir(async (root) => {
    const akariHome = join(root, "isolated-akari-home");
    await mkdir(join(akariHome, "app"), { recursive: true });
    await writeFile(join(akariHome, "app", ".akari-install-ref"), "v0.1.11\n", "utf8");
    const lines = [];
    await runStatusCommand([root], {
      env: { AKARI_HOME: akariHome },
      cliVersion: "0.1.12",
      log: (line) => lines.push(line),
    });
    const output = lines.join("");
    assert.match(output, /CLI バージョン: v0\.1\.12/u);
    assert.match(output, /本体バージョン: v0\.1\.11/u);
    assert.match(output, /本体が古い/u);
  });
});

test("SessionStart hook (plugin entry): injects workspace status at a workspace root", async () => {
  await withTempDir(async (root) => {
    await writeRootManifest(root);
    await writeWorkspaceConnections(root);
    await addProject(root, "my-channel", "only-project");

    const result = command([SESSION_START_SCRIPT], root, { input: JSON.stringify({ cwd: root }) });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.match(output.hookSpecificOutput.additionalContext, /AKARI Video 作業場の続きから/u);
    assert.match(output.hookSpecificOutput.additionalContext, /"scope": "workspace"/u);
  });
});

test("SessionStart hook (plugin entry): a broken root.json stays silent (fail-safe, not a crash)", async () => {
  await withTempDir(async (root) => {
    await mkdir(join(root, ".akari"), { recursive: true });
    await writeFile(join(root, ".akari", "root.json"), "{not json", "utf8");

    const result = command([SESSION_START_SCRIPT], root, { input: JSON.stringify({ cwd: root }) });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
  });
});

test("SessionStart hook (plugin entry): project scope is unaffected by the new workspace branch", async () => {
  await withTempDir(async (root) => {
    await mkdir(join(root, ".akari"), { recursive: true });
    await writeJson(join(root, ".akari", "connections.json"), { providers: [], policy: {} });
    await writeJson(join(root, ".akari", "intake.json"), { version: 1, status: "draft" });

    const result = command([SESSION_START_SCRIPT], root, { input: JSON.stringify({ cwd: root }) });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.match(output.hookSpecificOutput.additionalContext, /AKARI Video プロジェクトの続きから/u);
  });
});

function command(argumentsList, cwd, options = {}) {
  return spawnSync(process.execPath, argumentsList, {
    cwd,
    encoding: "utf8",
    input: options.input,
    env: { ...process.env, NO_COLOR: "1" },
  });
}
