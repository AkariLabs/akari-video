import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { validateAnalysis } = require("../generated/contract-validators.cjs");
const repositoryRoot = path.resolve(import.meta.dirname, "../../../../");

test("generated analysis validator accepts observations in valid analysis.json", () => {
  const analysis = {
    version: 0,
    source: "assets/desk.mp4",
    transcript: [],
    keyframes: [],
    events: [],
    tracks: { speakers: [], faces: [], person_matte: null },
    observations: [{
      kind: "probe",
      at: "2026-10-02T00:00:00Z",
      args: {},
      outputs: [],
      tool: "akari media probe",
    }],
  };

  assert.equal(validateAnalysis(analysis), true, JSON.stringify(validateAnalysis.errors));
});

test("committed cut candidate validators match current schemas", {
  skip: process.platform === "win32" ? "autocrlf can change bytes on Windows" : false,
}, async () => {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/gen-cut-candidate-validators.mjs", "--check"], {
      cwd: repositoryRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stderr = [];
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stderr: Buffer.concat(stderr).toString() }));
  });

  assert.equal(result.status, 0, result.stderr);
});
