import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { enumerateDeclaredRenderInputs, hashDeclaredRenderInputs } from "../../render-cut/src/render-inputs.mjs";
import { createImmutableRenderReceipt } from "../../render-cut/src/render-receipt.mjs";
import { runAcceptCommand } from "../src/accept-command.mjs";
import { inspectFullIntegrity } from "../src/status-core/integrity.mjs";
import { resolveFullProjectStatus } from "../src/status-core/status.mjs";
import { writeJson } from "./helpers/integrity-fixture.mjs";
import migrate from "../../edit-store/lib/migrate/index.js";

const { migrateEditToV2 } = migrate;

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

test("compile -> address -> lint -> human resolve -> full acceptance uses the real review commands", async () => {
  const root = await mkdtemp(join(tmpdir(), "akari-review-e2e-"));
  try {
    const sourceSession = join(
      REPO_ROOT,
      "skills/compile-review-session/dev-fixtures/fixture-project/review/sessions/s-0008",
    );
    const sessionDirectory = join(root, "review", "sessions", "s-0008");
    await mkdir(join(root, "review", "sessions"), { recursive: true });
    await cp(sourceSession, sessionDirectory, { recursive: true });
    const edit = JSON.parse(await readFile(join(sessionDirectory, "edit.snapshot.json"), "utf8"));
    const migrated = migrateEditToV2(edit);
    assert.equal(migrated.ok, true);
    await writeJson(join(root, "edit.json"), migrated.doc);
    await writeFile(join(root, "review.json"), '{\n  "version": 0,\n  "annotations": [\n  ]\n}\n', "utf8");
    await writeFile(join(root, "source.mp4"), "review-e2e-source\n", "utf8");
    await writeJson(join(root, "analysis.json"), { version: 0, source: "source.mp4", duration: 200 });
    await writeJson(join(sessionDirectory, "transcript.json"), {
      version: 1,
      backend: "fixture",
      model: "fixture",
      language: "ja",
      segments: [{
        start: 0.2,
        end: 3,
        text: "BGMの音量をもう少し下げてください",
        words: [{ start: 0.2, end: 3, text: "BGMの音量をもう少し下げてください" }],
      }],
    });

    const compiled = runNode([
      "skills/compile-review-session/bin/compile-review-session.mjs",
      root,
      "--session",
      "s-0008",
      "--json",
    ]);
    assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout);
    assert.equal(JSON.parse(compiled.stdout).totals.annotations, 1);

    const lintBefore = runNode(["packages/edit-lint/bin/edit-lint.mjs", root, "--json"]);
    assert.equal(lintBefore.status, 0, lintBefore.stderr || lintBefore.stdout);

    const listed = runNode(["skills/address-review/bin/list.mjs", root, "--all-open", "--json"]);
    assert.equal(listed.status, 0, listed.stderr);
    const listedPayload = JSON.parse(listed.stdout);
    const ids = [...listedPayload.targets, ...listedPayload.skipped].map((annotation) => annotation.id);
    assert.equal(ids.length, 1);
    for (const id of ids) {
      const addressed = runNode([
        "skills/address-review/bin/respond.mjs",
        root,
        "--id",
        id,
        "--action",
        "edited",
        "--summary",
        "fixture edit verified by edit-lint",
        "--json",
      ]);
      assert.equal(addressed.status, 0, addressed.stderr || addressed.stdout);
    }

    await mkdir(join(root, ".akari"), { recursive: true });
    await writeJson(join(root, ".akari", "connections.json"), { version: 1 });
    await writeJson(join(root, ".akari", "workflow.json"), { version: 1, roles: [], events: {} });
    await writeJson(join(root, ".akari", "intake.json"), {
      version: 1,
      tasks: ["bgm-sfx"],
      target: { duration_s: null, keep_length: true, taste: null },
      autonomy: "checkpoint",
      status: "submitted",
      submitted_at: "2026-08-03T00:00:00.000Z",
    });
    await writeJson(join(root, "plan.json"), { version: 0, slots: [] });
    const addressedStatus = await resolveFullProjectStatus(root);
    assert.equal(addressedStatus.workflow_stage, "human_review_pending");
    assert.equal(addressedStatus.review.addressed, 1);
    assert.equal(addressedStatus.release.accepted, false);

    const review = JSON.parse(await readFile(join(root, "review.json"), "utf8"));
    for (const annotation of review.annotations) annotation.status = "resolved";
    await writeJson(join(root, "review.json"), review);
    const lintAfterHumanResolve = runNode(["packages/edit-lint/bin/edit-lint.mjs", root, "--json"]);
    assert.equal(lintAfterHumanResolve.status, 0, lintAfterHumanResolve.stderr || lintAfterHumanResolve.stdout);

    await mkdir(join(root, "exports"), { recursive: true });
    await writeFile(join(root, "exports", "final.mp4"), "review-e2e-output\n", "utf8");
    const editText = await readFile(join(root, "edit.json"), "utf8");
    const declaredInputs = await enumerateDeclaredRenderInputs({ projectRoot: root, edit, editText });
    const inputSnapshot = await hashDeclaredRenderInputs(declaredInputs, { useConsumedText: true });
    const renderPlan = { renderer: "review-e2e", output: "exports/final.mp4" };
    const receipt = await createImmutableRenderReceipt({
      projectRoot: root,
      declaredInputs,
      inputSnapshot,
      outputPath: join(root, "exports", "final.mp4"),
      ffprobe: { duration: 50 },
      plan: renderPlan,
      verify: { verdict: "pass" },
      tools: { fixture: "1" },
      createdAt: "2026-08-03T01:00:00.000Z",
    });
    await writeJson(join(root, ".akari", "render.json"), {
      version: 1,
      phase: "verified",
      plan: renderPlan,
      verify: { verdict: "pass" },
      render_receipt: { path: receipt.path, sha256: receipt.sha256 },
    });

    const integrity = await inspectFullIntegrity(root);
    assert.equal(integrity.ok, true, integrity.problems.join("; "));
    const answers = ["human-reviewer", "I accept the reviewed final cut.", `ACCEPT ${integrity.candidate.artifact_sha256}`];
    const acceptance = await runAcceptCommand([root], {
      isTTY: true,
      prompt: async () => answers.shift(),
      log: () => {},
      error: () => {},
      id: "review-e2e-acceptance",
      now: "2026-08-03T01:00:01.000Z",
    });
    assert.equal(acceptance.exitCode, 0);
    const final = await resolveFullProjectStatus(root);
    assert.equal(final.workflow_stage, "accepted_verified");
    assert.equal(final.review.resolved, 1);
    assert.equal(final.review.non_resolved, 0);
    assert.equal(final.release.accepted, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function runNode(argumentsList) {
  return spawnSync(process.execPath, argumentsList, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
}
