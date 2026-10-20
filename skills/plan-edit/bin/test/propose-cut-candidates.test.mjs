import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

import { canonicalBytes, sha256 } from "../canonical-json.mjs";
import {
  addAnalysisRecords,
  checkBudget,
  discoverLocalEsmModules,
  policyValues,
} from "../propose-cut-candidates.mjs";

const skillRoot = path.resolve(import.meta.dirname, "../..");
const cli = path.join(skillRoot, "bin", "propose-cut-candidates.mjs");
const require = createRequire(import.meta.url);
const validators = require(path.join(skillRoot, "bin", "generated", "contract-validators.cjs"));

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "akari-cut-candidates-"));
  const source = path.join(root, "assets", "desk.mp4");
  const analysisDirectory = path.join(root, ".akari", "sidecars", "assets", "desk.mp4.analysis");
  const keyframe = path.join(analysisDirectory, "keyframes", "screen.jpg");
  await mkdir(path.join(root, ".akari", "work"), { recursive: true });
  await mkdir(path.join(root, "edit-plan"), { recursive: true });
  await mkdir(path.dirname(source), { recursive: true });
  await mkdir(path.dirname(keyframe), { recursive: true });
  await writeFile(path.join(root, ".akari", "connections.json"), "{\"version\":1}\n");
  await writeFile(source, "fixture-media\n");
  await writeFile(keyframe, "fixture-image\n");
  await writeFile(path.join(root, ".akari", "work", "semantic-keep-plan.json"), `${JSON.stringify({
    version: 1,
    kind: "akari-semantic-keep-plan-v1",
    intended_edit_version: 1,
    candidate_frame_rate: 30,
    sources: [{ id: "desk", path: "assets/desk.mp4" }],
    occurrences: [{ source_index: 0, range: { mode: "explicit", in: 0, out: 12 } }],
  })}\n`);
  await writeFile(path.join(root, "edit-plan", "decision-log.md"), "# decision log\n");
  await writeFile(path.join(root, "edit-plan", "edit.json"), "{\"version\":0,\"source\":\"assets/desk.mp4\",\"cuts\":[]}\n");
  await writeFile(path.join(analysisDirectory, "analysis.json"), `${JSON.stringify({
    version: 0,
    source: path.relative(analysisDirectory, source),
    transcript: [
      { start: 8, end: 9.9, text: "前です", words: [{ start: 9.7, end: 9.9, text: "前" }] },
      { start: 10.9, end: 11.5, text: "次です", words: [{ start: 10.9, end: 11.1, text: "次" }] },
    ],
    keyframes: [{ t: 10.4, path: "keyframes/screen.jpg", note: "screen", origin: "interval" }],
    events: [{ type: "filler", start: 4, end: 4.4 }],
    tracks: { speakers: [], faces: [], person_matte: null },
  })}\n`);

  const ffprobe = path.join(root, "ffprobe-fixture");
  const ffmpeg = path.join(root, "ffmpeg-fixture");
  const inheritedEnvironmentGuard = "if [ \"${FFREPORT+x}\" = x ] || [ \"${AKARI_TEST_POISON+x}\" = x ]; then exit 91; fi";
  await writeFile(ffprobe, `#!/bin/sh\n${inheritedEnvironmentGuard}\nif [ \"$1\" = \"-version\" ]; then printf 'ffprobe version fixture\\nconfiguration /not-for-receipt\\n'; exit 0; fi\nprintf '{\"format\":{\"duration\":\"12\",\"format_name\":\"mov,mp4,m4a,3gp,3g2,mj2\"},\"streams\":[{\"index\":0,\"codec_type\":\"video\",\"duration\":\"12\"},{\"index\":2,\"codec_type\":\"audio\",\"duration\":\"12\"}]}'\n`);
  await writeFile(ffmpeg, `#!/bin/sh\n${inheritedEnvironmentGuard}\nif [ \"$1\" = \"-version\" ]; then printf 'ffmpeg version fixture\\nconfiguration /not-for-receipt\\n'; exit 0; fi\nprintf 'silence_start: 10\\nsilence_end: 10.8\\n' >&2\n`);
  await chmod(ffprobe, 0o755);
  await chmod(ffmpeg, 0o755);
  return { root, ffprobe, ffmpeg, source, analysisDirectory, keyframe };
}

function execute(root, ffprobe, ffmpeg, write = false, options = {}) {
  const argumentsList = [
    cli,
    "--project", root,
    "--keep-plan", options.keepPlan ?? ".akari/work/semantic-keep-plan.json",
    "--decision-log", options.decisionLog ?? "edit-plan/decision-log.md",
    "--approval-ref", options.approvalRef ?? "checkpoint-1/cut-direction/2026-08-03",
    ...(write ? ["--write"] : []),
  ];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, argumentsList, {
      env: {
        ...process.env,
        AKARI_FFPROBE_BIN: ffprobe,
        AKARI_FFMPEG_BIN: ffmpeg,
        FFREPORT: "poison",
        AKARI_TEST_POISON: "poison",
        ...options.environment,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("close", (status) => resolve({ status, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }));
  });
}

async function writeKeepPlan(root, plan) {
  await writeFile(path.join(root, ".akari", "work", "semantic-keep-plan.json"), `${JSON.stringify(plan)}\n`);
}

async function writeProbeFixture(file, probe) {
  await writeFile(file, `#!/bin/sh\nif [ "$1" = "-version" ]; then printf 'ffprobe version fixture\\n'; exit 0; fi\nprintf '%s' '${JSON.stringify(probe)}'\n`);
  await chmod(file, 0o755);
}

function closedCode(result) {
  assert.equal(result.stdout.length, 0);
  return JSON.parse(result.stderr).code;
}

test("CLI emits a schema-valid canonical review-only report and --write preserves stdout bytes", async () => {
  const value = await fixture();
  try {
    const editPath = path.join(value.root, "edit-plan", "edit.json");
    const logPath = path.join(value.root, "edit-plan", "decision-log.md");
    const editBefore = sha256(await readFile(editPath));
    const logBefore = sha256(await readFile(logPath));
    const dry = await execute(value.root, value.ffprobe, value.ffmpeg);
    assert.equal(dry.status, 0, dry.stderr.toString());
    assert.equal(dry.stderr.length, 0);
    const report = JSON.parse(dry.stdout);
    assert.equal(validators.validateCutCandidates(report), true, JSON.stringify(validators.validateCutCandidates.errors));
    assert.equal(report.approved_to_apply, false);
    assert.equal(report.edit_json_modified, false);
    assert.equal(report.tool.ffmpeg.version, "ffmpeg version fixture");
    assert.equal(report.tool.ffprobe.version, "ffprobe version fixture");
    assert.equal(dry.stdout.includes(Buffer.from("not-for-receipt")), false);
    assert.equal(report.candidates.length, 2);
    assert.deepEqual(report.candidates.map((candidate) => candidate.family), [
      "semantic_event_review", "pause_shortening_review",
    ]);
    assert.deepEqual(report.candidates[1].proposal, {
      actual_retained_seconds: 0.133334,
      fps: 30,
      raw_remove_end: 10.75,
      raw_remove_start: 10.05,
      remove_end: 10.733333,
      remove_end_frame: 322,
      remove_start: 10.066667,
      remove_start_frame: 302,
      target_retained_seconds: 0.1,
    });
    assert.equal(dry.stdout.equals(canonicalBytes(report)), true);
    assert.equal(sha256(await readFile(editPath)), editBefore);
    assert.equal(sha256(await readFile(logPath)), logBefore);
    await assert.rejects(() => readdir(path.join(value.root, ".akari", "reports")), { code: "ENOENT" });

    const written = await execute(value.root, value.ffprobe, value.ffmpeg, true);
    assert.equal(written.status, 0, written.stderr.toString());
    assert.equal(written.stderr.length, 0);
    assert.equal(written.stdout.equals(dry.stdout), true);
    const files = await readdir(path.join(value.root, ".akari", "reports", "cut-candidates"));
    assert.deepEqual(files, [`${sha256(dry.stdout)}.json`]);
    assert.equal((await readFile(path.join(value.root, ".akari", "reports", "cut-candidates", files[0]))).equals(dry.stdout), true);
    assert.equal(sha256(await readFile(editPath)), editBefore);
    assert.equal(sha256(await readFile(logPath)), logBefore);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("CLI failure is one closed canonical JSON line with empty stdout", async () => {
  const child = await new Promise((resolve) => {
    const running = spawn(process.execPath, [cli, "--apply"], { stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    running.stdout.on("data", (chunk) => stdout.push(chunk));
    running.stderr.on("data", (chunk) => stderr.push(chunk));
    running.on("close", (status) => resolve({ status, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }));
  });
  assert.equal(child.status, 2);
  assert.equal(child.stdout.length, 0);
  assert.equal(child.stderr.toString().endsWith("\n"), true);
  assert.deepEqual(JSON.parse(child.stderr), {
    code: "USAGE_ERROR",
    kind: "akari-cut-candidate-error-v1",
    message: "Command arguments do not match the cut candidate contract.",
    phase: "USAGE",
    version: 1,
  });
});

test("empty timeline does not probe unused sources or require their analysis", async () => {
  const value = await fixture();
  try {
    await writeFile(path.join(value.root, ".akari", "work", "semantic-keep-plan.json"), `${JSON.stringify({
      version: 1,
      kind: "akari-semantic-keep-plan-v1",
      intended_edit_version: 1,
      candidate_frame_rate: 30,
      sources: [{ id: "unused", path: "assets/does-not-exist.mp4" }],
      occurrences: [],
    })}\n`);
    const executed = await execute(value.root, value.ffprobe, value.ffmpeg);
    assert.equal(executed.status, 0, executed.stderr.toString());
    const report = JSON.parse(executed.stdout);
    assert.deepEqual(report.inputs.processed_sources, []);
    assert.deepEqual(report.inputs.analyses, []);
    assert.deepEqual(report.candidates, []);
    assert.deepEqual(report.skipped, []);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("v0 null-id and active multi-source mappings remain explicit and deterministic", async () => {
  const value = await fixture();
  try {
    await writeKeepPlan(value.root, {
      version: 1,
      kind: "akari-semantic-keep-plan-v1",
      intended_edit_version: 0,
      candidate_frame_rate: 30,
      sources: [{ id: null, path: "assets/./desk.mp4" }],
      occurrences: [{ source_index: 0, range: { mode: "full_source" } }],
    });
    const v0 = await execute(value.root, value.ffprobe, value.ffmpeg);
    assert.equal(v0.status, 0, v0.stderr.toString());
    const v0Report = JSON.parse(v0.stdout);
    assert.deepEqual(v0Report.inputs.processed_sources.map((entry) => [entry.id, entry.path]), [[null, "assets/desk.mp4"]]);
    assert.ok(v0Report.candidates.every((entry) => entry.src === null));

    const secondSource = path.join(value.root, "assets", "alt.mp4");
    const secondAnalysisDirectory = path.join(value.root, ".akari", "sidecars", "assets", "alt.mp4.analysis");
    await writeFile(secondSource, "fixture-media-alt\n");
    await mkdir(secondAnalysisDirectory, { recursive: true });
    await writeFile(path.join(secondAnalysisDirectory, "analysis.json"), `${JSON.stringify({
      version: 0,
      source: path.relative(secondAnalysisDirectory, secondSource),
      transcript: [
        { start: 8, end: 9.9, text: "前です", words: [{ start: 9.7, end: 9.9, text: "前" }] },
        { start: 10.9, end: 11.5, text: "次です", words: [{ start: 10.9, end: 11.1, text: "次" }] },
      ],
      keyframes: [], events: [], tracks: { speakers: [], faces: [], person_matte: null },
    })}\n`);
    await writeKeepPlan(value.root, {
      version: 1,
      kind: "akari-semantic-keep-plan-v1",
      intended_edit_version: 1,
      candidate_frame_rate: 30,
      sources: [{ id: "desk", path: "assets/desk.mp4" }, { id: "alt", path: "assets/alt.mp4" }],
      occurrences: [
        { source_index: 1, range: { mode: "explicit", in: 0, out: 12 } },
        { source_index: 0, range: { mode: "explicit", in: 0, out: 12 } },
      ],
    });
    const multi = await execute(value.root, value.ffprobe, value.ffmpeg);
    assert.equal(multi.status, 0, multi.stderr.toString());
    const multiReport = JSON.parse(multi.stdout);
    assert.deepEqual(multiReport.inputs.processed_sources.map((entry) => entry.id), ["desk", "alt"]);
    assert.deepEqual([...new Set(multiReport.candidates.map((entry) => entry.src))], ["desk", "alt"]);
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("duration endpoint is inclusive but one-frame overflow fails closed", async () => {
  const value = await fixture();
  try {
    const exact = await execute(value.root, value.ffprobe, value.ffmpeg);
    assert.equal(exact.status, 0, exact.stderr.toString());
    const plan = JSON.parse(await readFile(path.join(value.root, ".akari", "work", "semantic-keep-plan.json")));
    plan.occurrences[0].range.out = 12 + 1 / 30;
    await writeKeepPlan(value.root, plan);
    const overflow = await execute(value.root, value.ffprobe, value.ffmpeg);
    assert.equal(closedCode(overflow), "KEEP_PLAN_INVALID");
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("approval, path, multi-audio, and unsupported-container boundaries are closed", async () => {
  const value = await fixture();
  try {
    const approval = await execute(value.root, value.ffprobe, value.ffmpeg, false, { approvalRef: "yes" });
    assert.equal(closedCode(approval), "APPROVAL_REF_INVALID");
    const escaped = await execute(value.root, value.ffprobe, value.ffmpeg, false, { keepPlan: "../outside.json" });
    assert.equal(closedCode(escaped), "PATH_ESCAPE");

    await writeProbeFixture(value.ffprobe, {
      format: { duration: "12", format_name: "mov" },
      streams: [{ index: 0, codec_type: "audio", duration: "12" }, { index: 1, codec_type: "audio", duration: "12" }],
    });
    const multipleAudio = await execute(value.root, value.ffprobe, value.ffmpeg);
    assert.equal(closedCode(multipleAudio), "MULTIPLE_AUDIO_STREAMS_REQUIRES_SELECTION");

    await writeProbeFixture(value.ffprobe, {
      format: { duration: "12", format_name: "avi" },
      streams: [{ index: 0, codec_type: "audio", duration: "12" }],
    });
    const container = await execute(value.root, value.ffprobe, value.ffmpeg);
    assert.equal(closedCode(container), "MEDIA_CONTAINER_UNSUPPORTED");
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("canonical report bytes are independent of project root and file creation order", async () => {
  const first = await fixture();
  const second = await fixture();
  try {
    const analysisPath = path.join(second.analysisDirectory, "analysis.json");
    const analysisBytes = await readFile(analysisPath);
    const keyframeBytes = await readFile(second.keyframe);
    await rm(analysisPath);
    await rm(second.keyframe);
    await writeFile(analysisPath, analysisBytes);
    await writeFile(second.keyframe, keyframeBytes);
    const [left, right] = await Promise.all([
      execute(first.root, first.ffprobe, first.ffmpeg),
      execute(second.root, second.ffprobe, second.ffmpeg),
    ]);
    assert.equal(left.status, 0, left.stderr.toString());
    assert.equal(right.status, 0, right.stderr.toString());
    assert.equal(left.stdout.equals(right.stdout), true);
  } finally {
    await rm(first.root, { recursive: true, force: true });
    await rm(second.root, { recursive: true, force: true });
  }
});

test("policy preflight requires every frozen A4 value before external work", () => {
  const expected = {
    version: 1,
    id: "a4-conversation-v1",
    silence_detection_db: -35,
    minimum_silence_seconds: 0.45,
    retained_pause_seconds: { within_sentence: 0.1, sentence_end: 0.166667, topic_transition: 0.3 },
    surrounding_context_seconds: 1,
    speech_guard_seconds: 0.033333,
    frame_rate: 30,
  };
  assert.equal(policyValues(expected).frame_rate, 30);
  assert.throws(() => policyValues({ ...expected, minimum_silence_seconds: 0.5 }), { code: "REPORT_INVALID" });
  assert.throws(() => policyValues({ ...expected, extra: true }), { code: "REPORT_INVALID" });
});

test("helper time, peak RSS, and cross-source analysis records use global budgets", () => {
  assert.throws(() => checkBudget(100, { now: 100, rssBytes: 0 }), { code: "INPUT_BUDGET_EXCEEDED" });
  assert.throws(() => checkBudget(101, { now: 100, rssBytes: 512 * 1024 * 1024 + 1 }), {
    code: "INPUT_BUDGET_EXCEEDED",
  });
  const recordBudget = { count: 0 };
  addAnalysisRecords(recordBudget, 2, 3);
  assert.equal(recordBudget.count, 2);
  assert.throws(() => addAnalysisRecords(recordBudget, 2, 3), { code: "INPUT_BUDGET_EXCEEDED" });
  assert.equal(recordBudget.count, 2);
});

test("module receipt discovery follows the complete relative ESM closure and rejects an unresolved import", async () => {
  const temporary = await realpath(await mkdtemp(path.join(tmpdir(), "akari-esm-closure-")));
  try {
    await mkdir(path.join(temporary, "bin", "nested"), { recursive: true });
    await writeFile(path.join(temporary, "bin", "entry.mjs"), [
      'import "node:path";',
      'import "./helper.mjs";',
      "export const ready = true;",
      "",
    ].join("\n"));
    await writeFile(path.join(temporary, "bin", "helper.mjs"), [
      'import value from "./nested/value.mjs";',
      "export default value;",
      "",
    ].join("\n"));
    await writeFile(path.join(temporary, "bin", "nested", "value.mjs"), "export default 1;\n");
    const closure = await discoverLocalEsmModules("bin/entry.mjs", temporary);
    assert.deepEqual([...closure.keys()], ["bin/entry.mjs", "bin/helper.mjs", "bin/nested/value.mjs"]);

    await writeFile(path.join(temporary, "bin", "helper.mjs"), 'import "./unregistered.mjs";\n');
    await assert.rejects(() => discoverLocalEsmModules("bin/entry.mjs", temporary), { code: "TOOL_BINARY_INVALID" });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
