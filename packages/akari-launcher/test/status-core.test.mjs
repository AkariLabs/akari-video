import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolveProjectStatus, serializeStatus } from "../src/status-core/status.mjs";

async function withProject(callback) {
  const root = await mkdtemp(join(tmpdir(), "akari-status-core-"));
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

async function scaffold(root, intakeStatus = "submitted") {
  await writeJson(join(root, ".akari", "connections.json"), { providers: [], policy: {} });
  await writeJson(join(root, ".akari", "workflow.json"), {
    version: 1,
    roles: [],
    tree: { hidden: [], sidecarSuffixes: [] },
    events: { directory: ".akari/events", gateTypes: ["report-approved"] },
  });
  await writeJson(join(root, ".akari", "intake.json"), {
    version: 1,
    tasks: [],
    target: { duration_s: null, keep_length: false, taste: null },
    autonomy: "checkpoint",
    status: intakeStatus,
    submitted_at: intakeStatus === "submitted" ? "2026-08-03T00:00:00.000Z" : null,
  });
}

async function addMaterial(root, name, { analysisSource = `../../${name}` } = {}) {
  const source = join(root, "assets", name);
  await mkdir(join(root, "assets"), { recursive: true });
  await writeFile(source, "media", "utf8");
  const analysisPath = join(root, "assets", "analysis", name.replace(/\.[^.]+$/u, ""), "analysis.json");
  await writeJson(analysisPath, {
    version: 0,
    source: analysisSource,
    transcript: [],
    keyframes: [],
    events: [],
    tracks: { speakers: [], faces: [], person_matte: null },
  });
  return { source, analysisPath };
}

async function addPlan(root) {
  await writeJson(join(root, "plan.json"), { version: 0, slots: [], constraints: [] });
}

async function addEdit(root, sources) {
  await writeJson(join(root, "edit.json"), {
    version: 1,
    output: { width: 1920, height: 1080, fps: 30 },
    sources: sources.map((path, index) => ({ id: `s${index + 1}`, path, proxy: null })),
    cuts: sources.map((_path, index) => ({ src: `s${index + 1}`, in: 0, out: 1 })),
    overlays: [],
  });
}

test("non-project and zero-material projects route without inventing analysis", async () => {
  await withProject(async (root) => {
    let status = resolveProjectStatus(root);
    assert.equal(status.workflow_stage, "not_scaffolded");
    assert.equal(status.release.accepted, false);

    await scaffold(root);
    status = resolveProjectStatus(root);
    assert.equal(status.workflow_stage, "planning_pending");
    assert.equal(status.next_skill, "edit-plan");

    await addPlan(root);
    status = resolveProjectStatus(root);
    assert.equal(status.workflow_stage, "edit_pending");
  });
});

test("material coverage is per source and stale analyses do not count", async () => {
  await withProject(async (root) => {
    await scaffold(root);
    await addMaterial(root, "a.mp4");
    await mkdir(join(root, "assets"), { recursive: true });
    await writeFile(join(root, "assets", "b.mp4"), "media-b", "utf8");

    let status = resolveProjectStatus(root);
    assert.equal(status.workflow_stage, "analysis_pending");
    assert.match(status.waiting_on.reason, /1\/2/u);

    await addMaterial(root, "b.mp4", { analysisSource: "../../a.mp4" });
    status = resolveProjectStatus(root);
    assert.equal(status.workflow_stage, "analysis_pending");
    assert.ok(status.warnings.some((warning) => warning.includes("stale")));

    await addMaterial(root, "b.mp4");
    status = resolveProjectStatus(root);
    assert.equal(status.workflow_stage, "interpretation_pending");
    assert.equal(status.next_skill, "analyze-project");
  });
});

test("material projects do not require plan.json, while zero-material projects still do", async () => {
  await withProject(async (root) => {
    await scaffold(root);
    await addMaterial(root, "a.mp4");
    let status = resolveProjectStatus(root);
    assert.equal(status.workflow_stage, "edit_pending");

    await addEdit(root, ["assets/a.mp4"]);
    status = resolveProjectStatus(root);
    assert.equal(status.workflow_stage, "lint_pending");
  });
});

test("edit.json fixes the used source set and addressed review stays non-resolved", async () => {
  await withProject(async (root) => {
    await scaffold(root);
    await addMaterial(root, "a.mp4");
    await addMaterial(root, "unused.mp4");
    await addPlan(root);
    await addEdit(root, ["assets/a.mp4"]);
    await writeJson(join(root, "review.json"), {
      version: 0,
      annotations: [{
        id: "a-0001",
        createdAt: "2026-08-03T00:00:00.000Z",
        sourceT: 0,
        text: "handled, awaiting human check",
        input: "session",
        status: "addressed",
        response: { summary: "edited", action: "edited", respondedAt: "2026-08-03T00:01:00.000Z" },
      }],
    });

    const status = resolveProjectStatus(root);
    assert.equal(status.workflow_stage, "human_review_pending");
    assert.deepEqual(status.review, { open: 0, addressed: 1, resolved: 0, non_resolved: 1 });
    assert.equal(status.next_skill, null);
    assert.equal(status.release.accepted, false);
  });
});

test("malformed and unknown authoritative state fails closed", async () => {
  await withProject(async (root) => {
    await scaffold(root);
    await writeFile(join(root, ".akari", "intake.json"), "{broken", "utf8");
    let status = resolveProjectStatus(root);
    assert.equal(status.state_health, "inconclusive");
    assert.equal(status.workflow_stage, "state_inconclusive");
    assert.equal(status.release.accepted, false);

    await scaffold(root);
    await writeJson(join(root, ".akari", "intake.json"), { version: 99, status: "future" });
    status = resolveProjectStatus(root);
    assert.equal(status.workflow_stage, "state_inconclusive");
    assert.ok(status.problems.some((problem) => problem.includes("unsupported version")));
  });
});

test("malformed resolved review is inconclusive and is never counted as resolved", async () => {
  await withProject(async (root) => {
    await scaffold(root);
    await addMaterial(root, "a.mp4");
    await addEdit(root, ["assets/a.mp4"]);
    await writeJson(join(root, "review.json"), {
      version: 0,
      annotations: [{ id: "a-0001", status: "resolved" }],
    });
    const status = resolveProjectStatus(root);
    assert.equal(status.workflow_stage, "state_inconclusive");
    assert.equal(status.state_health, "inconclusive");
    assert.equal(status.review.resolved, 0);
    assert.ok(status.problems.some((problem) => problem.includes("createdAt")));
  });
});

test("deleting a reviewed file leaves its PASS lint stale", async () => {
  await withProject(async (root) => {
    await scaffold(root);
    await addMaterial(root, "a.mp4");
    await addEdit(root, ["assets/a.mp4"]);
    const review = {
      version: 0,
      annotations: [{
        id: "a-0001",
        createdAt: "2026-08-03T00:00:00.000Z",
        sourceT: 0,
        text: "agent addressed, awaiting human resolution",
        input: "session",
        status: "addressed",
        response: { summary: "edited", action: "edited", respondedAt: "2026-08-03T00:01:00.000Z" },
      }],
    };
    await writeJson(join(root, "review.json"), review);
    const editText = await readFile(join(root, "edit.json"), "utf8");
    const reviewText = await readFile(join(root, "review.json"), "utf8");
    await writeJson(join(root, ".akari", "lint.json"), {
      version: 1,
      verdict: "pass",
      inputs: {
        edit_json_sha256: createHash("sha256").update(editText).digest("hex"),
        review_json_sha256: createHash("sha256").update(reviewText).digest("hex"),
      },
    });
    assert.equal(resolveProjectStatus(root).workflow_stage, "human_review_pending");
    await rm(join(root, "review.json"));
    const status = resolveProjectStatus(root);
    assert.equal(status.workflow_stage, "lint_pending");
    assert.equal(status.release.accepted, false);
  });
});

test("fast JSON is stable, path-free, time-free, and stays within the 250ms p95 budget", async () => {
  await withProject(async (root) => {
    await scaffold(root);
    const first = serializeStatus(resolveProjectStatus(root));
    const second = serializeStatus(resolveProjectStatus(root));
    assert.equal(first, second);
    assert.equal(first.endsWith("\n"), true);
    assert.equal(first.includes(root), false);
    assert.equal(first.includes(new Date().getUTCFullYear().toString()), false);

    const samples = [];
    for (let index = 0; index < 40; index += 1) {
      const started = performance.now();
      resolveProjectStatus(root);
      samples.push(performance.now() - started);
    }
    samples.sort((left, right) => left - right);
    const p95 = samples[Math.ceil(samples.length * 0.95) - 1];
    assert.ok(p95 < 250, `fast status p95 ${p95.toFixed(2)}ms must be <250ms`);
  });
});
