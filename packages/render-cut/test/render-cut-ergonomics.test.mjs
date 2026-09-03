import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildAudioMixCommand, selectDefaultOutput } from "../src/plan.mjs";
import { formatWarningLines } from "../src/render-cut.mjs";
import {
  enumerateDeclaredRenderInputs,
  hashDeclaredRenderInputs,
  resolveDeclaredProjectInput,
} from "../src/render-inputs.mjs";

async function makeAudioFixture() {
  const root = await mkdtemp(join(tmpdir(), "render-cut-ergonomics-audio-"));
  const projectRoot = join(root, "project");
  const audioPath = join(projectRoot, "audio.wav");
  const ffprobePath = join(root, "ffprobe-fixture.mjs");
  await mkdir(projectRoot, { recursive: true });
  await writeFile(audioPath, "fixture");
  await writeFile(ffprobePath, `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ streams: [{ codec_type: "audio" }], format: { duration: 2 } }));
`);
  await chmod(ffprobePath, 0o755);
  return { root, projectRoot, audioPath, ffprobePath };
}

function audioMix({ projectRoot, ffprobePath, audio, fps = 10 }) {
  return buildAudioMixCommand({
    edit: {
      version: 0,
      output: { width: 320, height: 180, fps },
      audio,
    },
    projectRoot,
    inputPath: join(projectRoot, "composite.mp4"),
    outputPath: join(projectRoot, "final.mp4"),
    duration: 5,
    ffprobeCommand: ffprobePath,
  });
}

test("a source reached through an in-project assets symlink resolves and hashes as a project input", async () => {
  const root = await mkdtemp(join(tmpdir(), "render-cut-symlink-inside-"));
  try {
    const projectRoot = join(root, "project");
    const realAssets = join(projectRoot, "real-assets");
    const sourcePath = join(realAssets, "clip.mp4");
    const edit = {
      version: 1,
      output: { width: 320, height: 180, fps: 30 },
      sources: [{ id: "bg", path: "assets/clip.mp4", proxy: null }],
      cuts: [{ src: "bg", in: 0, out: 1 }],
      overlays: [],
    };
    const editText = `${JSON.stringify(edit)}\n`;
    await mkdir(realAssets, { recursive: true });
    await writeFile(sourcePath, "project source");
    await writeFile(join(projectRoot, "edit.json"), editText);
    await symlink("real-assets", join(projectRoot, "assets"));

    const actualSourcePath = await realpath(sourcePath);
    assert.equal(resolveDeclaredProjectInput(projectRoot, "assets/clip.mp4", "source:bg"), actualSourcePath);
    const inputs = await enumerateDeclaredRenderInputs({ projectRoot, edit, editText });
    const sourceInput = inputs.find((input) => input.role === "source:bg");
    assert.equal(sourceInput?.scope, "project");
    assert.equal(sourceInput?.absolute_path, actualSourcePath);
    const hashed = await hashDeclaredRenderInputs(inputs, { useConsumedText: true });
    assert.equal(hashed.find((input) => input.role === "source:bg")?.bytes, 14);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a source whose final path component is an in-project file symlink resolves and records project scope", async () => {
  const root = await mkdtemp(join(tmpdir(), "render-cut-file-symlink-inside-"));
  try {
    const projectRoot = join(root, "project");
    const assets = join(projectRoot, "assets");
    const realAssets = join(projectRoot, "real-assets");
    const sourcePath = join(realAssets, "clip.mp4");
    const edit = {
      version: 1,
      output: { width: 320, height: 180, fps: 30 },
      sources: [{ id: "bg", path: "assets/clip.mp4", proxy: null }],
      cuts: [{ src: "bg", in: 0, out: 1 }],
      overlays: [],
    };
    const editText = `${JSON.stringify(edit)}\n`;
    await mkdir(assets, { recursive: true });
    await mkdir(realAssets, { recursive: true });
    await writeFile(sourcePath, "project source");
    await writeFile(join(projectRoot, "edit.json"), editText);
    await symlink("../real-assets/clip.mp4", join(assets, "clip.mp4"));

    const actualSourcePath = await realpath(sourcePath);
    assert.equal(resolveDeclaredProjectInput(projectRoot, "assets/clip.mp4", "source:bg"), actualSourcePath);
    const inputs = await enumerateDeclaredRenderInputs({ projectRoot, edit, editText });
    const sourceInput = inputs.find((input) => input.role === "source:bg");
    assert.equal(sourceInput?.scope, "project");
    assert.equal(sourceInput?.absolute_path, actualSourcePath);
    const hashed = await hashDeclaredRenderInputs(inputs, { useConsumedText: true });
    assert.equal(hashed.find((input) => input.role === "source:bg")?.bytes, 14);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an assets symlink escaping projectRoot keeps the existing refusal message", async () => {
  const root = await mkdtemp(join(tmpdir(), "render-cut-symlink-outside-"));
  try {
    const projectRoot = join(root, "project");
    const externalAssets = join(root, "external-assets");
    await mkdir(projectRoot, { recursive: true });
    await mkdir(externalAssets, { recursive: true });
    await writeFile(join(externalAssets, "clip.mp4"), "external source");
    await symlink(externalAssets, join(projectRoot, "assets"));

    assert.throws(
      () => resolveDeclaredProjectInput(projectRoot, "assets/clip.mp4", "source:bg"),
      { message: "source:bg is not a regular project file" },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("SFX out overrun below one frame is silently clamped", async () => {
  const fixture = await makeAudioFixture();
  try {
    const command = audioMix({
      ...fixture,
      audio: { sfx: [{ path: "audio.wav", out: 2.05 }] },
    });
    assert.deepEqual(command.warnings, []);
    assert.match(command.args.join(" "), /atrim=start=0:end=2,asetpts=PTS-STARTPTS/u);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("SFX out overrun of two frames is clamped with a warning", async () => {
  const fixture = await makeAudioFixture();
  try {
    const command = audioMix({
      ...fixture,
      audio: { sfx: [{ path: "audio.wav", out: 2.2 }] },
    });
    assert.equal(command.warnings.length, 1);
    assert.match(command.warnings[0], /audio\.sfx\[0\]: out 2\.2s exceeds/u);
    assert.match(command.args.join(" "), /atrim=start=0:end=2,asetpts=PTS-STARTPTS/u);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("narration out overrun below one frame is silently clamped", async () => {
  const fixture = await makeAudioFixture();
  try {
    const command = audioMix({
      ...fixture,
      audio: { narration: [{ id: "voice", path: "audio.wav", t: 0, out: 2.05 }] },
    });
    assert.deepEqual(command.warnings, []);
    assert.match(command.args.join(" "), /atrim=start=0:end=2,asetpts=PTS-STARTPTS/u);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("narration out overrun of two frames is clamped with a warning", async () => {
  const fixture = await makeAudioFixture();
  try {
    const command = audioMix({
      ...fixture,
      audio: { narration: [{ id: "voice", path: "audio.wav", t: 0, out: 2.2 }] },
    });
    assert.equal(command.warnings.length, 1);
    assert.match(command.warnings[0], /narration voice: out 2\.2s exceeds/u);
    assert.match(command.args.join(" "), /atrim=start=0:end=2,asetpts=PTS-STARTPTS/u);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("twelve same-type warnings render as five details and one aggregate line", () => {
  const warnings = Array.from(
    { length: 12 },
    (_, index) => `audio.sfx[${index}]: out ${10 + index}s exceeds the material duration (2s); clamped to 2s`,
  );
  const lines = formatWarningLines(warnings);
  assert.equal(lines.length, 6);
  assert.deepEqual(lines.slice(0, 5), warnings.slice(0, 5).map((warning) => `render-cut warning: ${warning}`));
  assert.equal(lines[5], "render-cut warning: 他 7 件（同種）");
});

test("narration ids are ignored for grouping while distinct warning types stay separate", () => {
  const ids = ["intro", "body", "outro", "q1", "q2", "q3", "tail", "extra", "more", "yet", "again", "last"];
  const outWarnings = ids.map(
    (id) => `narration ${id}: out 2.2s exceeds the material duration (2s); clamped to 2s`,
  );
  const gainWarnings = ids.map(
    (id) => `narration ${id}: gain_db 20 clamped to 12`,
  );
  const lines = formatWarningLines([...outWarnings, ...gainWarnings]);

  assert.equal(lines.length, 12);
  assert.deepEqual(lines.slice(0, 5), outWarnings.slice(0, 5).map((warning) => `render-cut warning: ${warning}`));
  assert.equal(lines[5], "render-cut warning: 他 7 件（同種）");
  assert.deepEqual(lines.slice(6, 11), gainWarnings.slice(0, 5).map((warning) => `render-cut warning: ${warning}`));
  assert.equal(lines[11], "render-cut warning: 他 7 件（同種）");
});

test("default output uses the project directory name instead of the first source", () => {
  const projectRoot = join("/tmp", "my-render-project");
  const output = selectDefaultOutput(
    projectRoot,
    { sources: [{ id: "bg", path: "assets/background.mp4" }] },
    () => false,
  );
  assert.equal(output, join(projectRoot, "exports", "my-render-project.mp4"));
});

test("a colliding project-named output advances to the -2 suffix", () => {
  const projectRoot = join("/tmp", "my-render-project");
  const first = join(projectRoot, "exports", "my-render-project.mp4");
  const output = selectDefaultOutput(projectRoot, { sources: [] }, (candidate) => candidate === first);
  assert.equal(output, join(projectRoot, "exports", "my-render-project-2.mp4"));
});
