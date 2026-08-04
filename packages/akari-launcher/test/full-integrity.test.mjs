import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import test from "node:test";

import { runAcceptCommand } from "../src/accept-command.mjs";
import { contentAddressedJsonFilenameMatches, inspectFullIntegrity } from "../src/status-core/integrity.mjs";
import { resolveFullProjectStatus, resolveProjectStatus } from "../src/status-core/status.mjs";
import { createIntegrityFixture, sha256, writeJson } from "./helpers/integrity-fixture.mjs";

const inconclusiveAudioQc = {
  configured: { integrated_lufs: -14, true_peak_dbtp: -1.7 },
  filter_report: {
    normalized: { output_i: -14.52, output_tp: -1.7 },
    raw: { output_i: "-14.52", output_tp: "-1.70" },
  },
  decoded_measurement: {
    metric: "ffmpeg-loudnorm-input-v1",
    normalized: { input_i: -14.89, input_tp: -1.51 },
    raw: { input_i: "-14.89", input_tp: "-1.51" },
  },
  tool_version: "ffmpeg fixture",
  verdict: "INCONCLUSIVE",
};

async function withFixture(callback, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "akari-integrity-"));
  try {
    await createIntegrityFixture(root, options);
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("content-addressed render receipt and caption layout filenames use Windows basename semantics", () => {
  const sha = "a".repeat(64);
  const windowsBasename = value => win32.basename(value);
  for (const kind of ["render-receipts", "caption-layout"]) {
    assert.equal(contentAddressedJsonFilenameMatches(
      `C:\\projects\\demo\\.akari\\reports\\${kind}\\${sha}.json`, sha, windowsBasename,
    ), true, `${kind} positive`);
    assert.equal(contentAddressedJsonFilenameMatches(
      `C:\\projects\\demo\\.akari\\reports\\${kind}\\prefix-${sha}.json`, sha, windowsBasename,
    ), false, `${kind} prefixed negative`);
    assert.equal(contentAddressedJsonFilenameMatches(
      `C:\\projects\\demo\\.akari\\reports\\${kind}\\${sha}.json.bak`, sha, windowsBasename,
    ), false, `${kind} suffix negative`);
  }
});

test("fast status never accepts and full status requires a matching TTY-issued acceptance", async () => {
  await withFixture(async (root) => {
    const fast = resolveProjectStatus(root);
    assert.equal(fast.workflow_stage, "acceptance_pending");
    assert.equal(fast.release.accepted, false);

    const before = await resolveFullProjectStatus(root);
    assert.equal(before.release.state, "ready_for_acceptance");
    assert.equal(before.release.accepted, false);

    let errors = "";
    const nonTty = await runAcceptCommand([root], { isTTY: false, error: (line) => { errors += line; }, log: () => {} });
    assert.equal(nonTty.exitCode, 2);
    assert.match(errors, /requires an interactive input and output TTY/u);

    const flag = await runAcceptCommand([root, "--yes"], { isTTY: true, error: () => {}, log: () => {} });
    assert.equal(flag.exitCode, 2);

    const integrity = await inspectFullIntegrity(root);
    const answers = ["review-owner", "I approve this final artifact for release.", `ACCEPT ${integrity.candidate.artifact_sha256}`];
    const accepted = await runAcceptCommand([root], {
      isTTY: true,
      prompt: async () => answers.shift(),
      error: () => {},
      log: () => {},
      id: "acceptance-fixture",
      now: "2026-08-03T00:00:01.000Z",
    });
    assert.equal(accepted.exitCode, 0);
    assert.deepEqual(accepted.event.actor, { kind: "human", id: "review-owner" });
    assert.deepEqual(accepted.event.issuer, { kind: "akari-cli-tty", version: 1 });
    assert.equal(accepted.event.verbatim, "I approve this final artifact for release.");

    const after = await resolveFullProjectStatus(root);
    assert.equal(after.workflow_stage, "accepted_verified");
    assert.equal(after.release.accepted, true);
    assert.equal(resolveProjectStatus(root).release.accepted, false);

    await writeJson(join(root, ".akari", "events", "revoke.json"), {
      version: 1,
      id: "revoke-fixture",
      type: "final-acceptance-revoked",
      occurredAt: "2026-08-03T00:00:02.000Z",
      acceptance_id: "acceptance-fixture",
      reason: "fixture revocation",
    });
    const revoked = await resolveFullProjectStatus(root);
    assert.equal(revoked.release.state, "acceptance_revoked");
    assert.equal(revoked.release.accepted, false);
  });
});

test("full integrity fails closed for every normal declared role and acceptance boundary", async (t) => {
  const mutations = [
    ["edit", "edit.json", '{"version":1,"sources":[],"cuts":[],"overlays":[],"output":{"path":"exports/final.mp4"}}\n'],
    ["captions", "captions.json", '{"version":1,"captions":[]}\n'],
    ["source", "assets/source.mp4", "mutated source\n"],
    ["narration", "audio/narration.wav", "mutated narration\n"],
    ["BGM", "audio/bgm.wav", "mutated bgm\n"],
    ["SFX", "audio/sfx.wav", "mutated sfx\n"],
    ["overlay", "overlays/caption.html", "<div>mutated overlay</div>\n"],
    ["resolved LUT", "looks/custom.cube", "TITLE mutated\nLUT_3D_SIZE 2\n"],
    ["output", "exports/final.mp4", "mutated output\n"],
    ["review", "review.json", '{"version":0,"annotations":[]}\n'],
    ["lint", ".akari/lint.json", '{"version":1,"verdict":"pass","inputs":{}}\n'],
  ];
  for (const [name, path, bytes] of mutations) {
    await t.test(name, async () => {
      await withFixture(async (root) => {
        const before = await inspectFullIntegrity(root);
        assert.equal(before.ok, true, before.problems.join("; "));
        assert.ok(before.candidate);
        await writeFile(join(root, path), bytes, "utf8");
        const integrity = await inspectFullIntegrity(root);
        assert.equal(integrity.ok, false);
        assert.equal(integrity.candidate, null);
        const status = await resolveFullProjectStatus(root);
        assert.equal(status.release.accepted, false);
        assert.notEqual(status.release.state, "ready_for_acceptance");
      }, { fullRoleInputs: true });
    });
  }
});

test("a content-addressed receipt that tampers the caption-font digest is rejected", async () => {
  await withFixture(async (root) => {
    const renderPath = join(root, ".akari", "render.json");
    const render = JSON.parse(await readFile(renderPath, "utf8"));
    const receiptPath = join(root, render.render_receipt.path);
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    const font = receipt.inputs.find(input => input.role === "caption-font");
    assert.ok(font, "full-role receipt must contain caption-font");
    font.sha256 = "0".repeat(64);
    const bytes = `${JSON.stringify(receipt, null, 2)}\n`;
    const digest = sha256(bytes);
    const tamperedPath = join(root, ".akari", "reports", "render-receipts", `${digest}.json`);
    await writeFile(tamperedPath, bytes, "utf8");
    render.render_receipt = {
      path: `.akari/reports/render-receipts/${digest}.json`,
      sha256: digest,
    };
    await writeJson(renderPath, render);

    const integrity = await inspectFullIntegrity(root);
    assert.equal(integrity.ok, false);
    assert.equal(integrity.candidate, null);
    assert.ok(integrity.problems.some(problem => problem.includes("caption-font")));
    const status = await resolveFullProjectStatus(root);
    assert.equal(status.release.accepted, false);
    assert.notEqual(status.release.state, "ready_for_acceptance");
  }, { fullRoleInputs: true });
});

test("deleting review.json after lint and render cannot become ready for acceptance", async () => {
  await withFixture(async (root) => {
    await rm(join(root, "review.json"));
    const fast = resolveProjectStatus(root);
    const full = await resolveFullProjectStatus(root);
    assert.equal(fast.workflow_stage, "lint_pending");
    assert.equal(full.workflow_stage, "lint_pending");
    assert.equal(full.release.accepted, false);
  });
});

test("accept requires a separate non-empty human statement before checksum confirmation", async () => {
  await withFixture(async (root) => {
    const answers = ["review-owner", "   "];
    let errors = "";
    const result = await runAcceptCommand([root], {
      isTTY: true,
      prompt: async () => answers.shift(),
      error: (line) => { errors += line; },
      log: () => {},
    });
    assert.equal(result.exitCode, 1);
    assert.match(errors, /final acceptance statement must not be empty/u);
    const status = await resolveFullProjectStatus(root);
    assert.equal(status.release.state, "ready_for_acceptance");
    assert.equal(status.release.accepted, false);

    const wrongChecksumAnswers = ["review-owner", "I approve this artifact.", "ACCEPT wrong-checksum"];
    errors = "";
    const wrongChecksum = await runAcceptCommand([root], {
      isTTY: true,
      prompt: async () => wrongChecksumAnswers.shift(),
      error: (line) => { errors += line; },
      log: () => {},
    });
    assert.equal(wrongChecksum.exitCode, 1);
    assert.match(errors, /checksum confirmation did not match exactly/u);
    assert.equal((await resolveFullProjectStatus(root)).release.accepted, false);
  });
});

test("earlier revocation is inconclusive in both fast and full status", async () => {
  await withFixture(async (root) => {
    const integrity = await inspectFullIntegrity(root);
    const answers = ["review-owner", "I approve this artifact.", `ACCEPT ${integrity.candidate.artifact_sha256}`];
    const accepted = await runAcceptCommand([root], {
      isTTY: true,
      prompt: async () => answers.shift(),
      error: () => {},
      log: () => {},
      id: "acceptance-after-revoke",
      now: "2026-08-03T00:00:02.000Z",
    });
    assert.equal(accepted.exitCode, 0);
    await writeJson(join(root, ".akari", "events", "earlier-revoke.json"), {
      version: 1,
      id: "earlier-revoke",
      type: "final-acceptance-revoked",
      occurredAt: "2026-08-03T00:00:01.000Z",
      acceptance_id: "acceptance-after-revoke",
      reason: "invalid earlier revoke",
    });
    const fast = resolveProjectStatus(root);
    const full = await resolveFullProjectStatus(root);
    assert.equal(fast.state_health, "inconclusive");
    assert.equal(full.state_health, "inconclusive");
    assert.equal(fast.release.accepted, false);
    assert.equal(full.release.accepted, false);
  });
});

test("a stale receipt or an AI-authored acceptance event cannot accept the project", async () => {
  await withFixture(async (root) => {
    const integrity = await inspectFullIntegrity(root);
    await mkdir(join(root, ".akari", "events"), { recursive: true });
    await writeJson(join(root, ".akari", "events", "ai.json"), {
      version: 1,
      id: "ai-event",
      type: "final-acceptance",
      occurredAt: "2026-08-03T00:00:01Z",
      actor: { kind: "ai", id: "agent" },
      issuer: { kind: "akari-cli-tty", version: 1 },
      artifact: integrity.candidate.artifact,
      artifact_sha256: integrity.candidate.artifact_sha256,
      render_receipt: integrity.candidate.receipt,
      render_receipt_sha256: integrity.candidate.receipt_sha256,
      review_sha256: integrity.candidate.review_sha256,
      verbatim: "accepted",
    });
    const invalidEvent = await resolveFullProjectStatus(root);
    assert.equal(invalidEvent.state_health, "inconclusive");
    assert.equal(invalidEvent.release.accepted, false);
  });

  await withFixture(async (root) => {
    const renderPath = join(root, ".akari", "render.json");
    const render = JSON.parse(await readFile(renderPath, "utf8"));
    render.phase = "planned";
    render.verify = null;
    await writeJson(renderPath, render);
    const status = await resolveFullProjectStatus(root);
    assert.equal(status.workflow_stage, "render_pending");
    assert.equal(status.release.accepted, false);
  });
});

test("audio QC is integrity-checked and shown before the checksum confirmation", async () => {
  const root = await mkdtemp(join(tmpdir(), "akari-integrity-audio-qc-"));
  try {
    await createIntegrityFixture(root, { audioQc: inconclusiveAudioQc });
    const integrity = await inspectFullIntegrity(root);
    assert.equal(integrity.ok, true, integrity.problems.join("; "));
    assert.ok(integrity.warnings.some(value => value.includes("INCONCLUSIVE")));

    const order = [];
    const answers = ["review-owner", "I reviewed the unresolved audio measurements.", `ACCEPT ${integrity.candidate.artifact_sha256}`];
    const accepted = await runAcceptCommand([root], {
      isTTY: true,
      prompt: async (question) => { order.push(`prompt:${question}`); return answers.shift(); },
      log: (line) => { order.push(`log:${line}`); },
      error: () => {},
      id: "audio-qc-acceptance",
      now: "2026-08-03T00:00:03.000Z",
    });
    assert.equal(accepted.exitCode, 0);
    const warningIndex = order.findIndex(value => value.includes("audio_qc is INCONCLUSIVE"));
    const checksumIndex = order.findIndex(value => value.includes("Type exactly"));
    assert.ok(warningIndex >= 0 && warningIndex < checksumIndex, JSON.stringify(order));
    assert.ok(order.some(value => value.includes('"output_tp":-1.7')));
    assert.ok(order.some(value => value.includes('"input_tp":-1.51')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("audio QC raw/normalized tamper and MEASUREMENT_ERROR both reject the candidate", async () => {
  const tamperedRoot = await mkdtemp(join(tmpdir(), "akari-integrity-audio-tamper-"));
  const errorRoot = await mkdtemp(join(tmpdir(), "akari-integrity-audio-error-"));
  try {
    await createIntegrityFixture(tamperedRoot, {
      audioQc: {
        ...inconclusiveAudioQc,
        decoded_measurement: {
          ...inconclusiveAudioQc.decoded_measurement,
          normalized: { input_i: -14.89, input_tp: -1.7 },
        },
      },
    });
    const tampered = await inspectFullIntegrity(tamperedRoot);
    assert.equal(tampered.ok, false);
    assert.equal(tampered.candidate, null);
    assert.ok(tampered.problems.some(value => value.includes("raw/normalized values disagree")));

    await createIntegrityFixture(errorRoot, {
      audioQc: {
        configured: { integrated_lufs: -14, true_peak_dbtp: -1.7 },
        filter_report: inconclusiveAudioQc.filter_report,
        decoded_measurement: null,
        tool_version: "ffmpeg fixture",
        verdict: "MEASUREMENT_ERROR",
        error: { phase: "decoded_measurement", code: "MISSING_FIELD", message: "input_tp is missing" },
      },
    });
    const failed = await inspectFullIntegrity(errorRoot);
    assert.equal(failed.ok, false);
    assert.equal(failed.candidate, null);
    assert.ok(failed.problems.includes("audio_qc measurement failed"));
  } finally {
    await rm(tamperedRoot, { recursive: true, force: true });
    await rm(errorRoot, { recursive: true, force: true });
  }
});

test("audio QC receipt accepts strict decimal exponent/negative-zero forms and rejects coercive raw strings", async (t) => {
  const validRoot = await mkdtemp(join(tmpdir(), "akari-integrity-audio-decimal-valid-"));
  try {
    await createIntegrityFixture(validRoot, {
      audioQc: {
        ...inconclusiveAudioQc,
        filter_report: {
          normalized: { output_i: 10, output_tp: 0 },
          raw: { output_i: "+1e1", output_tp: "-0" },
        },
        decoded_measurement: {
          metric: "ffmpeg-loudnorm-input-v1",
          normalized: { input_i: 0.125, input_tp: 0.5 },
          raw: { input_i: "+1.25E-1", input_tp: ".5" },
        },
      },
    });
    const valid = await inspectFullIntegrity(validRoot);
    assert.equal(valid.ok, true, valid.problems.join("; "));
  } finally {
    await rm(validRoot, { recursive: true, force: true });
  }

  for (const [index, raw] of ["", " ", "0x10", "Infinity", "NaN", "+", "1_0", "1,0", "--1", "1e", "-inf "].entries()) {
    await t.test(`coercive raw ${index + 1}`, async () => {
      const root = await mkdtemp(join(tmpdir(), "akari-integrity-audio-decimal-invalid-"));
      try {
        await createIntegrityFixture(root, {
          audioQc: {
            ...inconclusiveAudioQc,
            filter_report: {
              ...inconclusiveAudioQc.filter_report,
              normalized: { ...inconclusiveAudioQc.filter_report.normalized, output_i: 0 },
              raw: { ...inconclusiveAudioQc.filter_report.raw, output_i: raw },
            },
          },
        });
        const invalid = await inspectFullIntegrity(root);
        assert.equal(invalid.ok, false);
        assert.equal(invalid.candidate, null);
        assert.ok(invalid.problems.some(value => value.includes("raw/normalized values disagree")));
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});
