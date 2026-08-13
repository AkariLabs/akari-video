import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(packageRoot, "bin", "render-cut.mjs");
const editLintPath = join(packageRoot, "..", "edit-lint", "bin", "edit-lint.mjs");

function run(command, args) {
  return spawnSync(command, args, { encoding: "utf8" });
}

test("a verified render appends its v1 source once without reformatting edit.json", async (t) => {
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
    const expected = `{
  "version": 1,
  "output": { "width": 160, "height": 90, "fps": 5 },
  "sources": [
    { "id": "render", "path": "input.mp4", "proxy": null },
    {
      "id": "render-2",
      "path": "exports/render.mp4",
      "proxy": null
    }
  ],
  "cuts": [{ "src": "render", "in": 0, "out": 0.5 }],
  "overlays": []
}
`;
    const editPath = join(project, "edit.json");
    await writeFile(editPath, original);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const rendered = run(process.execPath, [cliPath, project, "--out", "exports/render.mp4"]);
      assert.equal(rendered.status, 0, rendered.stderr);
    }

    const actual = await readFile(editPath, "utf8");
    assert.equal(actual, expected);
    const parsed = JSON.parse(actual);
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

    const rendered = run(process.execPath, [cliPath, project, "--out", "exports/render.mp4"]);
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
