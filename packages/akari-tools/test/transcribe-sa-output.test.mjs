import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { transcribeMedia } from "../src/media/transcribe.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDirectory, "../../../");
const transcribeSaScript = path.join(repoRoot, "skills", "analyze-footage", "bin", "transcribe-sa.mjs");
const speechAnalyzerHelperSource = path.join(repoRoot, "skills", "analyze-footage", "bin", "speechanalyzer-helper.swift");

function isSpeechAnalyzerEnvironmentSupported() {
  if (os.platform() !== "darwin") return false;
  const version = spawnSync("sw_vers", ["-productVersion"], { encoding: "utf8" });
  if (version.status !== 0) return false;
  const major = Number.parseInt(String(version.stdout ?? "").trim().split(".")[0], 10);
  if (!Number.isInteger(major) || major < 26) return false;
  const swift = spawnSync("swiftc", ["-version"], { encoding: "utf8" });
  return swift.status === 0;
}

function buildPayload() {
  const hugeWords = [];
  for (let index = 0; index < 200000; index += 1) {
    hugeWords.push({ start: index * 0.01, end: index * 0.01 + 0.005, text: `w${index}` });
  }
  return {
    segments: [
      { start: 3, end: 4, text: "late", words: [{ start: 3, end: 3.2, text: "late" }] },
      { start: 10, end: 10.1, text: "middle", words: hugeWords },
      { start: null, end: 12, text: "invalid", words: [{ start: 12, end: 12.4, text: "drop" }] },
      { start: 1, end: 2, text: "first", words: [
        { start: 1, end: 1.2, text: "first" },
        { start: 2.5, end: 2.2, text: "bad-word" },
      ] },
      { start: 2, end: 1, text: "bad-segment", words: [{ start: 2, end: 2.1, text: "bad" }] },
    ],
  };
}

function writeFakeHelper(scriptPath, payloadPath, helperSourcePath = speechAnalyzerHelperSource) {
  const script = [
    "#!/bin/sh",
    "set -eu",
    `node -e "const fs = require('fs'); process.stdout.write(fs.readFileSync('${payloadPath}', 'utf8'));"`,
  ].join("\n") + "\n";
  writeFileSync(scriptPath, script, "utf8");
  chmodSync(scriptPath, 0o755);
  const sourceMtime = Math.floor(statSync(helperSourcePath).mtimeMs / 1000);
  const future = Math.max(Date.now() / 1000, sourceMtime + 1);
  utimesSync(scriptPath, future, future);
}

const supported = isSpeechAnalyzerEnvironmentSupported();

test("transcribe-sa は --output 有無で segments を正規化して ENOBUFS を回避する", { skip: !supported }, (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "akari-sa-output-test-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const input = path.join(root, "input.wav");
  writeFileSync(input, "mock audio");

  const payload = buildPayload();
  const payloadPath = path.join(root, "payload.json");
  writeFileSync(payloadPath, JSON.stringify(payload), "utf8");
  assert.ok(readFileSync(payloadPath, "utf8").length > 2 * 1024 * 1024);

  const helper = path.join(root, "speechanalyzer-helper");
  writeFakeHelper(helper, payloadPath);

  const noOutput = spawnSync(process.execPath, [transcribeSaScript, "--input", input, "--helper-bin", helper], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  assert.equal(noOutput.status, 0);
  const noOutputValue = JSON.parse(noOutput.stdout);
  assert.equal(noOutputValue.available, true);
  assert.doesNotMatch(String(noOutput.stderr), /ENOBUFS/);

  const outputPath = path.join(root, "result.json");
  const withOutput = spawnSync(process.execPath, [transcribeSaScript, "--input", input, "--helper-bin", helper, "--output", outputPath], { encoding: "utf8" });
  assert.equal(withOutput.status, 0);
  assert.equal(withOutput.stdout, "");
  assert.doesNotMatch(String(withOutput.stderr), /ENOBUFS/);
  const outputValue = JSON.parse(readFileSync(outputPath, "utf8"));

  assert.deepEqual(noOutputValue.segments.map((segment) => ({
    start: segment.start,
    end: segment.end,
    text: segment.text,
    wordCount: segment.words.length,
    firstWord: segment.words[0]?.text,
    lastWord: segment.words.at(-1)?.text,
  })), [
    { start: 1, end: 2, text: "first", wordCount: 1, firstWord: "first", lastWord: "first" },
    { start: 3, end: 4, text: "late", wordCount: 1, firstWord: "late", lastWord: "late" },
    { start: 10, end: 10.1, text: "middle", wordCount: 200000, firstWord: "w0", lastWord: "w199999" },
  ]);
  assert.deepEqual(noOutputValue.segments, outputValue.segments);
  assert.equal(noOutputValue.segments.length, 3);
});

test("runSpeechAnalyzer は output ファイルを読む形で segments を返す", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "akari-sa-output-media-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const audio = path.join(root, "input.wav");
  writeFileSync(audio, `mock audio ${randomUUID()}`);

  const calls = [];
  const payload = {
    available: true,
    segments: [
      { start: 3, end: 4, text: "late", words: [{ start: 3, end: 3.2, text: "late" }] },
      { start: 1, end: 2, text: "first", words: [
        { start: 1, end: 1.2, text: "first" },
        { start: 2.5, end: 2.2, text: "bad-word" },
      ] },
    ],
  };

  const result = await transcribeMedia(audio, {
    cwd: root,
    repoRoot,
    ffmpegCommand: "mock-ffmpeg",
    ffprobeCommand: "mock-ffprobe",
    noRecord: true,
    speechAnalyzerAvailable: true,
    wordBook: false,
    unrecognized: false,
    spawn(command, args) {
      calls.push({ command, args });
      if (command === "mock-ffprobe") {
        return { status: 0, stdout: JSON.stringify({ format: { duration: 30 }, streams: [{ codec_type: "audio" }] }), stderr: "" };
      }
      if (command === "mock-ffmpeg") {
        return { status: 0, stdout: "", stderr: "" };
      }
      if (command === process.execPath) {
        const outputIndex = args.indexOf("--output");
        assert.ok(outputIndex >= 0, "--output が付与されるべき");
        const outputPath = args[outputIndex + 1];
        writeFileSync(outputPath, JSON.stringify(payload), "utf8");
        return { status: 0, stdout: "", stderr: "" };
      }
      throw new Error(`unexpected command: ${command}`);
    },
  });

  assert.equal(result.backend, "speech-analyzer");
  assert.equal(calls.some((entry) => entry.args[0]?.endsWith(path.join("analyze-footage", "bin", "transcribe-sa.mjs")) && entry.args.includes("--output")), true);
  assert.deepEqual(result.segments, [
    { start: 1, end: 2, text: "first" },
    { start: 3, end: 4, text: "late", words: [{ start: 3, end: 3.2, text: "late" }] },
  ]);
});

test("transcribe-sa は helper 失敗時、--output 指定でも stdout に失敗 JSON を返す", { skip: !supported }, (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "akari-sa-output-test-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const input = path.join(root, "input.wav");
  writeFileSync(input, "mock audio");

  const helper = path.join(root, "speechanalyzer-helper");
  const helperScript = [
    "#!/bin/sh",
    "set -eu",
    "echo boom 1>&2",
    "exit 1",
  ].join("\n") + "\n";
  writeFileSync(helper, helperScript, "utf8");
  chmodSync(helper, 0o755);

  const outputPath = path.join(root, "result.json");
  const output = spawnSync(process.execPath, [transcribeSaScript, "--input", input, "--helper-bin", helper, "--output", outputPath], { encoding: "utf8" });
  assert.equal(output.status, 1);
  const value = JSON.parse(output.stdout);
  assert.equal(value.available, false);
  assert.equal(value.reason, "helper failed: boom");
  assert.ok(!existsSync(outputPath));
});
