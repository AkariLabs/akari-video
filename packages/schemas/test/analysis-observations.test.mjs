import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(packageRoot, "../..");
const canonicalText = readFileSync(path.join(packageRoot, "analysis.schema.json"), "utf8");
const shellCopyPath = path.join(repositoryRoot, "apps", "shell", "lib", "schemas", "analysis.schema.json");
const schema = JSON.parse(canonicalText);
const validate = new Ajv2020({ strict: false }).compile(schema);

const minimal = {
  version: 0,
  source: "../../../../assets/interview.mp4",
  transcript: [],
  keyframes: [],
  events: [],
  tracks: { speakers: [], faces: [], person_matte: null },
};

test("analysis.json は probe / tracks.waveform / observations が無くても妥当", () => {
  assert.equal(validate(minimal), true, JSON.stringify(validate.errors));
});

test("analysis.json は additive な観察キーを持っても妥当", () => {
  const withObservations = {
    ...minimal,
    probe: {
      sha256: "a".repeat(64),
      size_bytes: 123,
      container: "mov",
      duration_s: 6,
      video: { width: 1280, height: 720, fps: 30, codec: "h264", rotation: 0 },
      audio: { codec: "aac", channels: 2, sample_rate: 48000 },
      tool: { ffprobe: "7.1" },
    },
    tracks: {
      ...minimal.tracks,
      waveform: { path: "../../reports/media/interview/waveform.json", tool: "akari media 0.1.0", generated_at: "2026-08-29T10:00:00Z" },
    },
    observations: [
      { kind: "probe", at: "2026-08-29T10:00:00Z", args: {}, outputs: [], tool: "akari media 0.1.0" },
      { kind: "transcribe", at: "2026-08-29T10:01:00Z", range: { in: 1, out: 2 }, args: { backend: "whisper-cpp" }, outputs: [], tool: "akari media 0.1.0" },
    ],
  };
  assert.equal(validate(withObservations), true, JSON.stringify(validate.errors));
});

test("analysis transcript segment は unrecognized 区間を受理する", () => {
  const value = {
    ...minimal,
    transcript: [{
      start: 0,
      end: 2,
      text: "聞き取れた語",
      words: [{ start: 0, end: 0.5, text: "聞き取れた語" }],
      unrecognized: [{ start: 0.5, end: 0.9 }],
    }],
  };
  assert.equal(validate(value), true, JSON.stringify(validate.errors));
});

test("analysis unrecognized span は追加プロパティを拒否する", () => {
  const value = {
    ...minimal,
    transcript: [{
      start: 0,
      end: 2,
      text: "聞き取れた語",
      unrecognized: [{ start: 0.5, end: 0.9, confidence: 0.2 }],
    }],
  };
  assert.equal(validate(value), false);
  assert.ok(validate.errors?.some((error) =>
    error.keyword === "additionalProperties"
      && error.instancePath.endsWith("/unrecognized/0")));
});

test("analysis schema の正典と shell 写しはバイト同一", (t) => {
  if (!existsSync(shellCopyPath)) return t.skip("shell のビルド生成物が未生成");
  assert.equal(readFileSync(shellCopyPath, "utf8"), canonicalText);
});
