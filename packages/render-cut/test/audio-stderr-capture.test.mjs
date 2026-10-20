import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AUDIO_QC_CAPTURE_LIMIT_BYTES, buildAudioQc } from "../src/audio-qc.mjs";
import { executeAudioPlan } from "../src/render-cut.mjs";

// 2026-10-20-loudnorm-export-timestamps §3b: a 177s loudnorm mix emitted ~9,300 timestamp
// warnings (1.33MB stderr). Hitting AUDIO_QC_CAPTURE_LIMIT_BYTES used to become ENOBUFS →
// CAPTURE_LIMIT, failing an otherwise valid render. stderr is now spooled and only its tail is
// kept, so volume alone never fails; the loudnorm JSON report printed last stays reachable.

const OVER_LIMIT_BYTES = AUDIO_QC_CAPTURE_LIMIT_BYTES + 512 * 1024;

async function writeNoisyTool(root, { trailingReport = null } = {}) {
  const script = join(root, "noisy-ffmpeg.mjs");
  const report = trailingReport === null ? "" : `process.stderr.write(${JSON.stringify(`${trailingReport}\n`)});\n`;
  await writeFile(
    script,
    `#!/usr/bin/env node\nprocess.stderr.write("w".repeat(${OVER_LIMIT_BYTES}));\n${report}process.stderr.write("tail-marker\\n");\n`,
    "utf8",
  );
  await chmod(script, 0o755);
  return script;
}

test("stderr above the capture limit is not an error and only its tail is retained", async () => {
  const root = await mkdtemp(join(tmpdir(), "render-cut-audio-stderr-"));
  try {
    const script = await writeNoisyTool(root);
    const result = await executeAudioPlan(
      { operation: "ffmpeg", command: script, args: ["-version"], output: join(root, "final.mp4") },
      "ffmpeg version 8.0",
      { projectRoot: root, temporaryDirectory: root },
    );
    assert.equal(result.error, undefined, JSON.stringify(result.error));
    assert.ok(Buffer.byteLength(result.stderr) <= AUDIO_QC_CAPTURE_LIMIT_BYTES);
    assert.ok(result.stderr.endsWith("tail-marker\n"), result.stderr.slice(-40));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a loudnorm filter report at the tail of an over-limit stderr is still measured", async () => {
  const root = await mkdtemp(join(tmpdir(), "render-cut-audio-qc-tail-"));
  try {
    const script = await writeNoisyTool(root, {
      trailingReport: '{"input_i":"-14.02","input_tp":"-1.42"}',
    });
    const qc = buildAudioQc({
      master: { loudnorm: -14 },
      filterStderr: '{"output_i":"-14.10","output_tp":"-1.51"}',
      outputPath: join(root, "final.mp4"),
      ffmpegCommand: script,
      toolVersion: "ffmpeg version 8.0",
    });
    assert.equal(qc.error, undefined, JSON.stringify(qc.error));
    assert.equal(qc.decoded_measurement.normalized.input_i, -14.02);
    assert.equal(qc.decoded_measurement.normalized.input_tp, -1.42);
    assert.equal(qc.verdict, "PASS");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
