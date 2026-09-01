import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile as rawWriteFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createMigratingWriteFile } from "./helpers/v2-fixture.mjs";

const writeFile = createMigratingWriteFile(rawWriteFile);

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(packageRoot, "bin", "render-cut.mjs");
const editLintPath = join(packageRoot, "..", "edit-lint", "bin", "edit-lint.mjs");

function run(command, args) {
  return spawnSync(command, args, { encoding: "utf8" });
}

test("a verified render appends its v2 source once and a second render is byte-stable", async (t) => {
  if (run("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const project = await mkdtemp(join(tmpdir(), "render-cut-source-append-"));
  try {
    const generated = run("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "color=c=blue:s=160x90:r=5:d=0.6",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", join(project, "input.mp4"),
    ]);
    assert.equal(generated.status, 0, generated.stderr);
    await mkdir(join(project, ".akari"));
    await writeFile(join(project, ".akari", "lint.json"), '{"version":1,"verdict":"pass"}\n');

    const original = `{
  "version": 1,
  "output": { "width": 160, "height": 90, "fps": 5 },
  "sources": [
    { "id": "render", "path": "input.mp4", "proxy": null }
  ],
  "cuts": [{ "src": "render", "in": 0, "out": 0.5 }],
  "overlays": []
}
`;
    const editPath = join(project, "edit.json");
    await writeFile(editPath, original);

    // This suite measures legacy render/edit persistence; engine resolution is tested separately.
    const first = run(process.execPath, [cliPath, project, "--out", "exports/render.mp4", "--engine", "osr"]);
    assert.equal(first.status, 0, first.stderr);
    const afterFirst = await readFile(editPath, "utf8");
    const firstState = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    const firstReceipt = JSON.parse(
      await readFile(join(project, firstState.render_receipt.path), "utf8"),
    );
    const receiptEditInput = firstReceipt.inputs.find((input) => input.role === "edit");
    assert.equal(
      receiptEditInput?.sha256,
      createHash("sha256").update(afterFirst).digest("hex"),
      "completed edit.json must match the receipt-bound edit input",
    );
    const second = run(process.execPath, [cliPath, project, "--out", "exports/render.mp4", "--engine", "osr"]);
    assert.equal(second.status, 0, second.stderr);

    const actual = await readFile(editPath, "utf8");
    assert.equal(actual, afterFirst);
    const parsed = JSON.parse(actual);
    assert.equal(parsed.version, 2);
    assert.equal(parsed.sources.filter(source => source.path === "exports/render.mp4").length, 1);

    const linted = run(process.execPath, [editLintPath, project]);
    assert.equal(linted.status, 0, linted.stderr);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("a verified v0 render does not warn that sources[] is unavailable", async (t) => {
  if (run("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const project = await mkdtemp(join(tmpdir(), "render-cut-source-v0-"));
  try {
    const generated = run("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "color=c=blue:s=160x90:r=5:d=0.6",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", join(project, "input.mp4"),
    ]);
    assert.equal(generated.status, 0, generated.stderr);
    await mkdir(join(project, ".akari"));
    await writeFile(join(project, ".akari", "lint.json"), '{"version":1,"verdict":"pass"}\n');
    await writeFile(join(project, "edit.json"), `${JSON.stringify({
      version: 0,
      output: { width: 160, height: 90, fps: 5 },
      source: { path: "input.mp4", proxy: null },
      cuts: [{ in: 0, out: 0.5 }],
      overlays: [],
    }, null, 2)}\n`);

    // This assertion measures the legacy CLI path; engine resolution is tested separately.
    const rendered = run(process.execPath, [cliPath, project, "--out", "exports/render.mp4", "--engine", "osr"]);
    assert.equal(rendered.status, 0, rendered.stderr);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(
      state.warnings.some((warning) => warning.includes("sources[] is unavailable in edit.json v0")),
      false,
    );
    assert.doesNotMatch(`${rendered.stdout}\n${rendered.stderr}`, /sources\[\] is unavailable in edit\.json v0/u);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
