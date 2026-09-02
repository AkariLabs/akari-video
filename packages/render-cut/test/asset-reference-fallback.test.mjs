import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { resolveLibraryFallback } from "../src/library-reference.mjs";
import {
  enumerateDeclaredRenderInputs,
  hashDeclaredRenderInputs,
  resolveDeclaredProjectInput,
} from "../src/render-inputs.mjs";
import { renderProject } from "../src/render-cut.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const sourceVideo = resolve(here, "../../../test-project/source.mp4");

const REFERENCE_CASES = [
  {
    name: "declared top-level file",
    declaredPath: "assets/still/card/frame.png",
    references: [{ category: "still", id: "card" }],
    libraryFile: "still/card/frame.png",
    resolves: true,
  },
  {
    name: "declared nested file",
    declaredPath: "assets/audio/theme/stems/main.wav",
    references: [{ category: "audio", id: "theme" }],
    libraryFile: "audio/theme/stems/main.wav",
    resolves: true,
  },
  {
    name: "ledger absent",
    declaredPath: "assets/still/card/frame.png",
    references: [],
    libraryFile: "still/card/frame.png",
    resolves: false,
  },
  {
    name: "ledger entry does not match",
    declaredPath: "assets/still/card/frame.png",
    references: [{ category: "still", id: "other" }],
    libraryFile: "still/card/frame.png",
    resolves: false,
  },
  {
    name: "library file is missing",
    declaredPath: "assets/still/card/frame.png",
    references: [{ category: "still", id: "card" }],
    libraryFile: null,
    resolves: false,
  },
  {
    name: "declared path traversal",
    declaredPath: "assets/still/card/../../../../outside.png",
    references: [{ category: "still", id: "card" }],
    libraryFile: null,
    resolves: false,
  },
];

test("library fallback follows the shared resolution case table", async () => {
  for (const entry of REFERENCE_CASES) {
    const root = await mkdtemp(join(tmpdir(), "render-cut-reference-cases-"));
    try {
      const projectRoot = join(root, "project");
      const assetsRoot = join(root, "home", "assets");
      await mkdir(projectRoot, { recursive: true });
      if (entry.libraryFile !== null) {
        const file = join(assetsRoot, ...entry.libraryFile.split("/"));
        await mkdir(join(file, ".."), { recursive: true });
        await writeFile(file, entry.name, "utf8");
      }
      const result = resolveLibraryFallback({
        projectRoot,
        declaredPath: entry.declaredPath,
        references: entry.references,
        akariAssetsDir: assetsRoot,
      });
      assert.equal(result.path !== null, entry.resolves, entry.name);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("render inputs use a declared library reference and record scope library", async () => {
  const root = await mkdtemp(join(tmpdir(), "render-cut-library-input-"));
  try {
    const projectRoot = join(root, "project");
    const home = join(root, "home");
    const source = join(home, "assets", "broll", "intro", "clip.mp4");
    await mkdir(join(projectRoot, ".akari"), { recursive: true });
    await mkdir(join(source, ".."), { recursive: true });
    await writeFile(source, "library clip", "utf8");
    const edit = {
      version: 1,
      output: { width: 1280, height: 720, fps: 30 },
      sources: [{ id: "clip", path: "assets/broll/intro/clip.mp4", proxy: null }],
      cuts: [{ src: "clip", in: 0, out: 1 }],
      overlays: [],
    };
    const editText = `${JSON.stringify(edit, null, 2)}\n`;
    await writeFile(join(projectRoot, "edit.json"), editText, "utf8");
    await writeFile(
      join(projectRoot, ".akari", "asset-references.json"),
      `${JSON.stringify({ version: 0, references: [{ category: "broll", id: "intro" }] }, null, 2)}\n`,
      "utf8",
    );
    const env = { AKARI_HOME: home };

    assert.equal(
      resolveDeclaredProjectInput(projectRoot, "assets/broll/intro/clip.mp4", "source", env),
      source,
    );
    const inputs = await enumerateDeclaredRenderInputs({ projectRoot, edit, editText, env });
    const sourceInput = inputs.find((input) => input.role === "source:clip");
    assert.equal(sourceInput?.scope, "library");
    assert.equal(sourceInput?.absolute_path, source);
    const hashed = await hashDeclaredRenderInputs(inputs, { useConsumedText: true });
    assert.equal(hashed.find((input) => input.role === "source:clip")?.scope, "library");

    await writeFile(
      join(projectRoot, ".akari", "asset-references.json"),
      '{"version":0,"references":[]}\n',
      "utf8",
    );
    assert.throws(
      () => resolveDeclaredProjectInput(projectRoot, "assets/broll/intro/clip.mp4", "source", env),
      /source could not be resolved/u,
    );

    const projectSource = join(projectRoot, "assets", "broll", "intro", "clip.mp4");
    await mkdir(join(projectSource, ".."), { recursive: true });
    await writeFile(projectSource, "project clip", "utf8");
    const projectInputs = await enumerateDeclaredRenderInputs({ projectRoot, edit, editText, env });
    const projectSourceInput = projectInputs.find((input) => input.role === "source:clip");
    assert.equal(projectSourceInput?.scope, "project");
    assert.equal(projectSourceInput?.absolute_path, projectSource);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("plan-only resolves a v2 source through the library for capabilities, commands, and render state", { timeout: 60_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "render-cut-library-plan-"));
  try {
    const projectRoot = join(root, "project");
    const home = join(root, "home");
    const declaredPath = "assets/broll/intro/clip.mp4";
    const source = join(home, "assets", "broll", "intro", "clip.mp4");
    await mkdir(join(projectRoot, ".akari"), { recursive: true });
    await mkdir(dirname(source), { recursive: true });
    await cp(sourceVideo, source);
    const edit = {
      version: 2,
      output: { width: 320, height: 180, fps: 30 },
      sources: [{ id: "clip", path: declaredPath, proxy: null }],
      tracks: [{
        id: "video",
        lane: "visual",
        items: [{
          id: "cut-1",
          at: 0,
          duration: 30,
          source: { kind: "media", src: "clip", in: 0, out: 1 },
        }],
      }],
    };
    await writeFile(join(projectRoot, "edit.json"), `${JSON.stringify(edit, null, 2)}\n`, "utf8");
    await writeFile(join(projectRoot, ".akari", "lint.json"), '{"verdict":"pass"}\n', "utf8");
    await writeFile(
      join(projectRoot, ".akari", "asset-references.json"),
      `${JSON.stringify({ version: 0, references: [{ category: "broll", id: "intro" }] }, null, 2)}\n`,
      "utf8",
    );
    const env = { ...process.env, AKARI_HOME: home };
    const sourceActual = await realpath(source);
    const probedPaths = [];
    const probeMediaImpl = (_command, path) => {
      probedPaths.push(path);
      return {
        streams: [
          { codec_type: "video", width: 320, height: 180, avg_frame_rate: "30/1", pix_fmt: "yuv420p" },
          { codec_type: "audio" },
        ],
        format: { duration: "5" },
      };
    };

    const state = await renderProject(projectRoot, {
      planOnly: true,
      engine: "osr",
      env,
      probeMediaImpl,
    });
    assert.deepEqual(probedPaths, [sourceActual]);
    assert.equal(state.provenance.sources[0]?.path, sourceActual);
    assert.ok(state.plan.commands.cut_audio.args.includes(sourceActual));

    const recorded = JSON.parse(await readFile(join(projectRoot, ".akari", "render.json"), "utf8"));
    const recordedSource = Object.entries(recorded.inputs).find(
      ([path]) => path.replaceAll("\\", "/") === declaredPath,
    )?.[1];
    assert.equal(recordedSource?.scope, "library");

    await writeFile(
      join(projectRoot, ".akari", "asset-references.json"),
      '{"version":0,"references":[]}\n',
      "utf8",
    );
    await assert.rejects(
      renderProject(projectRoot, {
        planOnly: true,
        engine: "osr",
        env,
        writeState: false,
        probeMediaImpl: () => assert.fail("unresolved project/library source must not be probed"),
      }),
      /ffprobe failed for clip\.mp4:/u,
    );

    await writeFile(
      join(projectRoot, ".akari", "asset-references.json"),
      `${JSON.stringify({ version: 0, references: [{ category: "broll", id: "intro" }] })}\n`,
      "utf8",
    );
    await rm(source);
    await assert.rejects(
      renderProject(projectRoot, {
        planOnly: true,
        engine: "osr",
        env,
        writeState: false,
        probeMediaImpl: () => assert.fail("unresolved project/library source must not be probed"),
      }),
      /ffprobe failed for clip\.mp4:/u,
    );

    const projectSource = join(projectRoot, ...declaredPath.split("/"));
    await mkdir(dirname(projectSource), { recursive: true });
    await cp(sourceVideo, projectSource);
    const projectSourceActual = await realpath(projectSource);
    probedPaths.length = 0;
    const projectState = await renderProject(projectRoot, {
      planOnly: true,
      engine: "osr",
      env,
      writeState: false,
      probeMediaImpl,
    });
    assert.deepEqual(probedPaths, [projectSourceActual]);
    assert.ok(projectState.plan.commands.cut_audio.args.includes(projectSourceActual));
    const projectRecordedSource = Object.entries(projectState.inputs).find(
      ([path]) => path.replaceAll("\\", "/") === declaredPath,
    )?.[1];
    assert.equal(Object.hasOwn(projectRecordedSource ?? {}, "scope"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
